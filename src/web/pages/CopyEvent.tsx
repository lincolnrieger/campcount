import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import type { Activity, Meal } from '../model';
import { useSession } from '../session';
import type { EventSummary } from '../types';
import { Button, Choice, Field, Icon, Notice, PageHeader, useToast } from '../ui';
import { useEvent } from './EventLayout';
import { clockInZone, dayInZone, weekdayName, zonedIso } from '../../shared/time';

const DAY = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/** Move a time to the same clock time, n days later, in the event's time zone. */
function shift(iso: string | null, n: number, tz: string): string | null {
  if (!iso) return null;
  return zonedIso(addDays(dayInZone(iso, tz), n), clockInZone(iso, tz), tz);
}

/**
 * Settings › Copy event: start next year's camp from this one. Copies the
 * details, features, activities (with their times moved to the new dates)
 * and meals. People, cards, scans and staff are not copied.
 */
export function CopyEvent() {
  const { event, base, onSite } = useEvent();
  const { me } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const length = daysBetween(event.startsOn, event.endsOn);
  const [name, setName] = useState(`${event.name} (copy)`);
  const [startsOn, setStartsOn] = useState(addDays(event.startsOn, 364));
  const [copyActivities, setCopyActivities] = useState(event.features.activities);
  const [copyMeals, setCopyMeals] = useState(event.features.meals);
  const [progress, setProgress] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const canCreate = me?.kind === 'user' && me.platformPermissions.includes('platform.events.create');
  const tz = event.timezone;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailure(null);
    const offset = daysBetween(event.startsOn, startsOn);
    try {
      setProgress('Creating the event…');
      const { event: copy } = await api<{ event: EventSummary }>('/events', {
        body: {
          name: name.trim(),
          location: event.location,
          description: event.description,
          startsOn,
          endsOn: addDays(startsOn, length),
          features: event.features,
        },
      });
      // You'll run the copy, so you're its event manager (needed to add its activities and meals).
      if (me?.kind === 'user') {
        setProgress('Adding you as event manager…');
        await api(`/events/${copy.id}/staff`, { body: { userId: me.user.id, roleKey: 'event_manager' } });
      }
      if (copyActivities) {
        const { activities } = await api<{ activities: Activity[] }>(`/events/${event.id}/activities`);
        const active = activities.filter((a) => a.status === 'active');
        for (const [i, a] of active.entries()) {
          setProgress(`Copying activities (${i + 1} of ${active.length})…`);
          await api(`/events/${copy.id}/activities`, {
            body: {
              name: a.name,
              description: a.description,
              location: a.location,
              instructions: a.instructions,
              startsAt: shift(a.startsAt, offset, tz),
              endsAt: shift(a.endsAt, offset, tz),
              capacity: a.capacity,
              capacityPolicy: a.capacityPolicy,
              trackSignOut: a.trackSignOut,
              allowRepeat: a.allowRepeat,
              bookingRequired: a.bookingRequired,
              signupOpen: a.signupOpen,
            },
          });
        }
      }
      if (copyMeals) {
        const { meals } = await api<{ meals: Meal[] }>(`/events/${event.id}/meals`);
        const active = meals.filter((m) => m.status === 'active');
        for (const [i, m] of active.entries()) {
          setProgress(`Copying meals (${i + 1} of ${active.length})…`);
          const startsAt = shift(m.startsAt, offset, tz);
          // "Saturday dinner" becomes "Friday dinner" if the new dates fall on other weekdays.
          const oldDay = m.startsAt ? weekdayName(dayInZone(m.startsAt, tz)) : null;
          const newDay = startsAt ? weekdayName(dayInZone(startsAt, tz)) : null;
          const mealName = oldDay && newDay && m.name.startsWith(oldDay) ? newDay + m.name.slice(oldDay.length) : m.name;
          await api(`/events/${copy.id}/meals`, { body: { name: mealName, location: m.location, startsAt, endsAt: shift(m.endsAt, offset, tz) } });
        }
      }
      toast(`Created ${copy.name}. Give it an address, add staff and people, then open it.`);
      navigate(`/camps/${copy.id}`);
    } catch (err) {
      setFailure(
        `${err instanceof ApiFailure ? err.message : 'Something went wrong. Check your signal and try again.'}${progress && !progress.startsWith('Creating') ? ' The new event was created but not everything was copied: check it before using it.' : ''}`,
      );
      setProgress(null);
    }
  }

  const back = { to: `${base}/settings`, label: 'Settings' };
  if (onSite)
    return (
      <>
        <PageHeader title="Copy event" back={back} />
        <Notice title="Copy events from the admin console">
          <p>Copying creates a new camp, which is done at the main CampCount address by an administrator.</p>
        </Notice>
      </>
    );
  if (!canCreate)
    return (
      <>
        <PageHeader title="Copy event" back={back} />
        <Notice tone="warning">
          <p>Only administrators can create events.</p>
        </Notice>
      </>
    );

  return (
    <>
      <PageHeader title="Copy event" back={back} summary="Start a new event from this one. You'll be its event manager." />
      <form onSubmit={submit} noValidate className="form">
        {failure && (
          <Notice tone="error" title="Couldn't copy everything">
            <p>{failure}</p>
          </Notice>
        )}
        <Field id="copy-name" label="New event name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field id="copy-start" label="First day" hint={`Runs ${length + 1} day${length ? 's' : ''}, like this event. Activity and meal times move to the new dates.`}>
          <input className="input input-time" type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <fieldset className="field">
          <legend className="field-label">Copy</legend>
          <div className="choices">
            <Choice checked disabled label={<strong>Details and features</strong>} description="Location, notes for staff and which features are on" />
            {event.features.activities && (
              <Choice checked={copyActivities} onChange={(e) => setCopyActivities(e.target.checked)} label={<strong>Activities</strong>} description="With their times, places and limits" />
            )}
            {event.features.meals && <Choice checked={copyMeals} onChange={(e) => setCopyMeals(e.target.checked)} label={<strong>Meals</strong>} />}
          </div>
        </fieldset>
        <p className="meta">People, lanyards, scans and other staff stay with this event.</p>
        {progress && (
          <p className="meta" role="status">
            <Icon name="sync" size={16} /> {progress}
          </p>
        )}
        <div className="btn-row">
          <Button type="submit" kind="primary" busy={!!progress} busyLabel="Copying…" disabled={!name.trim() || !startsOn}>
            Copy event
          </Button>
          <Button onClick={() => navigate(back.to)} disabled={!!progress}>
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
}
