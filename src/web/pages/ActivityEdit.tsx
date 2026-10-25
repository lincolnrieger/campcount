import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiFailure, api } from '../api';
import { BackLink, Field, Loading, LoadError, Notice, SkeletonHeading, SkeletonList } from '../components/ui';
import { useToast } from '../components/Toast';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import type { Activity } from './Activities';
import { clockInZone, dayInZone, dayLabel, eventDays, zonedIso } from '../../shared/time';
import { useTitle } from '../useTitle';

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

export function ActivityForm({
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
    } catch (err) {
      if (err instanceof ApiFailure) {
        setErrors(err.fieldErrors());
        setFailure(err.message);
      } else setFailure('Something went wrong. Check your signal and try again.');
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
        <div className="chip-row" role="group" aria-labelledby={`${id}-when`}>
          <button type="button" aria-pressed={!timed} className="chip-toggle" onClick={() => setForm({ ...form, day: '' })}>
            All camp
          </button>
          {days.map((d) => (
            <button key={d} type="button" aria-pressed={form.day === d} className="chip-toggle" onClick={() => setForm({ ...form, day: d })}>
              {dayLabel(d)}
            </button>
          ))}
        </div>
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
          <Field id={`${id}-end`} label="Ends (optional)" error={badTimes ? 'Must be after the start' : undefined}>
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


/**
 * Add an activity (activities/new), add another session of one
 * (activities/new?from=<id>), or edit one (activities/<id>/edit).
 */
export function ActivityEdit() {
  const { event, can } = useEvent();
  const { activityId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const from = params.get('from');
  const sourceId = activityId ?? from;
  const list = useApi<{ activities: Activity[] }>(sourceId ? `/events/${event.id}/activities` : null);
  const source = list.data?.activities.find((a) => a.id === sourceId) ?? null;
  const mode = activityId ? 'edit' : from ? 'copy' : 'new';
  const title = mode === 'edit' ? 'Edit activity' : mode === 'copy' ? 'Add another session' : 'Add activity';
  useTitle(title);
  const back = mode === 'edit' ? { to: '..', label: source?.name ?? 'Activity' } : { to: '..', label: 'Activities' };

  if (!can('activities.manage') || (event.status !== 'draft' && event.status !== 'open'))
    return <Notice tone="stop">Activities can only be changed by event managers while the event is a draft or open.</Notice>;
  if (sourceId && list.loading && !list.data)
    return (
      <Loading label="Loading activity">
        <SkeletonHeading sub={false} width="12rem" />
        <SkeletonList rows={4} lines={1} aside="none" />
      </Loading>
    );
  if (list.error) return <LoadError error={list.error} onRetry={list.reload} />;
  if (sourceId && !source) return <LoadError error={new ApiFailure(404, 'not_found', '')} message="This activity has been deleted." />;

  return (
    <>
      <BackLink to={back.to} label={back.label} />
      <h2>{title}</h2>
      {mode === 'copy' && <p className="lede">Same settings as {source!.name}, starting when it ends. Change anything you need.</p>}
      <ActivityForm
        id="activity"
        initial={mode === 'edit' ? toForm(source!, event.timezone) : mode === 'copy' ? nextSession(source!, event.timezone) : EMPTY}
        submitLabel={mode === 'edit' ? 'Save changes' : mode === 'copy' ? 'Add session' : 'Add activity'}
        onCancel={() => navigate('..', { relative: 'path' })}
        onSave={async (body) => {
          if (mode === 'edit') {
            await api(`/events/${event.id}/activities/${source!.id}`, { method: 'PATCH', body });
            toast('Changes saved.');
            navigate('..', { relative: 'path' });
          } else {
            await api(`/events/${event.id}/activities`, { body });
            toast(`Added ${(body as { name: string }).name}.`);
            navigate('..', { relative: 'path' });
          }
        }}
      />
    </>
  );
}
