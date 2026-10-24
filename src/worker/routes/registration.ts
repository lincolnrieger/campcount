import { Hono } from 'hono';
import { z } from 'zod';
import { isEditable } from '../../shared/lifecycle';
import type { EventStatus } from '../../shared/schemas';
import {
  SECTIONS,
  confirmRegistrationSchema,
  personEntrySchema,
  publicRegistrationSchema,
  registrationSettingsSchema,
} from '../../shared/schemas';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requireUser } from '../context';
import { ApiError, conflict, notFound } from '../lib/errors';
import { randomDigits, randomToken, sha256Hex, timingSafeEqualHex } from '../lib/crypto';
import { addMinutes, nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { EmailSendError, sendEmail } from '../services/email';
import type { RegistrationEvent } from '../services/registration';
import {
  EVENT_COLUMNS,
  addToRoster,
  approveRequest,
  closedReason,
  codeHash,
  contactToken,
  contactTokenValid,
  expectedCount,
  guestNumber,
  toImportRow,
} from '../services/registration';

const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 5;

async function rateLimit(c: AppContext, key: string): Promise<void> {
  if (!c.env.AUTH_LIMITER) return;
  const { success } = await c.env.AUTH_LIMITER.limit({ key });
  if (!success) throw new ApiError(429, 'rate_limited', 'Too many attempts. Wait a minute and try again.');
}

async function limitByIp(c: AppContext, bucket: string): Promise<void> {
  const ip = c.req.header('CF-Connecting-IP');
  if (ip) await rateLimit(c, `${bucket}:${ip}`);
}

const CLOSED_MESSAGE = {
  not_open: 'Registration for this event is not open.',
  closed: 'Registration for this event has closed.',
  full: 'This event is full.',
  event_over: 'This event has finished.',
} as const;

// ---------------------------------------------------------------- public page

export const publicRegisterRoutes = new Hono<AppEnv>();

async function eventByCode(c: AppContext): Promise<RegistrationEvent> {
  const code = z.string().regex(/^[A-Za-z0-9_-]{10,64}$/).safeParse(c.req.param('code'));
  if (!code.success) throw notFound();
  const e = await c.env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE registration_code = ?`).bind(code.data).first<RegistrationEvent>();
  if (!e) throw notFound();
  return e;
}

/** What the registration page shows. Public: nothing about who has registered. */
publicRegisterRoutes.get('/:code', async (c) => {
  const e = await eventByCode(c);
  const reason = await closedReason(c.env, e);
  return c.json({
    event: { name: e.name, startsOn: e.starts_on, endsOn: e.ends_on, location: e.location, description: e.description },
    open: reason === null,
    closedMessage: reason ? CLOSED_MESSAGE[reason] : null,
    closesOn: e.registration_closes_on,
    asksDietary: e.feature_dietary === 1,
    asksPhotos: e.feature_photo === 1,
    approval: e.registration_auto_approve === 1 ? 'automatic' : 'manual',
    sections: SECTIONS.filter((s) => s !== 'Other'),
  });
});

/**
 * Submit a registration. The first one from an email gets a 6-digit code to
 * confirm the address; later ones from the same browser within an hour carry
 * a contact token instead. The answer never says whether someone is already
 * registered, so the page can't be used to find out who is going.
 */
publicRegisterRoutes.post('/:code', async (c) => {
  const e = await eventByCode(c);
  const input = await parseBody(c, publicRegistrationSchema);
  await limitByIp(c, 'register');
  await rateLimit(c, `register:${await sha256Hex(input.email)}`);
  const reason = await closedReason(c.env, e);
  if (reason) throw conflict(CLOSED_MESSAGE[reason]);

  const id = crypto.randomUUID();
  const now = nowIso();
  const trusted = await contactTokenValid(c.env, e.id, input.email, input.contactToken);
  const code = randomDigits(6);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO registration_requests (id, event_id, status, member_number, first_name, preferred_name, last_name, kind, section,
          group_name, position, photo_consent, dietary, contact_email, code_hash, code_expires_at, created_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      e.id,
      trusted ? 'pending' : 'unconfirmed',
      input.memberNumber?.toUpperCase() ?? guestNumber(),
      input.firstName,
      input.preferredName,
      input.lastName,
      input.kind,
      input.kind === 'adult' ? 'Leaders' : input.section,
      input.groupName,
      input.position,
      e.feature_photo ? input.photoConsent : 'unknown',
      JSON.stringify(e.feature_dietary ? input.dietary : []),
      input.email,
      trusted ? null : await codeHash(c.env, id, code),
      trusted ? null : addMinutes(now, CODE_MINUTES),
      now,
      trusted ? now : null,
    ),
    auditStatement(c.env.DB, { actor: { type: 'public' }, action: 'registration.request', eventId: e.id, targetType: 'registration_request', targetId: id }),
  ]);
  if (trusted) return c.json(await afterConfirm(c, e, id, input.email));

  try {
    await sendEmail(c.env, {
      to: input.email,
      subject: `Your code for ${e.name}: ${code}`,
      text: `Your code to confirm registering ${input.preferredName || input.firstName} ${input.lastName} for ${e.name} is ${code}\n\nIt expires in ${CODE_MINUTES} minutes. If you didn't ask for this, ignore this email.`,
      html:
        `<p>Your code to confirm registering <strong>${escapeHtml(`${input.preferredName || input.firstName} ${input.lastName}`)}</strong> for ${escapeHtml(e.name)} is</p>` +
        `<p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p>` +
        `<p>It expires in ${CODE_MINUTES} minutes. If you didn't ask for this, ignore this email.</p>`,
    });
  } catch (err) {
    console.error(`Registration code email could not be sent: ${err instanceof EmailSendError ? err.code : 'UNKNOWN'}`);
    throw new ApiError(503, 'email_unavailable', 'The confirmation email could not be sent. Please try again later, or contact the event team.');
  }
  return c.json({ status: 'confirm', requestId: id });
});

publicRegisterRoutes.post('/:code/confirm', async (c) => {
  const e = await eventByCode(c);
  const { requestId, code } = await parseBody(c, confirmRegistrationSchema);
  await limitByIp(c, 'register-confirm');
  const req = await c.env.DB.prepare(
    `SELECT id, contact_email, code_hash, code_expires_at, attempts FROM registration_requests WHERE id = ? AND event_id = ? AND status = 'unconfirmed'`,
  )
    .bind(requestId, e.id)
    .first<{ id: string; contact_email: string; code_hash: string; code_expires_at: string; attempts: number }>();
  const invalid = () => new ApiError(400, 'invalid_code', 'That code is wrong or has expired. Check the email, or fill in the form again for a new code.');
  if (!req || req.attempts >= MAX_ATTEMPTS || req.code_expires_at < nowIso()) throw invalid();
  await c.env.DB.prepare(`UPDATE registration_requests SET attempts = attempts + 1 WHERE id = ?`).bind(req.id).run();
  if (!timingSafeEqualHex(await codeHash(c.env, req.id, code), req.code_hash)) throw invalid();
  const done = await c.env.DB.prepare(
    `UPDATE registration_requests SET status = 'pending', code_hash = NULL, confirmed_at = ? WHERE id = ? AND status = 'unconfirmed'`,
  )
    .bind(nowIso(), req.id)
    .run();
  if (done.meta.changes !== 1) throw invalid();
  return c.json(await afterConfirm(c, e, req.id, req.contact_email));
});

/** A confirmed request: approved straight away if the event allows it, otherwise waiting. */
async function afterConfirm(c: AppContext, e: RegistrationEvent, requestId: string, email: string) {
  let status: 'approved' | 'pending' = 'pending';
  if (e.registration_auto_approve) {
    await approveRequest(c.env, e, requestId, { type: 'system' });
    status = 'approved';
  }
  return { status, requestId, contactToken: await contactToken(c.env, e.id, email) };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

// ---------------------------------------------------------------- event managers

export const registrationRoutes = new Hono<AppEnv>();

async function managedEvent(c: AppContext): Promise<RegistrationEvent> {
  const eventId = c.req.param('eventId')!;
  requirePermission(c, 'roster.edit', { eventId });
  const e = await c.env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).bind(eventId).first<RegistrationEvent>();
  if (!e) throw notFound();
  return e;
}

/** Settings, the public link, counts and requests (waiting first, then the latest decided). */
registrationRoutes.get('/registration', async (c) => {
  const e = await managedEvent(c);
  const [counts, reason, requests] = await Promise.all([
    expectedCount(c.env, e.id),
    closedReason(c.env, e),
    c.env.DB.prepare(
      `SELECT q.id, q.status, q.member_number, q.first_name, q.preferred_name, q.last_name, q.kind, q.section, q.group_name, q.position,
              q.photo_consent, q.dietary, q.contact_email, q.created_at, q.decided_at, q.registration_id,
              EXISTS (SELECT 1 FROM registrations r JOIN people p ON p.id = r.person_id
                       WHERE r.event_id = q.event_id AND p.member_number = q.member_number AND r.status = 'active') AS already,
              (SELECT p.first_name || ' ' || p.last_name FROM people p WHERE p.member_number = q.member_number) AS member_on_file
         FROM registration_requests q
        WHERE q.event_id = ? AND q.status IN ('pending', 'approved', 'declined')
        ORDER BY q.status = 'pending' DESC, COALESCE(q.decided_at, q.created_at) DESC LIMIT 300`,
    )
      .bind(e.id)
      .all<Record<string, string | number | null>>(),
  ]);
  return c.json({
    settings: {
      open: e.registration_open === 1,
      autoApprove: e.registration_auto_approve === 1,
      closesOn: e.registration_closes_on,
      limit: e.registration_limit,
    },
    link: e.registration_code ? `${new URL(c.req.url).origin}/register/${e.registration_code}` : null,
    takingRegistrations: reason === null,
    closedMessage: reason && reason !== 'not_open' ? CLOSED_MESSAGE[reason] : null,
    counts,
    requests: requests.results.map((q) => ({
      id: q.id,
      status: q.status,
      memberNumber: q.member_number,
      guest: String(q.member_number).startsWith('GUEST-'),
      firstName: q.first_name,
      preferredName: q.preferred_name,
      lastName: q.last_name,
      kind: q.kind,
      section: q.section,
      groupName: q.group_name,
      position: q.position,
      photoConsent: q.photo_consent,
      dietary: JSON.parse(String(q.dietary)),
      contactEmail: q.contact_email,
      createdAt: q.created_at,
      decidedAt: q.decided_at,
      registrationId: q.registration_id,
      alreadyRegistered: q.status === 'pending' && q.already === 1,
      // The membership number belongs to someone with a different name on file.
      memberOnFile:
        q.member_on_file && String(q.member_on_file).toLowerCase() !== `${q.first_name} ${q.last_name}`.toLowerCase() ? q.member_on_file : null,
    })),
  });
});

registrationRoutes.patch('/registration', async (c) => {
  const e = await managedEvent(c);
  const user = requireUser(c);
  const input = await parseBody(c, registrationSettingsSchema);
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    values.push(v);
  };
  if (input.open !== undefined) set('registration_open', input.open ? 1 : 0);
  if (input.autoApprove !== undefined) set('registration_auto_approve', input.autoApprove ? 1 : 0);
  if (input.closesOn !== undefined) set('registration_closes_on', input.closesOn);
  if (input.limit !== undefined) set('registration_limit', input.limit);
  // Opening for the first time makes the link; "new link" replaces it.
  if (input.newLink || (input.open && !e.registration_code)) set('registration_code', randomToken(12));
  if (!sets.length) return c.json({ ok: true });
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE events SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...values, nowIso(), e.id),
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: user.userId },
      action: 'registration.settings',
      eventId: e.id,
      targetType: 'event',
      targetId: e.id,
      detail: { fields: Object.keys(input).join(',') },
    }),
  ]);
  return c.json({ ok: true });
});

const requestIdParam = (v: string | undefined) => {
  const parsed = z.uuid().safeParse(v);
  if (!parsed.success) throw notFound();
  return parsed.data;
};

registrationRoutes.post('/registration/requests/:requestId/approve', async (c) => {
  const e = await managedEvent(c);
  const user = requireUser(c);
  if (!isEditable(e.status as EventStatus)) throw conflict('This event is closed. Reopen it to change the roster.');
  const registrationId = await approveRequest(c.env, e, requestIdParam(c.req.param('requestId')), { type: 'user', id: user.userId });
  if (!registrationId) throw notFound();
  return c.json({ registrationId });
});

registrationRoutes.post('/registration/requests/approve-all', async (c) => {
  const e = await managedEvent(c);
  const user = requireUser(c);
  if (!isEditable(e.status as EventStatus)) throw conflict('This event is closed. Reopen it to change the roster.');
  const { results } = await c.env.DB.prepare(`SELECT id FROM registration_requests WHERE event_id = ? AND status = 'pending' ORDER BY created_at`)
    .bind(e.id)
    .all<{ id: string }>();
  for (const r of results) await approveRequest(c.env, e, r.id, { type: 'user', id: user.userId });
  return c.json({ approved: results.length });
});

registrationRoutes.post('/registration/requests/:requestId/decline', async (c) => {
  const e = await managedEvent(c);
  const user = requireUser(c);
  const id = requestIdParam(c.req.param('requestId'));
  const [res] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE registration_requests SET status = 'declined', decided_by = ?, decided_at = ? WHERE id = ? AND event_id = ? AND status = 'pending'`,
    ).bind(user.userId, nowIso(), id, e.id),
    auditStatement(c.env.DB, {
      onlyIfChanged: true,
      actor: { type: 'user', id: user.userId },
      action: 'registration.decline',
      eventId: e.id,
      targetType: 'registration_request',
      targetId: id,
    }),
  ]);
  if (res!.meta.changes !== 1) throw notFound();
  return c.json({ ok: true });
});

/** An event manager adds someone by hand. They join the roster straight away, with a card. */
registrationRoutes.post('/registrations', async (c) => {
  const e = await managedEvent(c);
  const user = requireUser(c);
  if (!isEditable(e.status as EventStatus)) throw conflict('This event is closed. Reopen it to change the roster.');
  const input = await parseBody(c, personEntrySchema);
  const memberNumber = input.memberNumber?.toUpperCase() ?? guestNumber();
  const already = await c.env.DB.prepare(
    `SELECT 1 FROM registrations r JOIN people p ON p.id = r.person_id WHERE r.event_id = ? AND p.member_number = ? AND r.status = 'active'`,
  )
    .bind(e.id, memberNumber)
    .first();
  if (already) throw conflict('Someone with that membership number is already on this event.');
  const registrationId = await addToRoster(
    c.env,
    e.id,
    toImportRow({ ...input, memberNumber, dietary: e.feature_dietary ? input.dietary : [] }),
    user.userId,
    false,
  );
  await auditStatement(c.env.DB, {
    actor: { type: 'user', id: user.userId },
    action: 'registration.add',
    eventId: e.id,
    targetType: 'registration',
    targetId: registrationId,
  }).run();
  return c.json({ registrationId }, 201);
});
