import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { matchesSearch, searchRank } from '../../shared/search';
import { timeInZone } from '../../shared/time';
import type { Where } from './Person';
import { ApiFailure } from '../api';
import { recordByHand } from '../scan/manual';
import { Loading, LoadError, Notice, Skeleton, SkeletonList, SkeletonTiles } from '../components/ui';
import { useToast } from '../components/Toast';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';

interface ContextSummary {
  key: string;
  type: 'activity' | 'meal' | 'site';
  name: string;
  status: string;
  capacity: number | null;
  trackSignOut: boolean;
  presentNow: number;
  people: number;
  duplicates: number;
  needsReview: number;
  expected: number | null;
}
interface LiveData {
  generatedAt: string;
  timezone: string;
  roster: { active: number; youth: number; adults: number; withdrawn: number };
  contexts: ContextSummary[];
  openItems: number;
  devices: { deviceId: string; lastUpload: string; scans: number }[];
}

export function minutesAgo(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min ago` : `${Math.floor(h / 24)} days ago`;
}

interface WherePerson extends Where {
  id: string;
  fullName: string;
  groupName: string;
  section: string;
  kind: string;
}
interface WhereData {
  generatedAt: string;
  timezone: string;
  siteTracked: boolean;
  people: WherePerson[];
  activities: { key: string; name: string; capacity: number | null; trackSignOut: boolean; presentNow: number }[];
}

type Filter = { kind: 'all' } | { kind: 'site'; value: 'on' | 'off' | 'never' };

/** Short answer to "where are they?" for the list. */
function placeOf(p: WherePerson, tz: string): { label: string; tone: string } {
  if (p.activities.length) return { label: p.activities.map((a) => a.name).join(', '), tone: 'place place-activity' };
  if (p.site === 'on') return { label: 'On site', tone: 'place place-on' };
  if (p.site === 'off') return { label: `Left ${p.siteSince ? timeInZone(p.siteSince, tz) : ''}`, tone: 'place place-off' };
  if (p.site === 'never') return { label: 'Not arrived', tone: 'place place-never' };
  return { label: p.lastSeen ? p.lastSeen.contextName : 'Not scanned', tone: 'place place-never' };
}

type GroupBy = 'where' | 'group' | 'section';

interface PeopleGroup {
  key: string;
  title: string;
  note: string;
  count: number;
  tone: string;
  people: WherePerson[];
}

/** Sections for the board: by where people are, by Scout group, or by section. */
function groupPeople(people: WherePerson[], by: GroupBy, data: WhereData): PeopleGroup[] {
  const make = (key: string, title: string, list: WherePerson[], tone: string, note = ''): PeopleGroup => ({ key, title, note, count: list.length, tone, people: list });
  if (by === 'where') {
    const groups: PeopleGroup[] = [];
    // Who hasn't arrived is what needs doing, so it comes first.
    if (data.siteTracked) groups.push(make('never', 'Not arrived', people.filter((p) => p.activities.length === 0 && p.site === 'never'), 'dot-never'));
    for (const a of data.activities.filter((x) => x.trackSignOut)) {
      const here = people.filter((p) => p.activities.some((x) => x.key === a.key));
      if (here.length) groups.push(make(a.key, a.name, here, 'dot-activity', a.capacity ? `${a.presentNow} of ${a.capacity} places` : ''));
    }
    const free = people.filter((p) => p.activities.length === 0);
    if (data.siteTracked) {
      groups.push(make('on', 'On site, not at an activity', free.filter((p) => p.site === 'on'), 'dot-on'));
      groups.push(make('off', 'Left camp', free.filter((p) => p.site === 'off'), 'dot-off'));
    } else {
      groups.push(make('free', 'Not at an activity', free, 'dot-never'));
    }
    return groups.filter((g) => g.count > 0);
  }
  const keyOf = (p: WherePerson) => (by === 'group' ? p.groupName || 'No group' : p.kind === 'adult' ? 'Leaders' : p.section || 'Other');
  const order = ['Joeys', 'Cubs', 'Scouts', 'Venturers', 'Rovers', 'Leaders', 'Other'];
  const names = [...new Set(people.map(keyOf))].sort((a, b) => (by === 'section' ? order.indexOf(a) - order.indexOf(b) : a.localeCompare(b)));
  return names.map((name) => {
    const list = people.filter((p) => keyOf(p) === name);
    const on = list.filter((p) => p.site === 'on').length;
    const busy = list.filter((p) => p.activities.length > 0).length;
    const note = [data.siteTracked ? `${on} on site` : null, busy ? `${busy} at activities` : null].filter(Boolean).join(', ');
    return make(`${by}:${name}`, name, list, 'dot-group', note);
  });
}


/**
 * Where everyone is: the main panel of the event dashboard. Figures that
 * double as filters, a search, and everyone grouped by place, Scout group
 * or section. People not yet arrived come first, with a one-tap "Arrived"
 * for latecomers who reach camp without their card.
 */
export function LiveBoard() {
  const { event, can } = useEvent();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<LiveData>(`/events/${event.id}/live`);
  const where = useApi<WhereData>(`/events/${event.id}/whereabouts`);
  const reloadWhere = where.reload;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [groupBy, setGroupBy] = useState<GroupBy>('where');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      void reload();
      void reloadWhere();
    }, 30_000);
    return () => clearInterval(timer);
  }, [reload, reloadWhere]);
  const canMark = event.status === 'open' && event.features.site && can('site.scan');

  async function mark(p: WherePerson, direction: 'in' | 'out') {
    setBusy(p.id);
    try {
      const r = await recordByHand(event.id, { contextType: 'site', contextId: null, direction, registrationId: p.id });
      toast(r.outcome === 'accepted' ? `${p.fullName} ${direction === 'in' ? 'arrived' : 'left camp'}.` : `${p.fullName}: ${r.message}`, {
        tone: r.outcome === 'accepted' ? 'ok' : 'stop',
      });
      await Promise.all([reload(), reloadWhere()]);
    } catch (err) {
      toast(err instanceof ApiFailure ? err.message : 'No connection. Use the scanner, which works offline.', { tone: 'stop' });
    } finally {
      setBusy(null);
    }
  }

  if ((loading && !data) || (where.loading && !where.data))
    return (
      <Loading label="Loading where everyone is">
        <SkeletonTiles />
        <Skeleton width="100%" height="var(--control)" radius="var(--radius-control)" className="skeleton-gap" />
        <SkeletonList rows={5} lines={2} aside="button" heading />
      </Loading>
    );
  if (error || where.error)
    return (
      <LoadError
        error={(error ?? where.error)!}
        onRetry={async () => {
          await Promise.all([reload(), reloadWhere()]);
        }}
      />
    );
  if (!data || !where.data) return null;
  const tz = data.timezone;
  const at = new Date(data.generatedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const meals = data.contexts.filter((c) => c.type === 'meal' && c.status === 'active' && c.people > 0);
  const atActivities = data.contexts.filter((c) => c.type === 'activity' && c.trackSignOut).reduce((n, c) => n + c.presentNow, 0);
  const people = where.data.people;
  const count = (v: 'on' | 'off' | 'never') => people.filter((p) => p.site === v).length;
  const shown = people
    .filter((p) => (filter.kind === 'site' ? p.site === filter.value : true))
    .filter((p) => matchesSearch(query, p.fullName, p.groupName))
    .sort((a, b) => (query ? searchRank(query, a.fullName) - searchRank(query, b.fullName) : 0) || a.fullName.localeCompare(b.fullName));
  const groups = groupPeople(shown, groupBy, where.data);
  const pick = (f: Filter) => setFilter(JSON.stringify(f) === JSON.stringify(filter) ? { kind: 'all' } : f);
  const isOn = (f: Filter) => JSON.stringify(f) === JSON.stringify(filter);

  return (
    <div className="board">
      {data.openItems > 0 && (
        <Notice tone="warn">
          <p>
            {data.openItems} scan{data.openItems === 1 ? '' : 's'} to check (unknown cards or sign-outs without a sign-in).{' '}
            <Link to="reports">Sort them out</Link>
          </p>
        </Notice>
      )}

      {where.data.siteTracked ? (
        <div className="tiles">
          {(
            [
              ['on', 'On site'],
              ['off', 'Left camp'],
              ['never', 'Not arrived'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" className={`tile tile-${v}`} aria-pressed={isOn({ kind: 'site', value: v })} onClick={() => pick({ kind: 'site', value: v })}>
              <strong>{count(v)}</strong>
              <span>{label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="tiles tiles-2">
          <div className="tile">
            <strong>{data.roster.active}</strong>
            <span>Expected</span>
          </div>
          <div className="tile tile-on">
            <strong>{atActivities}</strong>
            <span>At activities now</span>
          </div>
        </div>
      )}

      <div className="toolbar">
        <input
          className="input input-search toolbar-search"
          type="search"
          aria-label="Find a person"
          placeholder="Find a person"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className="input" aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
          <option value="where">By where they are</option>
          <option value="group">By Scout group</option>
          <option value="section">By section</option>
        </select>
        {filter.kind !== 'all' && (
          <button className="filter-chip" onClick={() => setFilter({ kind: 'all' })}>
            {filter.value === 'on' ? 'On site' : filter.value === 'off' ? 'Left camp' : 'Not arrived'}
            <Icon name="close" size={14} />
            <span className="visually-hidden">Clear filter</span>
          </button>
        )}
        <p className="toolbar-count">Updated {at}</p>
      </div>

      {groups.length === 0 && (
        <div className="empty">
          <p className="flush">No one matches.</p>
        </div>
      )}
      <div className="board-groups">
        {groups.map((g) => {
          const closed = collapsed.has(g.key) && !query;
          return (
            <section key={g.key} className="board-group">
              <button
                type="button"
                className="board-group-head"
                aria-expanded={!closed}
                onClick={() => {
                  const next = new Set(collapsed);
                  if (next.has(g.key)) next.delete(g.key);
                  else next.add(g.key);
                  setCollapsed(next);
                }}
              >
                <span className={`board-group-dot ${g.tone}`} aria-hidden="true" />
                <span className="board-group-title">
                  <strong>{g.title}</strong>
                  {g.note && <span>{g.note}</span>}
                </span>
                <span className="board-group-count">{g.count}</span>
                <span className={closed ? 'board-chevron' : 'board-chevron is-open'} aria-hidden="true">
                  <Icon name="chevron" size={18} />
                </span>
              </button>
              {!closed && (
                <ul className="list">
                  {g.people.slice(0, 150).map((p) => {
                    const place = placeOf(p, tz);
                    return (
                      <li key={p.id} className="list-row board-row">
                        <span className="list-main">
                          <Link to={`people/${p.id}`} className="person-link">
                            {p.fullName}
                          </Link>
                          <span>
                            {groupBy === 'group' ? (p.kind === 'adult' ? 'Leader' : p.section) : p.groupName}
                            {p.lastSeen && ` · ${p.lastSeen.contextName} ${timeInZone(p.lastSeen.at, tz)}`}
                          </span>
                        </span>
                        {groupBy !== 'where' && <span className={place.tone}>{place.label}</span>}
                        {canMark && p.site !== null && (
                          <button className="btn btn-secondary btn-small" disabled={busy === p.id} onClick={() => void mark(p, p.site === 'on' ? 'out' : 'in')}>
                            {busy === p.id ? 'Saving…' : p.site === 'on' ? 'Left' : 'Arrived'}
                            <span className="visually-hidden"> {p.fullName}</span>
                          </button>
                        )}
                      </li>
                    );
                  })}
                  {g.people.length > 150 && <li className="list-row field-hint">And {g.people.length - 150} more. Search to find someone.</li>}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      {meals.length > 0 && (
        <section className="list-section section-gap">
          <h2 className="list-heading">Meals</h2>
          <ul className="stat-rows">
            {meals.map((m) => (
              <li key={m.key}>
                <strong>{m.name}</strong>
                <span className="stat-value">
                  {m.people} <span>of {m.expected} served</span>
                </span>
                {m.duplicates > 0 && <span className="stat-note">{m.duplicates} repeat scans ignored</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.devices.length > 0 && (
        <details className="section-gap">
          <summary>Scanning phones ({data.devices.length})</summary>
          <p className="field-hint">If a phone has not uploaded for a while, it may be out of signal with scans waiting.</p>
          <ul>
            {data.devices.map((d) => (
              <li key={d.deviceId}>
                Phone …{d.deviceId.slice(-4)}: {d.scans} scans, last upload {minutesAgo(d.lastUpload)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
