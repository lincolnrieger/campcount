import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import { matchesSearch } from '../../shared/search';
import type { EventFeatures, EventStatus } from '../../shared/schemas';
import { useSession } from '../session';
import type { EventSummary } from '../types';
import { useApi } from '../useApi';
import { FEATURE_COPY } from './featureCopy';
import { Badge, Button, ButtonLink, Choice, EmptyState, Field, Icon, LoadError, Loading, PageHeader, SearchField, Section, SkeletonHeader, SkeletonRows, formatDateRange, useToast } from '../ui';
import type { Tone } from '../ui';

const STATUS: Record<EventStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'warning' },
  open: { label: 'Open', tone: 'success' },
  completed: { label: 'Closed', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** Only the first visit to "/" in a page load may send someone straight into their one event. */
let landed = false;

/** Where someone on exactly one event should land, or null to show the list. */
function landingFor(e: EventSummary): string | null {
  const can = (p: string) => e.permissions.includes(p as never);
  if (can('reports.view') || can('event.configure')) return `/events/${e.id}`;
  if (can('site.scan') || can('meal.scan')) return `/scan?event=${e.id}`;
  if (can('activity.view_roster') || can('activity.scan')) return `/events/${e.id}/activities`;
  return null;
}

/** Events: every event you're on. Happening now first, then coming up; past events on request. */
export function Events() {
  const { me } = useSession();
  const { data, error, loading, reload } = useApi<{ events: EventSummary[] }>('/events');
  const landNavigate = useNavigate();
  // First visit this page load: someone on exactly one event goes straight to it.
  useEffect(() => {
    if (landed || !data) return;
    landed = true;
    const noPlatform = me?.kind === 'user' && me.platformPermissions.length === 0;
    const only = data.events.length === 1 ? data.events[0]! : null;
    const to = noPlatform && only ? landingFor(only) : null;
    if (to) landNavigate(to, { replace: true });
  }, [data, me, landNavigate]);
  const canCreate = me?.kind === 'user' && me.platformPermissions.includes('platform.events.create');
  const [q, setQ] = useState('');
  const [showPast, setShowPast] = useState(false);

  const create = canCreate && (
    <ButtonLink to="/events/new" kind="primary">
      Create event
    </ButtonLink>
  );

  if (loading && !data)
    return (
      <Loading what="your events">
        <SkeletonHeader />
        <SkeletonRows rows={4} />
      </Loading>
    );
  if (error)
    return (
      <>
        <PageHeader title="Events" />
        <LoadError error={error} onRetry={reload} what="your events" />
      </>
    );
  if (!data) return null;
  const all = data.events;


  const matching = all.filter((e) => matchesSearch(q, e.name, e.location));
  const byDate = (a: EventSummary, b: EventSummary) => a.startsOn.localeCompare(b.startsOn);
  const now = matching.filter((e) => e.status === 'open').sort(byDate);
  const soon = matching.filter((e) => e.status === 'draft').sort(byDate);
  const past = matching.filter((e) => e.status !== 'open' && e.status !== 'draft').sort((a, b) => b.startsOn.localeCompare(a.startsOn));

  return (
    <>
      <PageHeader title="Events" primary={create} />
      {all.length === 0 ? (
        <EmptyState title="You're not on any events yet" actions={create}>
          {canCreate ? 'Create an event to get started.' : 'An administrator adds you to an event. It shows up here once they do.'}
        </EmptyState>
      ) : (
        <div className="sections">
          {all.length > 8 && (
            <div className="toolbar">
              <SearchField id="event-q" label="Search events" value={q} onChange={setQ} />
            </div>
          )}
          {q && matching.length === 0 && <EmptyState title={`No events match "${q}"`}>Check the spelling, or search by location.</EmptyState>}
          <EventList title="Happening now" id="now" events={now} />
          <EventList title="Coming up" id="soon" events={soon} />
          {past.length > 0 &&
            (showPast || q ? (
              <EventList title="Past events" id="past" events={past} />
            ) : (
              <div>
                <Button onClick={() => setShowPast(true)}>Show past events ({past.length})</Button>
              </div>
            ))}
          {!q && now.length === 0 && soon.length === 0 && !showPast && <p className="meta">No current events.</p>}
        </div>
      )}
    </>
  );
}

function EventList({ title, id, events }: { title: string; id: string; events: EventSummary[] }) {
  if (events.length === 0) return null;
  return (
    <Section title={title} id={id}>
      <ul className="list">
        {events.map((e) => (
          <li key={e.id} className="row row-large row-link">
            <span className="row-main">
              <span className="row-title">
                <Link to={`/events/${e.id}`}>{e.name}</Link>
              </span>
              <span className="row-meta">{[formatDateRange(e.startsOn, e.endsOn), e.location].filter(Boolean).join(' · ')}</span>
            </span>
            <span className="row-side">
              {e.isDemo && <Badge tone="info">Demo</Badge>}
              <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge>
            </span>
            <span className="row-chevron">
              <Icon name="chevron" />
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const DEFAULT_FEATURES: EventFeatures = {
  activities: true,
  meals: true,
  site: true,
  dietary: true,
  photo: false,
  selfSignup: false,
};

/** "What will you use?": one checkbox per feature, with a one-line hint. */
export function FeatureChecklist({ value, onChange, disabled }: { value: EventFeatures; onChange: (next: EventFeatures) => void; disabled?: boolean }) {
  return (
    <fieldset className="field">
      <legend className="field-label">What will you use?</legend>
      <span className="field-hint">You can change this until the event closes.</span>
      <div className="choices">
        {(Object.keys(FEATURE_COPY) as (keyof EventFeatures)[]).map((key) => (
          <Choice
            key={key}
            label={FEATURE_COPY[key].label}
            description={FEATURE_COPY[key].hint}
            checked={value[key]}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** The event form fields, shared by Create event and Settings › Event details. */
export interface EventForm {
  name: string;
  location: string;
  startsOn: string;
  endsOn: string;
  description: string;
}

export function EventFields({ form, set, errors }: { form: EventForm; set: (k: keyof EventForm) => (e: { target: { value: string } }) => void; errors: Record<string, string> }) {
  return (
    <>
      <Field id="name" label="Event name" error={errors.name}>
        <input className="input" value={form.name} onChange={set('name')} autoComplete="off" />
      </Field>
      <div className="field-pair">
        <Field id="startsOn" label="First day" error={errors.startsOn}>
          <input className="input" type="date" value={form.startsOn} onChange={set('startsOn')} />
        </Field>
        <Field id="endsOn" label="Last day" error={errors.endsOn}>
          <input className="input" type="date" value={form.endsOn} onChange={set('endsOn')} />
        </Field>
      </div>
      <Field id="location" label="Location" optional hint="For example, Woodhouse Activity Centre" error={errors.location}>
        <input className="input" value={form.location} onChange={set('location')} />
      </Field>
      <Field id="description" label="Notes for staff" optional hint="Shown on the event's Home to everyone on its staff." error={errors.description}>
        <textarea className="textarea" rows={3} value={form.description} onChange={set('description')} />
      </Field>
    </>
  );
}

/** Check the fields the browser can; the server checks everything again. */
export function checkEventForm(form: EventForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!form.name.trim()) e.name = 'Enter a name for the event';
  if (!form.startsOn) e.startsOn = 'Choose the first day';
  if (!form.endsOn) e.endsOn = 'Choose the last day';
  else if (form.startsOn && form.endsOn < form.startsOn) e.endsOn = 'The last day must be on or after the first day';
  return e;
}

export function NewEvent() {
  const navigate = useNavigate();
  const toast = useToast();
  const { me } = useSession();
  const [form, setForm] = useState<EventForm>({ name: '', location: '', startsOn: '', endsOn: '', description: '' });
  const [features, setFeatures] = useState<EventFeatures>(DEFAULT_FEATURES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof EventForm) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const back = { to: '/', label: 'Events' };

  if (me?.kind === 'user' && !me.platformPermissions.includes('platform.events.create')) {
    return (
      <>
        <PageHeader title="Create event" back={back} />
        <EmptyState title="Only administrators can create events" />
      </>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local = checkEventForm(form);
    setErrors(local);
    setFailure(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const { event } = await api<{ event: EventSummary }>('/events', { body: { ...form, features } });
      toast(`Created ${event.name}`);
      navigate(`/events/${event.id}`);
    } catch (err) {
      if (err instanceof ApiFailure) {
        setErrors(err.fieldErrors());
        setFailure(err.message);
      } else setFailure('No connection. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Create event" back={back} summary="It starts as a draft. Nobody can scan until you open it." />
      <form className="form" onSubmit={submit} noValidate>
        {failure && (
          <p className="field-error" role="alert">
            <Icon name="error" size={16} />
            {failure}
          </p>
        )}
        <EventFields form={form} set={set} errors={errors} />
        <FeatureChecklist value={features} onChange={setFeatures} />
        <div className="btn-row">
          <Button type="submit" kind="primary" busy={busy} busyLabel="Creating…">
            Create event
          </Button>
          <ButtonLink to="/">Cancel</ButtonLink>
        </div>
      </form>
    </>
  );
}
