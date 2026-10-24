import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { matchesSearch, searchRank } from '../../shared/search';
import { timeInZone } from '../../shared/time';
import type { Where } from './Person';
import { Loading, Notice } from '../components/ui';
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
    for (const a of data.activities.filter((x) => x.trackSignOut)) {
      const here = people.filter((p) => p.activities.some((x) => x.key === a.key));
      if (here.length) groups.push(make(a.key, a.name, here, 'dot-activity', a.capacity ? `${a.presentNow} of ${a.capacity} places` : ''));
    }
    const free = people.filter((p) => p.activities.length === 0);
    if (data.siteTracked) {
      groups.push(make('on', 'On site, not at an activity', free.filter((p) => p.site === 'on'), 'dot-on'));
      groups.push(make('off', 'Left camp', free.filter((p) => p.site === 'off'), 'dot-off'));
      groups.push(make('never', 'Not arrived', free.filter((p) => p.site === 'never'), 'dot-never'));
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

export function Live() {
  const { event } = useEvent();
  const { data, error, loading, reload } = useApi<LiveData>(`/events/${event.id}/live`);
  const where = useApi<WhereData>(`/events/${event.id}/whereabouts`);
  const reloadWhere = where.reload;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [groupBy, setGroupBy] = useState<GroupBy>('where');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    const timer = setInterval(() => {
      void reload();
      void reloadWhere();
    }, 30_000);
    return () => clearInterval(timer);
  }, [reload, reloadWhere]);

  if ((loading && !data) || (where.loading && !where.data)) return <Loading />;
  if (error || where.error) return <Notice tone="stop">{(error ?? where.error)!.message}</Notice>;
  if (!data || !where.data) return null;
  const tz = data.timezone;
  const at = new Date(data.generatedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const meals = data.contexts.filter((c) => c.type === 'meal' && c.status === 'active');
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
      <p className="field-hint">
        As of {at}, updating every 30 seconds. Phones without signal upload later, so recent changes can take a while to show.
      </p>
      {data.openItems > 0 && (
        <Notice tone="warn">
          <p>
            {data.openItems} scan{data.openItems === 1 ? '' : 's'} to check (unknown cards or sign-outs without a sign-in). See <a href="close-out">Close-out</a>.
          </p>
        </Notice>
      )}

      {where.data.siteTracked && (
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
      )}

      <section className="list-section">
        <div className="segmented segmented-3" role="tablist" aria-label="Group people by">
          {(
            [
              ['where', 'Where'],
              ['group', 'Scout group'],
              ['section', 'Section'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={groupBy === k} onClick={() => setGroupBy(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="board-search">
          <input className="input" type="search" aria-label="Search people" placeholder="Search names or groups, even one letter" value={query} onChange={(e) => setQuery(e.target.value)} />
          {filter.kind !== 'all' && (
            <button className="filter-chip" onClick={() => setFilter({ kind: 'all' })}>
              {filter.value === 'on' ? 'On site' : filter.value === 'off' ? 'Left camp' : 'Not arrived'}
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </section>

      {groups.length === 0 && <p className="field-hint">No one matches.</p>}
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
                    <li key={p.id}>
                      <Link to={`../roster/${p.id}`} relative="path" className="list-row board-row">
                        <span className="list-main">
                          <strong>{p.fullName}</strong>
                          <span>
                            {groupBy === 'group' ? (p.kind === 'adult' ? 'Leader' : p.section) : p.groupName}
                            {p.lastSeen && ` · ${p.lastSeen.contextName} ${timeInZone(p.lastSeen.at, tz)}`}
                          </span>
                        </span>
                        {groupBy !== 'where' && <span className={place.tone}>{place.label}</span>}
                      </Link>
                    </li>
                  );
                })}
                {g.people.length > 150 && <li className="list-row field-hint">And {g.people.length - 150} more. Search to find someone.</li>}
              </ul>
            )}
          </section>
        );
      })}

      {meals.length > 0 && (
        <section className="list-section">
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
