import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import type { DietaryEntryInput } from '../../shared/schemas';
import { ApiFailure, api } from '../api';
import { describeEntry } from '../components/DietaryEditor';
import { Icon } from '../components/Icon';
import { EMPTY_PERSON, PersonFields, personBody, personReady } from '../components/PersonFields';
import type { PersonForm } from '../components/PersonFields';
import { QrCode } from '../components/QrCode';
import { Field, Loading, Notice } from '../components/ui';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';

interface RequestRow {
  id: string;
  status: 'pending' | 'approved' | 'declined';
  memberNumber: string;
  guest: boolean;
  firstName: string;
  preferredName: string;
  lastName: string;
  kind: 'youth' | 'adult';
  section: string;
  groupName: string;
  position: string;
  photoConsent: 'yes' | 'no' | 'unknown';
  dietary: DietaryEntryInput[];
  contactEmail: string;
  createdAt: string;
  decidedAt: string | null;
  registrationId: string | null;
  alreadyRegistered: boolean;
  memberOnFile: string | null;
}

export interface RegistrationData {
  settings: { open: boolean; autoApprove: boolean; closesOn: string | null; limit: number | null };
  link: string | null;
  takingRegistrations: boolean;
  closedMessage: string | null;
  counts: { registered: number; waiting: number };
  requests: RequestRow[];
}

const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Adelaide' });

/** Event managers: the public registration page's settings, link and incoming requests. */
export function Registration() {
  const { event } = useEvent();
  const path = `/events/${event.id}/registration`;
  const { data, error, loading, reload } = useApi<RegistrationData>(path);
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function act(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      setMessage({ tone: 'ok', text: typeof result === 'string' ? result : ok });
      await reload();
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }
  const save = (body: object, ok: string) => act(() => api(path, { method: 'PATCH', body }), ok);

  if (loading && !data) return <Loading />;
  if (error) return <Notice tone="stop">{error.message}</Notice>;
  if (!data) return null;
  const s = data.settings;
  const pending = data.requests.filter((r) => r.status === 'pending');
  const decided = data.requests.filter((r) => r.status !== 'pending');
  const expected = data.counts.registered + data.counts.waiting;

  return (
    <div className="registration">
      <Link to=".." relative="path" className="back-link no-print">
        <Icon name="back" size={18} /> People
      </Link>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <div className="tiles tiles-2 no-print">
        <div className="tile">
          <strong>{data.counts.registered}</strong>
          <span>Registered</span>
        </div>
        <div className="tile">
          <strong>{data.counts.waiting}</strong>
          <span>Waiting for you</span>
        </div>
      </div>
      {s.limit && (
        <p className="field-hint no-print">
          {expected} of {s.limit} places taken{expected >= s.limit ? '. Full: the page is not taking more.' : '.'}
        </p>
      )}

      <section className="list-section no-print">
        <h2 className="list-heading">Registration page</h2>
        <div className="list-pad">
          <label className="check check-compact">
            <input type="checkbox" checked={s.open} disabled={busy} onChange={(e) => void save({ open: e.target.checked }, e.target.checked ? 'Registration is open.' : 'Registration is closed.')} />
            <div>
              <strong>Open for registrations</strong>
              <span>
                {s.open
                  ? data.takingRegistrations
                    ? 'Anyone with the link can register someone.'
                    : (data.closedMessage ?? 'Not taking registrations right now.')
                  : 'Turn on to get a link and QR code to share.'}
              </span>
            </div>
          </label>
          <label className="check check-compact">
            <input
              type="checkbox"
              checked={s.autoApprove}
              disabled={busy}
              onChange={(e) => void save({ autoApprove: e.target.checked }, e.target.checked ? 'New registrations join the roster straight away.' : 'New registrations wait for approval.')}
            />
            <div>
              <strong>Approve automatically</strong>
              <span>Off: each registration waits for an event manager. On: they join the roster as soon as their email is confirmed.</span>
            </div>
          </label>
          <LimitsForm closesOn={s.closesOn} limit={s.limit} busy={busy} onSave={(body) => void save(body, 'Saved.')} />
        </div>
      </section>

      {data.link && (
        <section className="list-section">
          <h2 className="list-heading no-print">Share it</h2>
          <div className="list-pad share-box">
            <div className="poster">
              <p className="poster-title">Register for {event.name}</p>
              <div className="poster-qr">
                <QrCode value={data.link} size="100%" label={`QR code for registering for ${event.name}`} />
              </div>
              <p className="poster-link">{data.link.replace(/^https?:\/\//, '')}</p>
            </div>
            <div className="share-actions no-print">
              <input className="input input-compact link-share-input" readOnly value={data.link} onFocus={(e) => e.target.select()} aria-label="Registration link" />
              <div className="actions flush-top">
                <button className="btn btn-small" onClick={() => void navigator.clipboard?.writeText(data.link!).then(() => setCopied(true))}>
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                {typeof navigator.share === 'function' && (
                  <button className="btn btn-secondary btn-small" onClick={() => void navigator.share({ title: `Register for ${event.name}`, url: data.link! }).catch(() => undefined)}>
                    Share…
                  </button>
                )}
                <button className="btn btn-secondary btn-small" onClick={() => window.print()}>
                  <Icon name="print" size={18} /> Print poster
                </button>
                <button
                  className="btn-link"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Make a new link? The current link and printed posters stop working.')) void save({ newLink: true }, 'New link made. The old one no longer works.');
                  }}
                >
                  New link
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="list-section no-print">
        <div className="section-row">
          <h2 className="list-heading">Waiting for approval</h2>
          {pending.length > 1 && (
            <button className="btn-link" disabled={busy} onClick={() => void act(() => api(`${path}/requests/approve-all`, { body: {} }), `Approved ${pending.length} people.`)}>
              Approve all
            </button>
          )}
        </div>
        {pending.length === 0 ? (
          <p className="field-hint">Nothing waiting.</p>
        ) : (
          <ul className="list">
            {pending.map((r) => (
              <RequestItem key={r.id} r={r} busy={busy} onApprove={() => void act(() => api(`${path}/requests/${r.id}/approve`, { body: {} }), `${r.firstName} ${r.lastName} is on the roster and has a lanyard card.`)} onDecline={() => {
                if (window.confirm(`Decline ${r.firstName} ${r.lastName}? They are not told automatically.`)) void act(() => api(`${path}/requests/${r.id}/decline`, { body: {} }), 'Declined.');
              }} />
            ))}
          </ul>
        )}
      </section>

      {decided.length > 0 && (
        <details className="section-gap no-print">
          <summary>Recently decided ({decided.length})</summary>
          <ul className="list">
            {decided.map((r) => (
              <li key={r.id} className="list-row">
                <span className="list-main">
                  <strong>
                    {r.registrationId ? <Link to={`../${r.registrationId}`} relative="path">{`${r.preferredName || r.firstName} ${r.lastName}`}</Link> : `${r.preferredName || r.firstName} ${r.lastName}`}
                  </strong>
                  <span>{r.decidedAt ? when(r.decidedAt) : ''}</span>
                </span>
                <span className={r.status === 'approved' ? 'tag tag-now' : 'tag'}>{r.status === 'approved' ? 'Approved' : 'Declined'}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RequestItem({ r, busy, onApprove, onDecline }: { r: RequestRow; busy: boolean; onApprove: () => void; onDecline: () => void }) {
  return (
    <li className="request">
      <div className="list-main">
        <strong>
          {r.preferredName || r.firstName} {r.lastName}
          {r.preferredName && <span className="field-hint"> ({r.firstName})</span>}
        </strong>
        <span>
          {r.kind === 'adult' ? r.position || 'Leader or helper' : r.section}
          {r.groupName && `, ${r.groupName}`}
          {r.guest ? ', not a member' : `, member ${r.memberNumber}`}
        </span>
        <span>
          {r.contactEmail} · {when(r.createdAt)}
        </span>
      </div>
      <div className="chip-row">
        {r.alreadyRegistered && <span className="tag tag-warn">Already on the roster</span>}
        {r.memberOnFile && <span className="tag tag-stop">Number belongs to {r.memberOnFile}</span>}
        {r.photoConsent === 'no' && <span className="tag tag-stop">No photos</span>}
        {r.dietary.map((d, i) => (
          <span key={i} className={d.category === 'allergy' ? 'tag tag-stop' : 'tag'}>
            {describeEntry(d)}
          </span>
        ))}
      </div>
      <div className="actions flush-top">
        <button className="btn btn-small" disabled={busy} onClick={onApprove}>
          Approve
        </button>
        <button className="btn btn-secondary btn-small" disabled={busy} onClick={onDecline}>
          Decline
        </button>
      </div>
    </li>
  );
}

function LimitsForm({ closesOn, limit, busy, onSave }: { closesOn: string | null; limit: number | null; busy: boolean; onSave: (body: object) => void }) {
  const [date, setDate] = useState(closesOn ?? '');
  const [max, setMax] = useState(limit ? String(limit) : '');
  const dirty = date !== (closesOn ?? '') || max !== (limit ? String(limit) : '');
  return (
    <form
      className="row section-gap-sm limits"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSave({ closesOn: date || null, limit: max ? Number(max) : null });
      }}
    >
      <Field id="reg-closes" label="Last day to register" hint="Optional">
        <input id="reg-closes" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field id="reg-limit" label="Most people" hint="Optional. Counts everyone on the roster.">
        <input id="reg-limit" className="input" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} />
      </Field>
      {dirty && (
        <div className="actions flush-top">
          <button className="btn btn-small" disabled={busy}>
            Save
          </button>
        </div>
      )}
    </form>
  );
}

/** Event managers add one person by hand; they go straight on the roster with a card. */
export function AddPerson() {
  const { event } = useEvent();
  const navigate = useNavigate();
  const [person, setPerson] = useState<PersonForm>(EMPTY_PERSON);
  const [error, setError] = useState<{ text: string; fields: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ registrationId: string }>(`/events/${event.id}/registrations`, { body: personBody(person) });
      navigate(`../${res.registrationId}`, { relative: 'path', replace: true });
    } catch (err) {
      setError({ text: err instanceof ApiFailure ? err.message : 'Something went wrong.', fields: err instanceof ApiFailure ? err.fieldErrors() : {} });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="narrow">
      <Link to=".." relative="path" className="back-link">
        <Icon name="back" size={18} /> People
      </Link>
      <h2>Add a person</h2>
      <p className="lede">They join the roster straight away and get a lanyard card. For lots of people, import from MyScout instead.</p>
      {error && <Notice tone="stop">{error.text}</Notice>}
      <PersonFields
        value={person}
        onChange={setPerson}
        askPhotos={event.features.photo}
        askDietary={event.features.dietary}
        errors={error?.fields}
        youthLabel="Youth"
        adultLabel="Leader or helper"
      />
      <div className="actions">
        <button className="btn" disabled={busy || !personReady(person, false)}>
          {busy ? 'Adding…' : 'Add to event'}
        </button>
      </div>
    </form>
  );
}
