import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import { BackLink, EventStatusBadge, Field, formatDateRange, Loading, LoadError, Notice, PageHeader, SkeletonTable } from '../components/ui';
import { SortHeader, sortRows, useSort } from '../components/Table';
import { matchesSearch } from '../../shared/search';
import { useSession } from '../session';
import type { EventSummary } from '../types';
import { useApi } from '../useApi';
import { FEATURE_COPY } from './featureCopy';
import type { EventFeatures } from '../../shared/schemas';
import { useTitle } from '../shell';
import { useToast } from '../components/Toast';

type Filter = 'current' | 'past' | 'all';
const CURRENT = new Set(['draft', 'open']);

/** Events: every event you're on, current ones first. */
export function Events() {
  useTitle('Events');
  const { me } = useSession();
  const { data, error, loading, reload } = useApi<{ events: EventSummary[] }>('/events');
  const canCreate = me?.kind === 'user' && me.platformPermissions.includes('platform.events.create');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('current');
  const { sort, toggle } = useSort<'name' | 'dates' | 'status'>('dates');
  const all = data?.events ?? [];
  const inFilter = all.filter((e) => (filter === 'all' ? true : filter === 'current' ? CURRENT.has(e.status) : !CURRENT.has(e.status)));
  const shown = sortRows(
    inFilter.filter((e) => matchesSearch(q, e.name, e.location)),
    (e) => (sort.key === 'name' ? e.name : sort.key === 'status' ? e.status : e.startsOn),
    sort.dir,
  );
  const counts = { current: all.filter((e) => CURRENT.has(e.status)).length, past: all.filter((e) => !CURRENT.has(e.status)).length, all: all.length };

  return (
    <>
      <PageHeader
        level={1}
        title="Events"
        sub={data && `${counts.current} current, ${counts.past} past`}
        actions={
          canCreate && (
            <Link className="btn" to="/events/new">
              Create event
            </Link>
          )
        }
      />
      {loading && !data && (
        <Loading label="Loading your events">
          <SkeletonTable rows={4} cols={3} />
        </Loading>
      )}
      {error && <LoadError error={error} onRetry={reload} />}
      {data && all.length === 0 && (
        <div className="empty">
          <p>
            <strong>You're not on any events yet.</strong>
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
      {data && all.length > 0 && (
        <>
          <div className="toolbar">
            <input
              className="input input-search toolbar-search"
              type="search"
              aria-label="Search events"
              placeholder="Search events"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="segmented" role="group" aria-label="Show">
              {(
                [
                  ['current', `Current (${counts.current})`],
                  ['past', `Past (${counts.past})`],
                  ['all', 'All'],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Event" column="name" sort={sort} onSort={toggle} />
                  <SortHeader label="Dates" column="dates" sort={sort} onSort={toggle} className="hide-sm" />
                  <th scope="col" className="hide-md">
                    Location
                  </th>
                  <SortHeader label="Status" column="status" sort={sort} onSort={toggle} />
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link to={`/events/${e.id}`} className="row-link">
                        {e.name}
                      </Link>{' '}
                      {e.isDemo && <span className="badge-demo">Demo</span>}
                      <span className="cell-sub show-sm">
                        {formatDateRange(e.startsOn, e.endsOn)}
                        {e.location && `, ${e.location}`}
                      </span>
                    </td>
                    <td className="hide-sm nowrap">{formatDateRange(e.startsOn, e.endsOn)}</td>
                    <td className="hide-md muted">{e.location}</td>
                    <td>
                      <EventStatusBadge status={e.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && (
              <div className="empty">
                <p className="flush">
                  {q ? `No events match "${q}".` : filter === 'current' ? 'No current events.' : 'No past events.'}{' '}
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => {
                      setQ('');
                      setFilter('all');
                    }}
                  >
                    Show all events
                  </button>
                </p>
              </div>
            )}
          </div>
        </>
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
  hideLegend = false,
}: {
  value: EventFeatures;
  onChange: (next: EventFeatures) => void;
  disabled?: boolean;
  hideLegend?: boolean;
}) {
  return (
    <fieldset className="field fieldset-plain">
      <legend className={hideLegend ? 'visually-hidden' : undefined}>What will this event use?</legend>
      {!hideLegend && <span className="field-hint">You can change this until the event closes.</span>}
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
