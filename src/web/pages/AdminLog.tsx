import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ApiFailure, api } from '../api';
import { ActionButton, Loading, Notice, PageHeader, SkeletonList } from '../components/ui';
import type { EventSummary } from '../types';
import { useApi } from '../useApi';
import { scanVerb } from './Person';
import { useTitle } from '../useTitle';

interface ScanEntry {
  kind: 'scan';
  id: string;
  at: string;
  eventId: string;
  eventName: string;
  person: string;
  registrationId: string | null;
  place: string;
  contextType: 'activity' | 'meal' | 'site';
  direction: 'in' | 'out';
  method: string;
  outcome: string;
  note: string;
  actor: string;
}
interface ChangeEntry {
  kind: 'change';
  id: string;
  at: string;
  eventId: string | null;
  eventName: string | null;
  action: string;
  actorType: string;
  actor: string;
  targetType: string | null;
  target: string;
  detail: Record<string, unknown>;
}
type Entry = ScanEntry | ChangeEntry;

/** Plain-English verbs for audit actions; anything unlisted shows its code. */
const ACTIONS: Record<string, string> = {
  'auth.sign_in': 'signed in',
  'auth.password_failed': 'entered a wrong password for',
  'auth.password_set': 'set their password',
  'auth.password_changed': 'changed their password',
  'auth.password_reset': 'reset their password from a link',
  'user.signup': 'signed up',
  'user.create': 'created an account for',
  'user.rename': 'renamed',
  'user.delete': 'deleted the account of',
  'user.anonymise': 'removed the account of',
  'user.status': 'changed account status of',
  'password_link.setup': 'made a set-up link for',
  'password_link.reset': 'made a password reset link for',
  'assignment.grant': 'gave a role to',
  'assignment.revoke': 'removed a role from',
  'assignment.change': 'changed the role of',
  'event.create': 'created the event',
  'event.update': 'changed the settings of',
  'event.transition': 'changed the status of',
  'activity.create': 'added the activity',
  'activity.update': 'changed the activity',
  'activity.delete': 'deleted the activity',
  'meal.create': 'added the meal',
  'meal.update': 'changed the meal',
  'meal.delete': 'deleted the meal',
  'station.create': 'set up the station',
  'station.pair': 'paired a device for the station',
  'station.revoke': 'stopped the station',
  'station.update': 'changed the station',
  'station.reopen': 'reopened the station',
  'booking.self': 'booked an activity for',
  'booking.self_cancel': 'cancelled an activity booking for',
  'booking.add': 'booked an activity for',
  'booking.remove': 'removed an activity booking for',
  'signup.new_link': 'made a new sign-up link for',
  'roster.import': 'imported the roster',
  'registration.update': 'edited the details of',
  'registration.add': 'added a person to the event:',
  'registration.request': 'sent a registration from the registration page',
  'registration.approve': 'approved the registration of',
  'registration.decline': 'declined a registration',
  'registration.settings': 'changed the registration page for',
  'registration.delete': 'deleted a person from the event',
  'dietary.update': 'updated the dietary needs of',
  'credentials.issue': 'issued lanyard cards',
  'credentials.replace': 'replaced lanyard cards',
  'credentials.print': 'opened lanyard cards',
  'scan.void': 'undid a scan',
  'reconciliation.sign_out_all': 'signed everyone out of',
  'export.download': 'downloaded a report',
  'preview.start': 'started viewing as a role',
  'preview.stop': 'stopped viewing as a role',
  'demo.create': 'created a demo camp',
  'demo.delete': 'deleted a demo camp',
  'retention.purge_sensitive': 'deleted sensitive data on schedule',
  'retention.purge_records': 'deleted old records on schedule',
};

const FIELD_WORDS: Record<string, string> = {
  memberNumber: 'membership number',
  firstName: 'first name',
  preferredName: 'goes-by name',
  lastName: 'last name',
  kind: 'youth or leader',
  groupName: 'group',
  photoConsent: 'photo consent',
  startsAt: 'time',
  endsAt: 'end time',
  trackSignOut: 'sign-out',
  allowRepeat: 'repeats',
  capacityPolicy: 'capacity rule',
};

function describeDetail(e: ChangeEntry): string {
  const d = e.detail;
  const bits: string[] = [];
  if (typeof d.role === 'string') bits.push(`role ${d.role.replace(/_/g, ' ')}`);
  if (typeof d.from === 'string' && typeof d.to === 'string') bits.push(`${d.from.replace(/_/g, ' ')} to ${d.to.replace(/_/g, ' ')}`);
  if (typeof d.count === 'number') bits.push(`${d.count} ${d.count === 1 ? 'item' : 'items'}`);
  if (typeof d.scans === 'number') bits.push(`${d.scans} scan${d.scans === 1 ? '' : 's'} deleted`);
  if (typeof d.fields === 'string' && d.fields) bits.push(`changed ${d.fields.split(',').map((f) => FIELD_WORDS[f] ?? f).join(', ')}`);
  if (typeof d.method === 'string') bits.push(`with ${d.method.replace(/-/g, ' ')}`);
  if (typeof d.name === 'string' && d.name !== e.target) bits.push(d.name);
  return bits.join(', ');
}

const OUTCOME: Record<string, { label: string; tone: string } | undefined> = {
  duplicate: { label: 'Repeat', tone: 'tag' },
  review: { label: 'To check', tone: 'tag tag-warn' },
  rejected: { label: 'Refused', tone: 'tag tag-stop' },
  void: { label: 'Undo', tone: 'tag' },
};

export function AdminLog() {
  useTitle('Activity log');
  const events = useApi<{ events: EventSummary[] }>('/events');
  const [eventId, setEventId] = useState('');
  const [kind, setKind] = useState<'all' | 'scans' | 'changes'>('all');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // Search as you type, a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(
    async (before: string | null) => {
      const params = new URLSearchParams({ kind });
      if (eventId) params.set('eventId', eventId);
      if (query) params.set('q', query);
      if (before) params.set('before', before);
      const res = await api<{ entries: Entry[]; nextBefore: string | null }>(`/admin/log?${params}`);
      setEntries((old) => (before ? [...(old ?? []), ...res.entries] : res.entries));
      setNext(res.nextBefore);
    },
    [kind, eventId, query],
  );

  useEffect(() => {
    setEntries(null);
    setError(null);
    load(null).catch((err) => setError(err instanceof ApiFailure ? err.message : 'Could not load the log.'));
  }, [load]);

  const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Adelaide' });
  const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'Australia/Adelaide' });
  const days = new Map<string, Entry[]>();
  for (const e of entries ?? []) days.set(dayOf(e.at), [...(days.get(dayOf(e.at)) ?? []), e]);

  return (
    <div className="log">
      <PageHeader title={<span className="visually-hidden">Activity log</span>} sub="Times are Adelaide time." />
      <div className="segmented segmented-3" role="group" aria-label="Show">
        {(
          [
            ['all', 'Everything'],
            ['scans', 'Scans'],
            ['changes', 'Changes'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="row filters section-gap-sm">
        <div className="field">
          <label htmlFor="log-q" className="visually-hidden">
            Search
          </label>
          <input id="log-q" className="input" type="search" placeholder="Person, place, staff member or action" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="log-event" className="visually-hidden">
            Event
          </label>
          <select id="log-event" className="input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">All events</option>
            {events.data?.events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <Notice tone="stop" title="This didn't load">
          <p>{error}</p>
          <ActionButton
            className="btn btn-secondary btn-small"
            busyLabel="Trying again…"
            onAction={async () => {
              setError(null);
              await load(entries && entries.length ? next : null).catch(() => setError('Could not load the log. Check your signal.'));
            }}
          >
            Try again
          </ActionButton>
        </Notice>
      )}
      {!entries && !error && (
        <Loading label="Loading the log">
          <SkeletonList rows={6} aside="tag" heading />
        </Loading>
      )}
      {entries && entries.length === 0 && <p className="field-hint">Nothing recorded{query ? ` matching "${query}"` : ''}.</p>}
      {[...days].map(([day, items]) => (
        <section key={day} className="list-section log-day">
          <h2 className="list-heading">{day}</h2>
          <ol className="list">
            {items.map((e) => (
              <li key={e.id} className="log-row">
                <span className={`log-mark log-mark-${e.kind === 'scan' ? e.contextType : 'change'}`} aria-hidden="true" />
                <span className="list-main">
                  {e.kind === 'scan' ? (
                    <>
                      <strong>
                        {e.registrationId && e.eventId ? <Link to={`/events/${e.eventId}/people/${e.registrationId}`}>{e.person}</Link> : e.person}
                        <span className="log-verb"> {scanVerb(e.contextType, e.direction).toLowerCase()}</span> {e.contextType === 'meal' ? 'at' : e.contextType === 'site' ? 'at the' : e.direction === 'in' ? 'to' : 'of'}{' '}
                        {e.place}
                      </strong>
                      <span>
                        {e.actor ? `Scanned by ${e.actor}` : 'Scanned'}
                        {e.method === 'manual' && ', entered by hand'}
                        {e.method === 'code' && ', typed code'}
                        {e.method === 'correction' && ', correction'}
                        {!eventId && `, ${e.eventName}`}
                        {e.note && `. ${e.note}`}
                      </span>
                    </>
                  ) : (
                    <>
                      <strong>
                        {e.actor || 'Someone'} <span className="log-verb">{ACTIONS[e.action] ?? e.action.replace(/[._]/g, ' ')}</span> {e.target}
                      </strong>
                      <span>
                        {[describeDetail(e), !eventId && e.eventName ? e.eventName : '']
                          .filter(Boolean)
                          .join('. ')}
                      </span>
                    </>
                  )}
                </span>
                <span className="log-side">
                  <time dateTime={e.at}>{timeOf(e.at)}</time>
                  {e.kind === 'scan' && OUTCOME[e.outcome] && <span className={OUTCOME[e.outcome]!.tone}>{OUTCOME[e.outcome]!.label}</span>}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ))}
      {next && (
        <button
          className="btn btn-secondary btn-block"
          disabled={loadingMore}
          onClick={async () => {
            setLoadingMore(true);
            await load(next).catch(() => setError('Could not load more.'));
            setLoadingMore(false);
          }}
        >
          {loadingMore ? 'Loading…' : 'Show older'}
        </button>
      )}
    </div>
  );
}
