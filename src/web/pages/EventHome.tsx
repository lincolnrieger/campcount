import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { ApiFailure, api } from '../api';
import type { Registration, Where } from '../model';
import { recordByHand } from '../scan/manual';
import { canScan } from '../scan/targets';
import { useApi } from '../useApi';
import { matchesSearch, searchRank } from '../../shared/search';
import { timeInZone } from '../../shared/time';
import {
  Badge,
  Banner,
  Button,
  ButtonLink,
  EmptyState,
  Icon,
  LoadError,
  Loading,
  PageHeader,
  SearchField,
  SkeletonRows,
  SkeletonTiles,
  StatStrip,
  Toolbar,
  formatDateRange,
  useConfirm,
  useRemembered,
  useToast,
  useWide,
} from '../ui';
import type { Tone } from '../ui';
import { useEvent } from './EventLayout';
import { usePolling } from '../usePolling';

interface Person extends Where {
  id: string;
  fullName: string;
  groupName: string;
  level: string;
  kind: string;
}
interface WhereData {
  generatedAt: string;
  timezone: string;
  siteTracked: boolean;
  people: Person[];
  activities: { key: string; name: string; capacity: number | null; trackSignOut: boolean; presentNow: number }[];
}
interface LiveData {
  roster: { active: number };
  openItems: number;
}

type Filter = 'all' | 'never' | 'on' | 'off' | 'activity';

/** Where someone is, as a word and a tone, for the list. */
function placeOf(p: Person, tz: string): { label: string; tone: Tone } {
  if (p.activities.length) return { label: `At ${p.activities.map((a) => a.name).join(', ')}`, tone: 'info' };
  if (p.site === 'on') return { label: 'On site', tone: 'success' };
  if (p.site === 'off') return { label: `Left${p.siteSince ? ` ${timeInZone(p.siteSince, tz)}` : ''}`, tone: 'neutral' };
  if (p.site === 'never') return { label: 'Not arrived', tone: 'warning' };
  return { label: p.lastSeen ? `Last seen: ${p.lastSeen.contextName}` : 'Not scanned', tone: 'neutral' };
}

const ORDER: Record<string, number> = { never: 0, on: 1, off: 2 };
const PAGE = 50;
const FILTER_TITLE: Record<Filter, string> = { all: 'Everyone', on: 'On site', off: 'Left camp', never: 'Not arrived', activity: 'At activities' };
const levelOf = (p: Person) => (p.kind === 'adult' ? 'Leader' : p.level);

/**
 * An event's home. Open: who's here and who's missing, with one-tap
 * arrivals. Draft: what's left to set up. Staff who only scan or lead
 * activities get their way in.
 */
export function EventHome() {
  const { event, can } = useEvent();
  const draft = event.status === 'draft';
  const scanLink = canScan(event) ? `/scan?event=${event.id}` : null;
  const summary = (
    <>
      <span className="sep">{formatDateRange(event.startsOn, event.endsOn)}</span>
      {event.location && <span className="sep">{event.location}</span>}
      {event.isDemo && <Badge tone="info">Demo</Badge>}
      {event.status !== 'open' && <Badge tone={draft ? 'warning' : 'neutral'}>{STATUS_WORD[event.status]}</Badge>}
    </>
  );
  return (
    <>
      <PageHeader
        title={event.name}
        summary={summary}
        primary={
          scanLink && (
            <ButtonLink to={scanLink} kind="primary">
              <Icon name="scan" />
              Start scanning
            </ButtonLink>
          )
        }
      />
      <div className="sections home">
        {event.description && (
          <details className="panel notes home-notes">
            <summary>
              <span>
                <Icon name="clipboard" size={18} /> Notes for staff
              </span>
              <Icon name="down" />
            </summary>
            <p>{event.description}</p>
          </details>
        )}
        {draft && can('event.configure') && <GetReady />}
        {draft && !can('event.configure') && <Banner>Not open yet. Scanning starts when an event manager opens it.</Banner>}
        {!draft && can('reports.view') && <WhereEveryoneIs />}
        {!draft && !can('reports.view') && <JustScanning />}
      </div>
    </>
  );
}

const STATUS_WORD: Record<string, string> = { draft: 'Draft', open: 'Open', completed: 'Closed', archived: 'Archived', cancelled: 'Cancelled' };

/** For scanners, the meal team and activity leaders: their way in. */
function JustScanning() {
  const { event, can } = useEvent();
  if (event.features.activities && can('activity.view_roster') && !can('site.scan') && !can('meal.scan')) {
    return (
      <EmptyState title="Your activities are on the Activities tab" actions={<ButtonLink to="activities">Open activities</ButtonLink>}>
        See who's booked, who's here, and check people in.
      </EmptyState>
    );
  }
  if (event.status !== 'open') return <EmptyState title="This event is closed">Scanning has stopped.</EmptyState>;
  return null;
}

/** Draft events: the setup steps in order, each ticking itself off, then Open event. */
function GetReady() {
  const { event, can, reload } = useEvent();
  const confirm = useConfirm();
  const toast = useToast();
  const roster = useApi<{ registrations: Registration[] }>(can('roster.view') ? `/events/${event.id}/registrations` : null);
  const activities = useApi<{ activities: unknown[] }>(event.features.activities && can('activities.manage') ? `/events/${event.id}/activities` : null);
  const staff = useApi<{ staff: unknown[] }>(can('staff.manage') ? `/events/${event.id}/staff` : null);
  const meals = useApi<{ meals: unknown[] }>(event.features.meals && can('meals.manage') ? `/events/${event.id}/meals` : null);
  const people = roster.data?.registrations.filter((r) => r.status === 'active') ?? [];
  const staffCount = staff.data?.staff.length ?? 0;
  const activityCount = activities.data?.activities.length ?? 0;
  const mealCount = meals.data?.meals.length ?? 0;
  const carded = people.filter((r) => r.shortCode).length;
  const steps = [
    can('staff.manage') && { label: 'Add staff', hint: staff.data ? `${staffCount} on staff` : 'Managers, scanners, leaders', to: 'settings/staff', done: staffCount > 1 },
    can('roster.edit') && { label: 'Add people', hint: roster.data ? `${people.length} added` : 'Import or add by hand', to: 'people', done: people.length > 0 },
    event.features.activities && can('activities.manage') && { label: 'Add activities', hint: `${activityCount} added`, to: 'activities', done: activityCount > 0 },
    event.features.meals && can('meals.manage') && { label: 'Add meals', hint: `${mealCount} added`, to: 'meals', done: mealCount > 0 },
    can('credentials.manage') && {
      label: 'Print lanyards',
      hint: people.length ? `${carded} of ${people.length} have a card` : 'One card per person',
      to: 'people/lanyards/print',
      done: people.length > 0 && people.every((r) => r.shortCode),
    },
  ].filter((s): s is { label: string; hint: string; to: string; done: boolean } => Boolean(s));
  const loading = roster.loading || staff.loading || activities.loading || meals.loading;
  const done = steps.filter((s) => s.done).length;

  return (
    <section className="ready" aria-labelledby="ready-heading">
      <div className="ready-steps">
        <div className="section-head">
          <h2 id="ready-heading">Get ready</h2>
          {!loading && steps.length > 0 && (
            <span className="meta">
              {done} of {steps.length} done
            </span>
          )}
        </div>
        {loading ? (
          <Loading what="setup steps">
            <SkeletonRows rows={steps.length || 4} />
          </Loading>
        ) : (
          <ol className="list checklist">
            {steps.map((s, i) => (
              <li key={s.to} className={s.done ? 'row row-link is-done' : 'row row-link'}>
                <span className="row-mark" aria-hidden="true">
                  {s.done ? '✓' : i + 1}
                </span>
                <span className="row-main">
                  <span className="row-title">
                    <Link to={s.to}>
                      {s.label}
                      {s.done && <span className="visually-hidden"> (done)</span>}
                    </Link>
                  </span>
                  <span className="row-meta">{s.hint}</span>
                </span>
                <span className="row-chevron">
                  <Icon name="chevron" />
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="panel panel-pad ready-open">
        <h2 className="ready-open-title">Open the event</h2>
        <p className="meta">Scanning starts once it's open. You can still change everything after.</p>
        <Button
          kind="primary"
          busyLabel="Opening…"
          onAction={async () => {
            const ok = await confirm({
              title: `Open ${event.name}?`,
              body: <p>Staff on this event will be able to scan straight away.</p>,
              confirm: 'Open event',
            });
            if (!ok) return;
            try {
              await api(`/events/${event.id}/transition`, { body: { to: 'open' } });
              toast('Event opened. Staff can scan now.');
              await reload();
            } catch (err) {
              toast(err instanceof ApiFailure ? err.message : 'No connection. Try again.', { tone: 'error' });
            }
          }}
        >
          Open event
        </Button>
      </div>
    </section>
  );
}

/** Who's on site, who hasn't arrived, who's left: counts that filter, a search and one list. */
function WhereEveryoneIs() {
  const { event, can } = useEvent();
  const toast = useToast();
  const wide = useWide();
  // After marking someone by hand, ask for a fresh copy (the server reuses dashboards for a few seconds).
  const [fresh, setFresh] = useState(0);
  const where = useApi<WhereData>(`/events/${event.id}/whereabouts${fresh ? `?fresh=${fresh}` : ''}`);
  const live = useApi<LiveData>(`/events/${event.id}/live`);
  const reloadWhere = where.reload;
  const reloadLive = live.reload;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useRemembered<Filter>(`home:${event.id}:filter`, 'all');
  const [level, setLevel] = useRemembered<string>(`home:${event.id}:level`, '');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void reloadWhere();
    void reloadLive();
  }, [reloadWhere, reloadLive]);
  // Keep it current while it's open on a screen at HQ.
  usePolling(refresh, 30_000);

  const canMark = event.status === 'open' && event.features.site && can('site.scan');

  async function mark(p: Person, direction: 'in' | 'out') {
    setBusy(p.id);
    try {
      const r = await recordByHand(event.id, { contextType: 'site', contextId: null, direction, registrationId: p.id });
      if (r.outcome === 'accepted') toast(`${p.fullName} marked ${direction === 'in' ? 'arrived' : 'left'}`);
      else toast(`${p.fullName}: ${r.message}`, { tone: 'error' });
      setFresh((n) => n + 1);
    } catch (err) {
      toast(err instanceof ApiFailure ? err.message : 'No connection. Use the scanner, which works offline.', { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  if (where.loading && !where.data)
    return (
      <Loading what="where everyone is">
        <SkeletonTiles count={4} />
        <SkeletonRows rows={6} action />
      </Loading>
    );
  if (where.error) return <LoadError error={where.error} onRetry={reloadWhere} what="where everyone is" />;
  if (!where.data) return null;

  const tz = where.data.timezone;
  const people = where.data.people;
  const tracked = where.data.siteTracked;
  // A remembered site filter means nothing once the site isn't tracked.
  const active: Filter = !tracked && filter !== 'all' && filter !== 'activity' ? 'all' : filter;
  const count = (v: 'on' | 'off' | 'never') => people.filter((p) => p.site === v).length;
  const atActivities = people.filter((p) => p.activities.length > 0).length;
  const levels = [...new Set(people.map(levelOf))].filter(Boolean).sort();
  const shown = people
    .filter((p) => active === 'all' || (active === 'activity' ? p.activities.length > 0 : p.site === active))
    .filter((p) => !level || levelOf(p) === level)
    .filter((p) => matchesSearch(query, p.fullName, p.groupName))
    .sort(
      (a, b) =>
        (query ? searchRank(query, a.fullName) - searchRank(query, b.fullName) : 0) ||
        (ORDER[a.site ?? ''] ?? 3) - (ORDER[b.site ?? ''] ?? 3) ||
        a.fullName.localeCompare(b.fullName),
    );
  const visible = shown.slice(0, limit);
  const at = new Date(where.data.generatedAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const pick = (f: Filter) => {
    setFilter(active === f ? 'all' : f);
    setLimit(PAGE);
  };
  const filtered = active !== 'all' || level !== '';

  const action = (p: Person) =>
    canMark && p.site !== null ? (
      <Button small busy={busy === p.id} busyLabel="Saving…" onClick={() => void mark(p, p.site === 'on' ? 'out' : 'in')}>
        {p.site === 'on' ? 'Left' : 'Arrived'}
        <span className="visually-hidden"> {p.fullName}</span>
      </Button>
    ) : null;

  const stats = tracked
    ? [
        { label: 'On site', value: count('on'), tone: 'success' as Tone, pressed: active === 'on', onPress: () => pick('on') },
        { label: 'Not arrived', value: count('never'), tone: 'warning' as Tone, pressed: active === 'never', onPress: () => pick('never') },
        { label: 'Left camp', value: count('off'), pressed: active === 'off', onPress: () => pick('off') },
        { label: 'At activities', value: atActivities, pressed: active === 'activity', onPress: () => pick('activity') },
      ]
    : [
        { label: 'Expected', value: live.data?.roster.active ?? people.length },
        { label: 'At activities now', value: atActivities, pressed: active === 'activity', onPress: () => pick('activity') },
      ];

  return (
    <>
      <StatStrip items={stats} />

      {(live.data?.openItems ?? 0) > 0 && (
        <Banner
          tone="warning"
          action={
            <ButtonLink to="reports" small>
              Check
            </ButtonLink>
          }
        >
          {live.data!.openItems} scan{live.data!.openItems === 1 ? '' : 's'} to check <span className="meta">· unknown cards or sign-outs without a sign-in</span>
        </Banner>
      )}

      <section className="section" aria-labelledby="people-heading">
        <Toolbar sticky label="Find people">
          <h2 id="people-heading" className="home-list-title">
            {FILTER_TITLE[active]}
          </h2>
          <SearchField id="find-person" label="Find a person" placeholder="Name or group" value={query} onChange={(v) => (setQuery(v), setLimit(PAGE))} slash />
          {levels.length > 1 && (
            <select className="select" aria-label="Level" value={level} onChange={(e) => (setLevel(e.target.value), setLimit(PAGE))}>
              <option value="">All levels</option>
              {levels.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          {filtered && (
            <Button
              small
              kind="ghost"
              onClick={() => {
                setFilter('all');
                setLevel('');
              }}
            >
              Show everyone
            </Button>
          )}
          <div className="toolbar-end">
            <span className="meta" aria-live="polite">
              {shown.length} {shown.length === 1 ? 'person' : 'people'} · {at}
            </span>
            <Button small kind="ghost" onAction={refresh} aria-label="Refresh now" title="Refresh now">
              <Icon name="sync" size={18} />
            </Button>
          </div>
        </Toolbar>

        {shown.length === 0 ? (
          <EmptyState title={query ? `No one matches "${query}"` : 'No one here'}>{query ? 'Check the spelling, or search by group.' : undefined}</EmptyState>
        ) : wide ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Level</th>
                  <th scope="col">Group</th>
                  <th scope="col">Where</th>
                  {canMark && (
                    <th scope="col" className="cell-action">
                      <span className="visually-hidden">Mark by hand</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const place = placeOf(p, tz);
                  return (
                    <tr key={p.id} className="row-link">
                      <td>
                        <Link to={`people/${p.id}`} state={{ from: 'home' }} className="cell-link">
                          {p.fullName}
                        </Link>
                      </td>
                      <td>{levelOf(p)}</td>
                      <td>{p.groupName}</td>
                      <td>
                        <Badge tone={place.tone}>{place.label}</Badge>
                      </td>
                      {canMark && <td className="cell-action">{action(p)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="list">
            {visible.map((p) => {
              const place = placeOf(p, tz);
              return (
                <li key={p.id} className="row row-link">
                  <span className="row-main">
                    <span className="row-title">
                      <Link to={`people/${p.id}`} state={{ from: 'home' }}>
                        {p.fullName}
                      </Link>
                    </span>
                    <span className="row-meta">{[levelOf(p), p.groupName].filter(Boolean).join(' · ')}</span>
                    <span>
                      <Badge tone={place.tone}>{place.label}</Badge>
                    </span>
                  </span>
                  <span className="row-side">{action(p)}</span>
                </li>
              );
            })}
          </ul>
        )}
        {shown.length > limit && (
          <div className="home-more">
            <span className="meta">
              Showing {limit} of {shown.length}
            </span>
            <Button small onClick={() => setLimit(shown.length)}>
              Show all {shown.length}
            </Button>
          </div>
        )}
      </section>
    </>
  );
}
