import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { clockInZone, dayInZone, dayLabel, eventDays, zonedIso } from '../../shared/time';
import { ApiFailure, api } from '../api';
import type { Activity } from '../model';
import { useApi } from '../useApi';
import { Button, Choice, ErrorSummary, Field, Icon, LoadError, Loading, Notice, PageHeader, SkeletonHeader, SkeletonRows, useToast } from '../ui';
import { useEvent } from './EventLayout';

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

function ActivityForm({ initial, submitLabel, onSave, onCancel }: { initial: FormState; submitLabel: string; onSave: (body: { name: string }) => Promise<void>; onCancel: () => void }) {
  const { event } = useEvent();
  const days = eventDays(event.startsOn, event.endsOn);
  const [form, setForm] = useState<FormState>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const timed = form.day !== '';
  // Advanced options start open when this activity already uses one.
  const advanced = Boolean(initial.capacity || !initial.trackSignOut || !initial.allowRepeat || initial.signupOpen || initial.bookingRequired);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!form.name.trim()) local.name = 'Enter the activity name';
    if (timed && form.end && minutesBetween(form.start, form.end) <= 0) local.end = 'The end must be after the start';
    setErrors(local);
    setFailure(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await onSave({
        name: form.name.trim(),
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
      } as { name: string });
    } catch (err) {
      if (err instanceof ApiFailure) {
        setErrors(err.fieldErrors());
        setFailure(err.message);
      } else setFailure('No connection. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  const summary = [errors.name && { id: 'act-name', message: errors.name }, errors.end && { id: 'act-end', message: errors.end }].filter(Boolean) as { id: string; message: string }[];

  return (
    <form className="form" onSubmit={submit} noValidate>
      <ErrorSummary errors={summary} />
      {failure && summary.length === 0 && (
        <Notice tone="error">
          <p>{failure}</p>
        </Notice>
      )}
      <Field id="act-name" label="Name" error={errors.name}>
        <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />
      </Field>
      <Field id="act-day" label="Day">
        <select className="select" value={form.day} onChange={(e) => set('day', e.target.value)}>
          <option value="">No set time (runs all camp)</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {dayLabel(d, 'long')}
            </option>
          ))}
        </select>
      </Field>
      {timed && (
        <div className="field-pair">
          <Field id="act-start" label="Start">
            <input
              className="input"
              type="time"
              value={form.start}
              onChange={(e) => {
                // Keep the same length when the start moves.
                const length = form.end ? minutesBetween(form.start, form.end) : 90;
                setForm({ ...form, start: e.target.value, end: form.end ? addMinutes(e.target.value, Math.max(15, length)) : '' });
              }}
            />
          </Field>
          <Field id="act-end" label="End" optional error={errors.end}>
            <input className="input" type="time" value={form.end} onChange={(e) => set('end', e.target.value)} />
          </Field>
        </div>
      )}
      <Field id="act-place" label="Place" optional>
        <input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} autoComplete="off" />
      </Field>
      <Field id="act-ins" label="Instructions for leaders" optional hint="Shown on the activity's page and scanner.">
        <textarea className="textarea" rows={3} value={form.instructions} onChange={(e) => set('instructions', e.target.value)} />
      </Field>

      <details className="more-options" open={advanced}>
        <summary>
          <Icon name="chevron" />
          More options
        </summary>
        <div className="form">
          <Field id="act-cap" label="Capacity" optional hint="Leave blank for no limit.">
            <input className="input activity-capacity" inputMode="numeric" value={form.capacity} onChange={(e) => set('capacity', e.target.value.replace(/\D/g, ''))} />
          </Field>
          <fieldset className="choices">
            <legend className="visually-hidden">Activity options</legend>
            {form.capacity && (
              <Choice
                label="Refuse sign-ins when full"
                description="If off, the leader sees a warning but the sign-in still counts."
                checked={form.capacityPolicy === 'block'}
                onChange={(e) => set('capacityPolicy', e.target.checked ? 'block' : 'warn')}
              />
            )}
            <Choice
              label="Sign people out as well as in"
              description="Shows who is at the activity right now. Needed for capacity limits."
              checked={form.trackSignOut}
              onChange={(e) => set('trackSignOut', e.target.checked)}
            />
            <Choice
              label="Allow repeat visits"
              description="If off, a second visit is flagged as already done."
              checked={form.allowRepeat}
              onChange={(e) => set('allowRepeat', e.target.checked)}
            />
            {event.features.selfSignup && (
              <>
                <Choice
                  label="Open for self sign-up"
                  description="Listed on the sign-up kiosk and session posters. The capacity is the number of places."
                  checked={form.signupOpen}
                  onChange={(e) => set('signupOpen', e.target.checked)}
                />
                <Choice
                  label="Booking required"
                  description="The leader sees a warning when someone who hasn't booked is scanned in."
                  checked={form.bookingRequired}
                  onChange={(e) => set('bookingRequired', e.target.checked)}
                />
              </>
            )}
          </fieldset>
        </div>
      </details>

      <div className="btn-row">
        <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…">
          {submitLabel}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
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
  const { base: eventBase } = useEvent();
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
  const base = `${eventBase}/activities`;
  const back = mode === 'new' ? { to: base, label: 'Activities' } : { to: `${base}/${sourceId}`, label: source?.name ?? 'Activity' };

  if (!can('activities.manage') || (event.status !== 'draft' && event.status !== 'open'))
    return (
      <>
        <PageHeader title={title} back={{ to: base, label: 'Activities' }} />
        <Notice tone="warning">
          <p>Only event managers can change activities, and only while the event is a draft or open.</p>
        </Notice>
      </>
    );
  if (sourceId && list.loading && !list.data)
    return (
      <Loading what="activity">
        <SkeletonHeader />
        <SkeletonRows rows={4} />
      </Loading>
    );
  if (list.error)
    return (
      <>
        <PageHeader title={title} back={back} />
        <LoadError error={list.error} onRetry={list.reload} what="this activity" />
      </>
    );
  if (sourceId && !source)
    return (
      <>
        <PageHeader title={title} back={{ to: base, label: 'Activities' }} />
        <Notice tone="error">
          <p>This activity has been deleted.</p>
        </Notice>
      </>
    );

  return (
    <>
      <PageHeader title={title} back={back} summary={mode === 'copy' ? `Same settings as ${source!.name}, starting when it ends. Change anything you need.` : undefined} />
      <ActivityForm
        initial={mode === 'edit' ? toForm(source!, event.timezone) : mode === 'copy' ? nextSession(source!, event.timezone) : EMPTY}
        submitLabel={mode === 'edit' ? 'Save changes' : mode === 'copy' ? 'Add session' : 'Add activity'}
        onCancel={() => navigate(back.to)}
        onSave={async (body) => {
          if (mode === 'edit') {
            await api(`${base}/${source!.id}`, { method: 'PATCH', body });
            toast('Changes saved');
            navigate(`${base}/${source!.id}`);
          } else {
            const { id } = await api<{ id: string }>(base, { body });
            toast(`${body.name} added`);
            navigate(`${base}/${id}`);
          }
        }}
      />
    </>
  );
}
