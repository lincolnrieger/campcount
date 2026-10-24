import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { ApiFailure, api } from '../api';
import { Field, Loading, Notice } from '../components/ui';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import { deleteContext } from '../confirmDelete';
import { matchesSearch } from '../../shared/search';
import type { Registration } from './Roster';
import { clockInZone, dayInZone, dayLabel, eventDays, timeInZone, zonedIso } from '../../shared/time';

export interface Activity {
  id: string;
  name: string;
  description: string;
  location: string;
  instructions: string;
  startsAt: string | null;
  endsAt: string | null;
  capacity: number | null;
  capacityPolicy: 'warn' | 'block';
  trackSignOut: boolean;
  allowRepeat: boolean;
  bookingRequired: boolean;
  signupOpen: boolean;
  booked: number;
  status: 'active' | 'cancelled';
}

interface FormState {
  name: string;
  location: string;
  instructions: string;
  capacity: string;
  capacityPolicy: 'warn' | 'block';
  trackSignOut: boolean;
  allowRepeat: boolean;
  signupOpen: boolean;
  bookingRequired: boolean;
  day: string; // '' = any time
  start: string;
  end: string;
}

const EMPTY: FormState = {
  name: '',
  location: '',
  instructions: '',
  capacity: '',
  capacityPolicy: 'warn',
  trackSignOut: true,
  allowRepeat: true,
  signupOpen: false,
  bookingRequired: false,
  day: '',
  start: '09:00',
  end: '10:30',
};

const addMinutes = (hhmm: string, minutes: number) => {
  const total = Math.min(23 * 60 + 59, Math.max(0, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + minutes));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const minutesBetween = (a: string, b: string) => Number(b.slice(0, 2)) * 60 + Number(b.slice(3)) - (Number(a.slice(0, 2)) * 60 + Number(a.slice(3)));

function toForm(a: Activity, tz: string): FormState {
  return {
    name: a.name,
    location: a.location,
    instructions: a.instructions,
    capacity: a.capacity ? String(a.capacity) : '',
    capacityPolicy: a.capacityPolicy,
    trackSignOut: a.trackSignOut,
    allowRepeat: a.allowRepeat,
    signupOpen: a.signupOpen,
    bookingRequired: a.bookingRequired,
    day: a.startsAt ? dayInZone(a.startsAt, tz) : '',
    start: a.startsAt ? clockInZone(a.startsAt, tz) : EMPTY.start,
    end: a.endsAt ? clockInZone(a.endsAt, tz) : a.startsAt ? addMinutes(clockInZone(a.startsAt, tz), 90) : EMPTY.end,
  };
}

/** The next session of an activity: same settings, starting when this one ends. */
function nextSession(a: Activity, tz: string): FormState {
  const f = toForm(a, tz);
  const length = a.startsAt && a.endsAt ? Math.max(15, minutesBetween(f.start, f.end)) : 90;
  const start = a.endsAt ? f.end : f.start;
  return { ...f, start, end: addMinutes(start, length) };
}

function ActivityForm({
  id,
  initial,
  submitLabel,
  onSave,
  onCancel,
}: {
  id: string;
  initial: FormState;
  submitLabel: string;
  onSave: (body: object) => Promise<void>;
  onCancel?: () => void;
}) {
  const { event } = useEvent();
  const days = eventDays(event.startsOn, event.endsOn);
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timed = form.day !== '';
  const badTimes = timed && form.end !== '' && minutesBetween(form.start, form.end) <= 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await onSave({
        name: form.name,
        location: form.location,
        instructions: form.instructions,
        capacity: form.capacity ? Number(form.capacity) : null,
        capacityPolicy: form.capacityPolicy,
        trackSignOut: form.trackSignOut,
        allowRepeat: form.allowRepeat,
        signupOpen: form.signupOpen,
        bookingRequired: form.bookingRequired,
        startsAt: timed ? zonedIso(form.day, form.start, event.timezone) : null,
        endsAt: timed && form.end ? zonedIso(form.day, form.end, event.timezone) : null,
      });
      if (submitLabel === 'Add activity') setForm({ ...EMPTY, day: form.day, start: form.end || form.start, end: addMinutes(form.end || form.start, 90) });
    } catch (err) {
      if (err instanceof ApiFailure) {
        setErrors(err.fieldErrors());
        setFailure(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="narrow activity-form">
      {failure && <Notice tone="stop">{failure}</Notice>}
      <Field id={`${id}-name`} label="Activity name" error={errors.name}>
        <input id={`${id}-name`} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>

      <div className="field">
        <span className="field-legend" id={`${id}-when`}>
          When
        </span>
        <div className="chip-row" role="radiogroup" aria-labelledby={`${id}-when`}>
          <button type="button" role="radio" aria-checked={!timed} className="chip-toggle" onClick={() => setForm({ ...form, day: '' })}>
            All camp
          </button>
          {days.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={form.day === d} className="chip-toggle" onClick={() => setForm({ ...form, day: d })}>
              {dayLabel(d)}
            </button>
          ))}
        </div>
        {!timed && <span className="field-hint">Runs the whole camp, with no set time.</span>}
      </div>
      {timed && (
        <div className="row time-row">
          <Field id={`${id}-start`} label="Starts">
            <input
              id={`${id}-start`}
              className="input input-time"
              type="time"
              value={form.start}
              onChange={(e) => {
                const length = form.end ? minutesBetween(form.start, form.end) : 90;
                setForm({ ...form, start: e.target.value, end: form.end ? addMinutes(e.target.value, Math.max(15, length)) : '' });
              }}
            />
          </Field>
          <Field id={`${id}-end`} label="Ends" hint="Optional" error={badTimes ? 'Must be after the start' : undefined}>
            <input id={`${id}-end`} className="input input-time" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          </Field>
        </div>
      )}

      <div className="row">
        <Field id={`${id}-loc`} label="Location">
          <input id={`${id}-loc`} className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
        <Field id={`${id}-cap`} label="Capacity" hint="Leave blank for no limit">
          <input
            id={`${id}-cap`}
            className="input"
            inputMode="numeric"
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
      </div>
      <Field id={`${id}-ins`} label="Instructions for leaders" hint="Shown on the activity's scanning screen.">
        <textarea id={`${id}-ins`} className="input" rows={2} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={form.trackSignOut} onChange={(e) => setForm({ ...form, trackSignOut: e.target.checked })} />
        <div>
          <strong>Sign people out as well as in</strong>
          <span>Shows who is at the activity right now. Needed for capacity limits.</span>
        </div>
      </label>
      <label className="check">
        <input type="checkbox" checked={form.allowRepeat} onChange={(e) => setForm({ ...form, allowRepeat: e.target.checked })} />
        <div>
          <strong>Allow people to do it more than once</strong>
          <span>If off, a second visit is flagged as already done.</span>
        </div>
      </label>
      {event.features.selfSignup && (
        <>
          <label className="check">
            <input type="checkbox" checked={form.signupOpen} onChange={(e) => setForm({ ...form, signupOpen: e.target.checked })} />
            <div>
              <strong>People can sign up</strong>
              <span>Shows on the sign-up screen and session posters. The capacity is the number of places.</span>
            </div>
          </label>
          <label className="check">
            <input type="checkbox" checked={form.bookingRequired} onChange={(e) => setForm({ ...form, bookingRequired: e.target.checked })} />
            <div>
              <strong>Check bookings at the scanner</strong>
              <span>The leader sees a warning when someone who hasn't signed up is scanned in.</span>
            </div>
          </label>
        </>
      )}
      {form.capacity && (
        <label className="check">
          <input
            type="checkbox"
            checked={form.capacityPolicy === 'block'}
            onChange={(e) => setForm({ ...form, capacityPolicy: e.target.checked ? 'block' : 'warn' })}
          />
          <div>
            <strong>Refuse sign-ins when full</strong>
            <span>If off, the leader sees a warning but the sign-in is still recorded.</span>
          </div>
        </label>
      )}
      <div className="actions">
        <button className="btn" disabled={busy || !form.name.trim() || badTimes}>
          {busy ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function Activities() {
  const { event, can } = useEvent();
  const { data, error, loading, reload } = useApi<{ activities: Activity[] }>(`/events/${event.id}/activities`);
  // "edit:<id>" or "copy:<id>" (a new session of that activity).
  const [open, setOpen] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const manage = can('activities.manage') && (event.status === 'draft' || event.status === 'open');
  const tz = event.timezone;
  const days = eventDays(event.startsOn, event.endsOn);

  if (loading && !data) return <Loading />;
  if (error) return <Notice tone="stop">{error.message}</Notice>;
  const activities = data?.activities ?? [];
  if (!can('activities.manage')) return <LeaderActivities activities={activities} />;
  const dayOf = (a: Activity) => (a.startsAt ? dayInZone(a.startsAt, tz) : null);
  const groups = [null, ...days, 'other']
    .map((d) => ({
      day: d,
      items: activities
        .filter((a) => (d === 'other' ? dayOf(a) !== null && !days.includes(dayOf(a)!) : dayOf(a) === d))
        .sort((x, y) => (x.startsAt ?? '').localeCompare(y.startsAt ?? '') || x.name.localeCompare(y.name)),
    }))
    .filter((g) => g.items.length > 0);

  async function patch(a: Activity, body: object) {
    try {
      await api(`/events/${event.id}/activities/${a.id}`, { method: 'PATCH', body });
      setFailure(null);
      await reload();
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err.message : 'Something went wrong.');
    }
  }

  return (
    <>
      {failure && <Notice tone="stop">{failure}</Notice>}
      {activities.length === 0 ? (
        <div className="empty">
          <p>
            <strong>No activities yet.</strong>
          </p>
          <p className="lede">Add each activity with its day and time. Run one several times? Add it once, then use Add session.</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.day ?? 'all'} className="list-section">
            <h2 className="list-heading">{g.day === null ? 'All camp' : g.day === 'other' ? 'Outside the event dates' : dayLabel(g.day, 'long')}</h2>
            <ul className="list">
              {g.items.map((a) => (
                <li key={a.id} className={a.status === 'cancelled' ? 'is-muted' : undefined}>
                  {open === `edit:${a.id}` ? (
                    <div className="list-pad-inline">
                      <ActivityForm
                        id={a.id}
                        initial={toForm(a, tz)}
                        submitLabel="Save activity"
                        onCancel={() => setOpen(null)}
                        onSave={async (body) => {
                          await api(`/events/${event.id}/activities/${a.id}`, { method: 'PATCH', body });
                          setOpen(null);
                          await reload();
                        }}
                      />
                    </div>
                  ) : (
                    <div className="list-row activity-row">
                      {a.startsAt && (
                        <span className="activity-time">
                          <strong>{timeInZone(a.startsAt, tz)}</strong>
                          {a.endsAt && <span>{timeInZone(a.endsAt, tz)}</span>}
                        </span>
                      )}
                      <span className="list-main">
                        <strong>{a.name}</strong>
                        <span>
                          {[
                            a.status === 'cancelled' ? 'Cancelled' : null,
                            a.location || null,
                            a.trackSignOut ? 'In and out' : 'Sign-in only',
                            a.capacity ? `${a.capacityPolicy === 'block' ? 'max' : 'aim for'} ${a.capacity}` : null,
                            a.allowRepeat ? null : 'once each',
                            a.signupOpen ? `${a.booked}${a.capacity ? ` of ${a.capacity}` : ''} signed up` : a.booked ? `${a.booked} booked` : null,
                          ]
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      </span>
                      {manage && (
                        <span className="row-actions">
                          <Link className="btn-link" to={a.id}>
                            Roster<span className="visually-hidden"> for {a.name}</span>
                          </Link>
                          <button className="btn-link" onClick={() => setOpen(`edit:${a.id}`)}>
                            Edit<span className="visually-hidden"> {a.name}</span>
                          </button>
                          <button className="btn-link" onClick={() => setOpen(`copy:${a.id}`)}>
                            Add session<span className="visually-hidden"> of {a.name}</span>
                          </button>
                          {(a.signupOpen || a.booked > 0) && (
                            <button className="btn-link" aria-expanded={open === `bookings:${a.id}`} onClick={() => setOpen(open === `bookings:${a.id}` ? null : `bookings:${a.id}`)}>
                              Bookings<span className="visually-hidden"> for {a.name}</span>
                            </button>
                          )}
                          <button className="btn-link" onClick={() => void patch(a, { status: a.status === 'active' ? 'cancelled' : 'active' })}>
                            {a.status === 'active' ? 'Cancel' : 'Restore'}
                            <span className="visually-hidden"> {a.name}</span>
                          </button>
                          <button
                            className="btn-link text-stop"
                            onClick={async () => {
                              try {
                                if (await deleteContext(event.id, 'activities', a.id, a.name)) await reload();
                              } catch (err) {
                                setFailure(err instanceof ApiFailure ? err.message : 'Something went wrong.');
                              }
                            }}
                          >
                            Delete<span className="visually-hidden"> {a.name}</span>
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                  {open === `bookings:${a.id}` && <Bookings activity={a} onChange={() => void reload()} />}
                  {open === `copy:${a.id}` && (
                    <div className="list-pad-inline session-form">
                      <p className="field-legend">Another session of {a.name}</p>
                      <ActivityForm
                        id={`copy-${a.id}`}
                        initial={nextSession(a, tz)}
                        submitLabel="Add session"
                        onCancel={() => setOpen(null)}
                        onSave={async (body) => {
                          await api(`/events/${event.id}/activities`, { body });
                          setOpen(null);
                          await reload();
                        }}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {manage && (
        <section className="section-gap">
          <h2>Add an activity</h2>
          <ActivityForm
            id="new"
            initial={EMPTY}
            submitLabel="Add activity"
            onSave={async (body) => {
              await api(`/events/${event.id}/activities`, { body });
              await reload();
            }}
          />
        </section>
      )}
    </>
  );
}

/** Who's booked on a session; the event team can add or remove people (the place limit doesn't apply to them). */
function Bookings({ activity, onChange }: { activity: Activity; onChange: () => void }) {
  const { event } = useEvent();
  const path = `/events/${event.id}/activities/${activity.id}/bookings`;
  const list = useApi<{ bookings: { registrationId: string; name: string; groupName: string; source: string }[] }>(path);
  const roster = useApi<{ registrations: Registration[] }>(`/events/${event.id}/registrations`);
  const [q, setQ] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const bookedIds = new Set(list.data?.bookings.map((b) => b.registrationId));
  const matches = q.trim()
    ? (roster.data?.registrations ?? [])
        .filter((r) => r.status === 'active' && !bookedIds.has(r.id) && matchesSearch(q, `${r.preferredName || r.firstName} ${r.lastName}`, r.memberNumber))
        .slice(0, 6)
    : [];

  async function change(action: () => Promise<unknown>) {
    try {
      await action();
      setFailure(null);
      setQ('');
      await list.reload();
      onChange();
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err.message : 'Something went wrong.');
    }
  }

  return (
    <div className="list-pad-inline bookings">
      {failure && <Notice tone="stop">{failure}</Notice>}
      {list.loading && !list.data && <Loading />}
      {list.data && list.data.bookings.length === 0 && <p className="field-hint">No one has signed up yet.</p>}
      {list.data && list.data.bookings.length > 0 && (
        <ul className="booking-list">
          {list.data.bookings.map((b) => (
            <li key={b.registrationId}>
              <span>
                <strong>{b.name}</strong> <span className="field-hint">{b.groupName}{b.source === 'manual' ? ', added by leaders' : ''}</span>
              </span>
              <button className="btn-link text-stop" onClick={() => void change(() => api(`${path}/${b.registrationId}`, { method: 'DELETE' }))}>
                Remove<span className="visually-hidden"> {b.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input className="input input-compact" type="search" placeholder="Add someone: type a name" aria-label={`Add someone to ${activity.name}`} value={q} onChange={(e) => setQ(e.target.value)} />
      {matches.length > 0 && (
        <ul className="booking-list">
          {matches.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{`${r.preferredName || r.firstName} ${r.lastName}`}</strong> <span className="field-hint">{r.groupName}</span>
              </span>
              <button className="btn-link" onClick={() => void change(() => api(path, { body: { registrationId: r.id } }))}>
                Add<span className="visually-hidden"> {r.firstName}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Activity leaders: just the activities they run, each opening its roster. */
function LeaderActivities({ activities }: { activities: Activity[] }) {
  const { event } = useEvent();
  const tz = event.timezone;
  const mine = activities.filter((a) => a.status === 'active').sort((x, y) => (x.startsAt ?? '').localeCompare(y.startsAt ?? ''));
  if (mine.length === 0) return <p className="lede">You haven't been given an activity yet. Ask an event manager.</p>;
  return (
    <section className="list-section">
      <h2 className="list-heading">Your activities</h2>
      <ul className="list">
        {mine.map((a) => (
          <li key={a.id}>
            <Link to={a.id} className="list-row board-row">
              <span className="list-main">
                <strong>{a.name}</strong>
                <span>
                  {[a.startsAt ? `${dayLabel(dayInZone(a.startsAt, tz))}, ${timeInZone(a.startsAt, tz)}` : 'All camp', a.location || null, a.booked ? `${a.booked} booked` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <Icon name="chevron" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
