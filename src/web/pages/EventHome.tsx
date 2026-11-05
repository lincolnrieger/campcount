import { useEffect, useState } from 'react';
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
  Button,
  ButtonLink,
  CountTile,
  EmptyState,
  Icon,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  SearchField,
  Section,
  SkeletonRows,
  SkeletonTiles,
  formatDateRange,
  useConfirm,
  useToast,
  useWide,
} from '../ui';
import type { Tone } from '../ui';
import { useEvent } from './EventLayout';

interface Person extends Where {
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
  people: Person[];
  activities: { key: string; name: string; capacity: number | null; trackSignOut: boolean; presentNow: number }[];
}
interface LiveData {
  roster: { active: number };
  openItems: number;
}

type Filter = 'all' | 'never' | 'on' | 'off';

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
      <div className="sections">
        {event.description && (
          <details className="panel panel-pad notes">
            <summary>
              Notes for staff
              <Icon name="down" />
            </summary>
            <p>{event.description}</p>
          </details>
        )}
        {draft && can('event.configure') && <GetReady />}
        {draft && !can('event.configure') && (
          <Notice title="This event hasn't opened yet">
            <p>Scanning starts when an event manager opens it.</p>
          </Notice>
        )}
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
  const steps = [
    can('staff.manage') && { label: 'Add staff', hint: 'Event managers, scanners, activity leaders and the meal team', to: 'settings/staff', done: (staff.data?.staff.length ?? 0) > 1 },
    can('roster.edit') && { label: 'Add people', hint: 'Import from MyScout, or add people one at a time', to: 'people', done: people.length > 0 },
    event.features.activities && can('activities.manage') && { label: 'Add activities', hint: 'With their days and times', to: 'activities', done: (activities.data?.activities.length ?? 0) > 0 },
    event.features.meals && can('meals.manage') && { label: 'Add meals', hint: 'Each meal you want to count', to: 'meals', done: (meals.data?.meals.length ?? 0) > 0 },
    can('credentials.manage') && { label: 'Print lanyards', hint: 'One card per person, with their QR code', to: 'people/lanyards', done: people.length > 0 && people.every((r) => r.shortCode) },
  ].filter((s): s is { label: string; hint: string; to: string; done: boolean } => Boolean(s));
  const loading = roster.loading || staff.loading || activities.loading || meals.loading;

  return (
    <Section title="Get ready" id="ready">
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
      <div className="stack ready-open">
        <p className="meta">Nobody can scan until the event is open. You can keep changing things afterwards.</p>
        <div>
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
      </div>
    </Section>
  );
}

/** Who's on site, who hasn't arrived, who's left: counts that filter, a search and one list. */
function WhereEveryoneIs() {
  const { event, can } = useEvent();
  const toast = useToast();
  const wide = useWide();
  const where = useApi<WhereData>(`/events/${event.id}/whereabouts`);
  const live = useApi<LiveData>(`/events/${event.id}/live`);
  const reloadWhere = where.reload;
  const reloadLive = live.reload;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);

  // Keep it current while it's open on a screen at HQ.
  useEffect(() => {
    const t = setInterval(() => {
      void reloadWhere();
      void reloadLive();
    }, 30_000);
    return () => clearInterval(t);
  }, [reloadWhere, reloadLive]);

  const canMark = event.status === 'open' && event.features.site && can('site.scan');

  async function mark(p: Person, direction: 'in' | 'out') {
    setBusy(p.id);
    try {
      const r = await recordByHand(event.id, { contextType: 'site', contextId: null, direction, registrationId: p.id });
      if (r.outcome === 'accepted') toast(`${p.fullName} marked ${direction === 'in' ? 'arrived' : 'left'}`);
      else toast(`${p.fullName}: ${r.message}`, { tone: 'error' });
      await reloadWhere();
    } catch (err) {
      toast(err instanceof ApiFailure ? err.message : 'No connection. Use the scanner, which works offline.', { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  if (where.loading && !where.data)
    return (
      <Loading what="where everyone is">
        <SkeletonTiles />
        <SkeletonRows rows={6} action />
      </Loading>
    );
  if (where.error) return <LoadError error={where.error} onRetry={reloadWhere} what="where everyone is" />;
  if (!where.data) return null;

  const tz = where.data.timezone;
  const people = where.data.people;
  const count = (v: 'on' | 'off' | 'never') => people.filter((p) => p.site === v).length;
  const atActivities = people.filter((p) => p.activities.length > 0).length;
  const shown = people
    .filter((p) => filter === 'all' || p.site === filter)
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
    setFilter(filter === f ? 'all' : f);
    setLimit(PAGE);
  };

  const action = (p: Person) =>
    canMark && p.site !== null ? (
      <Button small busy={busy === p.id} busyLabel="Saving…" onClick={() => void mark(p, p.site === 'on' ? 'out' : 'in')}>
        {p.site === 'on' ? 'Left' : 'Arrived'}
        <span className="visually-hidden"> {p.fullName}</span>
      </Button>
    ) : null;

  return (
    <>
      {where.data.siteTracked ? (
        <div className="tiles">
          <CountTile value={count('on')} label="On site" tone="success" pressed={filter === 'on'} onPress={() => pick('on')} />
          <CountTile value={count('never')} label="Not arrived" tone="warning" pressed={filter === 'never'} onPress={() => pick('never')} />
          <CountTile value={count('off')} label="Left camp" pressed={filter === 'off'} onPress={() => pick('off')} />
        </div>
      ) : (
        <div className="tiles tiles-2">
          <CountTile value={live.data?.roster.active ?? people.length} label="Expected" />
          <CountTile value={atActivities} label="At activities now" tone="info" />
        </div>
      )}

      {(live.data?.openItems ?? 0) > 0 && (
        <Notice tone="warning">
          <p>
            {live.data!.openItems} scan{live.data!.openItems === 1 ? '' : 's'} to check: unknown cards, or sign-outs without a sign-in.{' '}
            <Link to="reports">Check them in Reports</Link>
          </p>
        </Notice>
      )}

      <Section
        title={filter === 'all' ? 'Everyone' : filter === 'on' ? 'On site' : filter === 'off' ? 'Left camp' : 'Not arrived'}
        id="people"
        actions={
          <span className="meta" aria-live="polite">
            {shown.length} {shown.length === 1 ? 'person' : 'people'} · updated {at}
          </span>
        }
      >
        <div className="toolbar">
          <SearchField id="find-person" label="Find a person" value={query} onChange={(v) => (setQuery(v), setLimit(PAGE))} />
          {filter !== 'all' && (
            <Button small kind="ghost" onClick={() => setFilter('all')}>
              Show everyone
            </Button>
          )}
        </div>

        {shown.length === 0 ? (
          <EmptyState title={query ? `No one matches "${query}"` : 'No one here'}>{query ? 'Check the spelling, or search by Scout group.' : undefined}</EmptyState>
        ) : wide ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Section</th>
                  <th scope="col">Scout group</th>
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
                      <td>{p.kind === 'adult' ? 'Leader' : p.section}</td>
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
                    <span className="row-meta">{[p.kind === 'adult' ? 'Leader' : p.section, p.groupName].filter(Boolean).join(' · ')}</span>
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
          <div>
            <Button onClick={() => setLimit(shown.length)}>Show all {shown.length}</Button>
          </div>
        )}
      </Section>
    </>
  );
}
