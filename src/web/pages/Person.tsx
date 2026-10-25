import { useTitle } from '../useTitle';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { DietaryEntryInput } from '../../shared/schemas';
import { SECTIONS } from '../../shared/schemas';
import { ApiFailure, api } from '../api';
import { DietaryEditor, describeEntry } from '../components/DietaryEditor';
import { Icon } from '../components/Icon';
import { Field, Loading, Notice, Skeleton, SkeletonHeading, SkeletonList } from '../components/ui';
import type { Card } from '../lanyards/pdf';
import { buildLanyardPdf, downloadPdf } from '../lanyards/pdf';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import { LanyardCard } from './Lanyards';
import { dayInZone, dayLabel, timeInZone, timeRange } from '../../shared/time';

export interface Where {
  site: 'on' | 'off' | 'never' | null;
  siteSince: string | null;
  activities: { key: string; name: string; since: string | null }[];
  lastSeen: { contextName: string; type: 'activity' | 'meal' | 'site'; direction: 'in' | 'out'; at: string } | null;
}

interface PersonData {
  registration: {
    id: string;
    memberNumber: string;
    firstName: string;
    preferredName: string;
    lastName: string;
    displayName: string;
    kind: 'youth' | 'adult';
    section: string;
    groupName: string;
    position: string;
    status: 'active' | 'withdrawn';
    shortCode: string | null;
    photoConsent?: 'yes' | 'no' | 'unknown';
    dietary?: DietaryEntryInput[];
  };
  can: { edit: boolean; editDietary: boolean; cards: boolean };
  where: Where | null;
  bookings: { activityId: string; name: string; startsAt: string | null; endsAt: string | null; selfBooked: boolean }[];
  history: { id: string; at: string; type: 'activity' | 'meal' | 'site'; place: string; direction: 'in' | 'out'; method: string; outcome: string; message: string; by: string }[];
}

/** "Arrived", "Signed out", "Served"… */
export function scanVerb(type: 'activity' | 'meal' | 'site', direction: 'in' | 'out'): string {
  if (type === 'meal') return 'Served';
  if (type === 'site') return direction === 'in' ? 'Arrived' : 'Left';
  return direction === 'in' ? 'Signed in' : 'Signed out';
}

const OUTCOME_TAG: Record<string, { label: string; tone: string } | undefined> = {
  duplicate: { label: 'Repeat, not counted', tone: 'tag' },
  review: { label: 'To check', tone: 'tag tag-warn' },
  rejected: { label: 'Refused', tone: 'tag tag-stop' },
  void: { label: 'Undone', tone: 'tag' },
};

export function WhereNow({ where, tz }: { where: Where; tz: string }) {
  const t = (iso: string | null) => (iso ? timeInZone(iso, tz) : '');
  return (
    <ul className="where">
      {where.site && (
        <li className={`where-${where.site}`}>
          <span className="where-dot" aria-hidden="true" />
          {where.site === 'on' ? `On site since ${t(where.siteSince)}` : where.site === 'off' ? `Left camp at ${t(where.siteSince)}` : 'Not arrived yet'}
        </li>
      )}
      {where.activities.map((a) => (
        <li key={a.key} className="where-activity">
          <span className="where-dot" aria-hidden="true" />
          At {a.name} since {t(a.since)}
        </li>
      ))}
      <li className="where-last">
        {where.lastSeen
          ? `Last scanned: ${where.lastSeen.contextName}, ${scanVerb(where.lastSeen.type, where.lastSeen.direction).toLowerCase()} ${t(where.lastSeen.at)}`
          : 'Not scanned anywhere yet'}
      </li>
    </ul>
  );
}

export function Person() {
  const { event } = useEvent();
  const { registrationId } = useParams();
  const navigate = useNavigate();
  const path = `/events/${event.id}/registrations/${registrationId}`;
  const { data, error, loading, reload } = useApi<PersonData>(path);
  useTitle(data ? `${data.registration.preferredName || data.registration.firstName} ${data.registration.lastName}` : 'Person');
  const [editing, setEditing] = useState(false);
  const [editingDiet, setEditingDiet] = useState<DietaryEntryInput[] | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (ok) setMessage({ tone: 'ok', text: ok });
      await reload();
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data)
    return (
      <Loading label="Loading person">
        <Skeleton width="5rem" height="1rem" className="skeleton-gap" />
        <SkeletonHeading width="13rem" />
        <SkeletonList rows={2} lines={1} aside="none" heading />
        <SkeletonList rows={4} lines={2} aside="none" heading />
      </Loading>
    );
  if (error) return <Notice tone="stop">{error.status === 404 ? 'This person is no longer on the event.' : error.message}</Notice>;
  if (!data) return null;
  const r = data.registration;
  const fullName = `${r.preferredName || r.firstName} ${r.lastName}`;
  const tz = event.timezone;
  const allergy = r.dietary?.some((d) => d.category === 'allergy');

  async function showCard() {
    const res = await api<{ cards: Card[] }>(`/events/${event.id}/credentials/print`, { body: { registrationIds: [r.id] } });
    setCard(res.cards[0] ?? null);
  }

  // History grouped by day, newest first.
  const days = new Map<string, PersonData['history']>();
  for (const h of data.history) {
    const day = new Date(h.at).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
    days.set(day, [...(days.get(day) ?? []), h]);
  }

  return (
    <div className="person">
      <Link to=".." relative="path" className="back-link">
        <Icon name="back" size={18} /> People
      </Link>
      <div className="person-head">
        <h2 className="person-name">{fullName}</h2>
        <p className="lede flush">
          {r.groupName}
          {r.groupName && ', '}
          {r.kind === 'adult' ? r.position || 'Leader' : r.section}, member {r.memberNumber}
        </p>
        <div className="chip-row section-gap-sm">
          {r.status === 'withdrawn' && <span className="tag tag-stop">Withdrawn</span>}
          {r.photoConsent === 'no' && <span className="tag tag-stop">No photos</span>}
          {r.photoConsent === 'unknown' && <span className="tag tag-warn">Photo consent not recorded</span>}
          {allergy && <span className="tag tag-stop">Allergy</span>}
        </div>
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      {data.where && (
        <section className="list-section">
          <h3 className="list-heading">Right now</h3>
          <WhereNow where={data.where} tz={tz} />
        </section>
      )}

      {data.bookings.length > 0 && (
        <section className="list-section">
          <h3 className="list-heading">Signed up for</h3>
          <ul className="list">
            {data.bookings.map((b) => (
              <li key={b.activityId} className="list-row">
                <span className="list-main">
                  <strong>{b.name}</strong>
                  <span>
                    {b.startsAt ? `${dayLabel(dayInZone(b.startsAt, tz))}, ${timeRange(b.startsAt, b.endsAt, tz)}` : 'Any time'}
                    {b.selfBooked ? '' : ', booked by leaders'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="list-section">
        <div className="section-row">
          <h3 className="list-heading">Details</h3>
          {data.can.edit && !editing && (
            <button className="btn-link" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
        {editing ? (
          <DetailsForm
            r={r}
            busy={busy}
            onCancel={() => setEditing(false)}
            onSave={(body) =>
              void act(async () => {
                await api(path, { method: 'PATCH', body });
                setEditing(false);
              }, 'Details saved.')
            }
          />
        ) : (
          <dl className="list detail-list">
            <div>
              <dt>Name</dt>
              <dd>
                {r.firstName} {r.lastName}
                {r.preferredName && ` (goes by ${r.preferredName})`}
              </dd>
            </div>
            <div>
              <dt>Membership number</dt>
              <dd>{r.memberNumber}</dd>
            </div>
            <div>
              <dt>{r.kind === 'adult' ? 'Leader' : 'Youth'}</dt>
              <dd>{r.kind === 'adult' ? r.position || 'Leader' : r.section}</dd>
            </div>
            <div>
              <dt>Group</dt>
              <dd>{r.groupName || '—'}</dd>
            </div>
            {r.photoConsent && (
              <div>
                <dt>Photos</dt>
                <dd>{r.photoConsent === 'yes' ? 'OK' : r.photoConsent === 'no' ? 'No photos' : 'Not recorded'}</dd>
              </div>
            )}
          </dl>
        )}
      </section>

      {r.dietary && (
        <section className="list-section">
          <div className="section-row">
            <h3 className="list-heading">Dietary needs</h3>
            {data.can.editDietary && editingDiet === null && (
              <button className="btn-link" onClick={() => setEditingDiet(r.dietary ?? [])}>
                Edit
              </button>
            )}
          </div>
          {editingDiet !== null ? (
            <div className="list-pad">
              <DietaryEditor value={editingDiet} onChange={setEditingDiet} labelPrefix={fullName} />
              <div className="actions">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api(`${path}/dietary`, { method: 'PUT', body: { entries: editingDiet } });
                      setEditingDiet(null);
                    }, 'Dietary needs saved.')
                  }
                >
                  Save
                </button>
                <button className="btn btn-secondary" onClick={() => setEditingDiet(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : r.dietary.length === 0 ? (
            <p className="field-hint">None recorded.</p>
          ) : (
            <ul className="chips">
              {r.dietary.map((d, i) => (
                <li key={i} className={d.category === 'allergy' ? 'chip chip-alert' : 'chip'}>
                  {describeEntry(d)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data.can.cards && (
        <section className="list-section">
          <h3 className="list-heading">Lanyard</h3>
          {!r.shortCode ? (
            <div className="list-pad">
              <p className="field-hint">No card issued yet.</p>
              {r.status === 'active' && (
                <button
                  className="btn btn-small"
                  disabled={busy}
                  onClick={() =>
                    void act(() => api(`/events/${event.id}/credentials/issue`, { body: { mode: 'missing', registrationIds: [r.id] } }), 'Card issued.')
                  }
                >
                  Issue a card
                </button>
              )}
            </div>
          ) : card ? (
            <div className="person-card">
              <div className="person-card-preview">
                <LanyardCard card={card} eventName={event.name} />
              </div>
              <div className="actions flush-top">
                <button
                  className="btn btn-small"
                  onClick={async () => downloadPdf(await buildLanyardPdf([card], 'lanyard', event.name), `${fullName.replace(/\W+/g, '-')}-lanyard.pdf`)}
                >
                  <Icon name="download" size={18} /> Download PDF
                </button>
                <button
                  className="btn btn-secondary btn-small"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Replace ${fullName}'s card? The current one stops working straight away.`)) return;
                    void act(async () => {
                      await api(`/events/${event.id}/credentials/issue`, { body: { mode: 'replace', registrationIds: [r.id] } });
                      setCard(null);
                    }, 'New card issued. Show it again to print it.');
                  }}
                >
                  Replace card
                </button>
              </div>
            </div>
          ) : (
            <div className="list-pad">
              <p className="flush">
                Card <strong>{r.shortCode}</strong>
              </p>
              <button className="btn btn-secondary btn-small section-gap-sm" onClick={() => void showCard().catch(() => setMessage({ tone: 'stop', text: 'Could not load the card.' }))}>
                Show lanyard
              </button>
            </div>
          )}
        </section>
      )}

      <section className="list-section">
        <h3 className="list-heading">Where they've been</h3>
        {data.history.length === 0 ? (
          <p className="field-hint">No scans yet.</p>
        ) : (
          [...days].map(([day, items]) => (
            <div key={day} className="history-day">
              <p className="history-date">{day}</p>
              <ol className="list history">
                {items.map((h) => {
                  const tag = OUTCOME_TAG[h.outcome];
                  return (
                    <li key={h.id} className={h.outcome === 'accepted' ? 'history-row' : 'history-row is-faded'}>
                      <span className="history-time">{timeInZone(h.at, tz)}</span>
                      <span className="list-main">
                        <strong>
                          {scanVerb(h.type, h.direction)}: {h.place}
                        </strong>
                        <span>
                          {h.by && `by ${h.by}`}
                          {h.method === 'manual' && ', entered by hand'}
                          {h.method === 'code' && ', typed code'}
                        </span>
                      </span>
                      {tag && <span className={tag.tone}>{tag.label}</span>}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))
        )}
      </section>

      {data.can.edit && (
        <section className="list-section danger-zone">
          <h3 className="list-heading">Remove from event</h3>
          <div className="actions flush-top">
            <button
              className="btn btn-secondary btn-small"
              disabled={busy}
              onClick={() =>
                void act(
                  () => api(path, { method: 'PATCH', body: { status: r.status === 'active' ? 'withdrawn' : 'active' } }),
                  r.status === 'active' ? `${fullName} is withdrawn. Their card no longer scans.` : `${fullName} is back on the event.`,
                )
              }
            >
              {r.status === 'active' ? 'Withdraw' : 'Restore'}
            </button>
            <button
              className="btn btn-danger btn-small"
              disabled={busy}
              onClick={async () => {
                const scans = data.history.length;
                if (
                  !window.confirm(
                    `Delete ${fullName} from ${event.name}? Their card, dietary details${scans ? ` and ${scans} scan${scans === 1 ? '' : 's'}` : ''} are deleted too. This can't be undone. To keep the records, use Withdraw instead.`,
                  )
                )
                  return;
                try {
                  await api(path, { method: 'DELETE' });
                  navigate('..', { relative: 'path', replace: true });
                } catch (err) {
                  setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
                }
              }}
            >
              Delete
            </button>
          </div>
          <p className="field-hint">Withdraw keeps their records and stops their card. Delete removes them completely.</p>
        </section>
      )}
    </div>
  );
}

function DetailsForm({
  r,
  busy,
  onSave,
  onCancel,
}: {
  r: PersonData['registration'];
  busy: boolean;
  onSave: (body: object) => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState({
    firstName: r.firstName,
    preferredName: r.preferredName,
    lastName: r.lastName,
    memberNumber: r.memberNumber,
    kind: r.kind,
    section: r.section,
    groupName: r.groupName,
    position: r.position,
    photoConsent: r.photoConsent,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  function submit(e: FormEvent) {
    e.preventDefault();
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== (r as unknown as Record<string, unknown>)[k]) body[k] = v;
    onSave(body);
  }
  return (
    <form onSubmit={submit} className="list-pad" noValidate>
      <div className="row">
        <Field id="p-first" label="First name">
          <input id="p-first" className="input" value={f.firstName} onChange={set('firstName')} />
        </Field>
        <Field id="p-last" label="Last name">
          <input id="p-last" className="input" value={f.lastName} onChange={set('lastName')} />
        </Field>
      </div>
      <div className="row">
        <Field id="p-pref" label="Goes by" hint="Shown on their lanyard instead of their first name.">
          <input id="p-pref" className="input" value={f.preferredName} onChange={set('preferredName')} />
        </Field>
        <Field id="p-member" label="Membership number">
          <input id="p-member" className="input" value={f.memberNumber} onChange={set('memberNumber')} />
        </Field>
      </div>
      <div className="row">
        <Field id="p-kind" label="Youth or leader">
          <select id="p-kind" className="input" value={f.kind} onChange={set('kind')}>
            <option value="youth">Youth</option>
            <option value="adult">Leader</option>
          </select>
        </Field>
        <Field id="p-section" label="Section">
          <select id="p-section" className="input" value={f.section} onChange={set('section')}>
            {SECTIONS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field id="p-group" label="Group">
        <input id="p-group" className="input" value={f.groupName} onChange={set('groupName')} />
      </Field>
      {f.kind === 'adult' && (
        <Field id="p-position" label="Position">
          <input id="p-position" className="input" value={f.position} onChange={set('position')} />
        </Field>
      )}
      {f.photoConsent !== undefined && (
        <Field id="p-photo" label="Photos">
          <select id="p-photo" className="input" value={f.photoConsent} onChange={set('photoConsent')}>
            <option value="yes">OK to photograph</option>
            <option value="no">No photos</option>
            <option value="unknown">Not recorded</option>
          </select>
        </Field>
      )}
      <div className="actions">
        <button className="btn" disabled={busy}>
          Save details
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
