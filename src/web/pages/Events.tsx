import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import { BackLink, EventStatusBadge, Field, formatDateRange, Loading, LoadError, Notice, SkeletonList } from '../components/ui';
import { useSession } from '../session';
import { Icon } from '../components/Icon';
import type { Me } from '../types';
import type { EventSummary } from '../types';
import { useApi } from '../useApi';
import { FEATURE_COPY } from './featureCopy';
import type { EventFeatures } from '../../shared/schemas';
import { useTitle } from '../useTitle';
import { useToast } from '../components/Toast';

function greeting(me: Me | null): string {
  const first = me?.kind === 'user' ? me.user.displayName.split(' ')[0] : '';
  const hour = Number(new Date().toLocaleString('en-AU', { hour: 'numeric', hour12: false, timeZone: 'Australia/Adelaide' }));
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return first ? `${part}, ${first}` : part;
}

export function Events() {
  useTitle('Home');
  const { me } = useSession();
  const { data, error, loading, reload } = useApi<{ events: EventSummary[] }>('/events');
  const canCreate = me?.kind === 'user' && me.platformPermissions.includes('platform.events.create');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greeting(me)}</h1>
        </div>
        {canCreate && (
          <Link className="btn" to="/events/new">
            Create event
          </Link>
        )}
      </div>
      {loading && (
        <Loading label="Loading your events">
          <SkeletonList rows={3} aside="tag" />
        </Loading>
      )}
      {error && <LoadError error={error} onRetry={reload} />}
      {data && data.events.length === 0 && (
        <div className="empty">
          <p>
            <strong>You're not assigned to any events yet.</strong>
          </p>
          <p className="lede">
            {canCreate
              ? 'Create an event to get started.'
              : 'Ask an event manager to add you using the email you signed up with, and it will show up here.'}
          </p>
          {canCreate && (
            <Link className="btn" to="/events/new">
              Create event
            </Link>
          )}
        </div>
      )}
      {data && data.events.length > 0 && (
        <ul className="event-rows">
          {data.events.map((e) => (
            <li key={e.id}>
              <Link to={`/events/${e.id}`} className="event-row">
                <span className="event-row-main">
                  <strong>{e.name}</strong>
                  <span className="event-row-meta">
                    {formatDateRange(e.startsOn, e.endsOn)}
                    {e.location && `, ${e.location}`}
                  </span>
                </span>
                <span className="event-row-side">
                  {e.isDemo && <span className="badge-demo">Demo</span>}
                  <EventStatusBadge status={e.status} />
                  <Icon name="chevron" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const DEFAULT_FEATURES: EventFeatures = {
  activities: true,
  meals: false,
  site: false,
  dietary: false,
  photo: true,
  selfSignup: false,
};

export function FeatureChecklist({
  value,
  onChange,
  disabled,
}: {
  value: EventFeatures;
  onChange: (next: EventFeatures) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="field fieldset-plain">
      <legend>What will this event use?</legend>
      <span className="field-hint">You can change this until the event closes.</span>
      {(Object.keys(FEATURE_COPY) as (keyof EventFeatures)[]).map((key) => (
        <label className="check" key={key}>
          <input
            type="checkbox"
            checked={value[key]}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
          />
          <div>
            <strong>{FEATURE_COPY[key].label}</strong>
            <span>{FEATURE_COPY[key].hint}</span>
          </div>
        </label>
      ))}
    </fieldset>
  );
}

export function NewEvent() {
  useTitle('New event');
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState({ name: '', location: '', startsOn: '', endsOn: '', description: '' });
  const [features, setFeatures] = useState<EventFeatures>(DEFAULT_FEATURES);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const { event } = await api<{ event: EventSummary }>('/events', { body: { ...form, features } });
      navigate(`/events/${event.id}`);
      toast(`Created ${event.name}. Work through Get ready, then open it.`);
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
    <form onSubmit={submit} noValidate className="narrow">
      <BackLink to="/" label="Home" />
      <h1>Create event</h1>
      <p className="lede">The event starts as a draft. Nobody can scan until you open it.</p>
      {failure && <Notice tone="stop">{failure}</Notice>}
      <Field id="name" label="Event name" error={errors.name}>
        <input id="name" className="input" value={form.name} onChange={set('name')} required aria-invalid={!!errors.name} />
      </Field>
      <Field id="location" label="Location" hint="For example, Woodhouse Activity Centre">
        <input id="location" className="input" value={form.location} onChange={set('location')} />
      </Field>
      <div className="row">
        <Field id="startsOn" label="First day" error={errors.startsOn}>
          <input id="startsOn" className="input" type="date" value={form.startsOn} onChange={set('startsOn')} required />
        </Field>
        <Field id="endsOn" label="Last day" error={errors.endsOn}>
          <input id="endsOn" className="input" type="date" value={form.endsOn} onChange={set('endsOn')} required />
        </Field>
      </div>
      <Field id="description" label="Notes for staff" hint="Optional. Shown on the event page to everyone assigned.">
        <textarea id="description" className="input" rows={3} value={form.description} onChange={set('description')} />
      </Field>
      <FeatureChecklist value={features} onChange={setFeatures} />
      <div className="actions">
        <button className="btn" disabled={busy}>
          {busy ? 'Creating…' : 'Create event'}
        </button>
        <Link className="btn btn-secondary" to="/">
          Cancel
        </Link>
      </div>
    </form>
  );
}
