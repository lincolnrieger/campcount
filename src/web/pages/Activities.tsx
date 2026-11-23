import { useState } from 'react';
import { Link } from 'react-router';
import { matchesSearch } from '../../shared/search';
import { dayInZone, dayLabel, eventDays, timeInZone, todayInZone } from '../../shared/time';
import type { Activity } from '../model';
import { useApi } from '../useApi';
import { Badge, Button, ButtonLink, EmptyState, FilterChips, Icon, LoadError, Loading, PageHeader, SearchField, SkeletonRows, Toolbar, plural, useRemembered, useWide } from '../ui';
import { useEvent } from './EventLayout';

interface LiveContext {
  key: string;
  presentNow: number;
  people: number;
}

const ANY = 'any';
const ALL = 'all';
type Show = 'all' | 'signup' | 'full' | 'cancelled';

/** Activities: the programme, one day at a time. Each row opens the activity's page. */
export function Activities() {
  const { event, can, base } = useEvent();
  const { data, error, loading, reload } = useApi<{ activities: Activity[] }>(`/events/${event.id}/activities`);
  const live = useApi<{ contexts: LiveContext[] }>(can('reports.view') && event.status !== 'draft' ? `/events/${event.id}/live` : null);
  const [q, setQ] = useState('');
  const [day, setDay] = useRemembered<string | null>(`activities-day:${event.id}`, null);
  const [show, setShow] = useRemembered<Show>(`activities-show:${event.id}`, 'all');
  const wide = useWide();
  const manager = can('activities.manage');
  const editable = manager && (event.status === 'draft' || event.status === 'open');
  const tz = event.timezone;

  // Managers find team events on the Teams tab; their leaders see them here with their other activities.
  const all = (data?.activities ?? []).filter((a) => a.kind !== 'program' && !(manager && a.teamEvent) && (manager || a.status === 'active'));

  const header = (
    <PageHeader
      title="Activities"
      summary={manager ? (data && all.length > 0 ? plural(all.length, 'activity', 'activities') : undefined) : 'The activities you run'}
      help={manager ? 'Open an activity for its bookings, check-ins and settings. Team events are on Teams; programme items (Welcome, Movies) are on the Schedule.' : undefined}
      primary={
        editable && (
          <ButtonLink to="new" kind="primary">
            <Icon name="plus" />
            Add activity
          </ButtonLink>
        )
      }
      menu={
        manager
          ? [
              editable && { label: 'Import programme', to: `${base}/activities/import` },
              { label: 'Schedule', to: `${base}/schedule` },
            ]
          : undefined
      }
    />
  );

  if (loading && !data)
    return (
      <>
        {header}
        <Loading what="activities">
          <SkeletonRows rows={6} />
        </Loading>
      </>
    );
  if (error)
    return (
      <>
        {header}
        <LoadError error={error} onRetry={reload} what="activities" />
      </>
    );

  if (all.length === 0)
    return (
      <>
        {header}
        {manager ? (
          <EmptyState
            title="No activities yet"
            actions={
              editable && (
                <>
                  <ButtonLink to="new" kind="primary">
                    Add activity
                  </ButtonLink>
                  <ButtonLink to={`${base}/activities/import`}>Import programme</ButtonLink>
                </>
              )
            }
          >
            Running one several times? Add it once, then add sessions from its page.
          </EmptyState>
        ) : (
          <EmptyState title="No activities for you yet">An event manager gives you activities in Settings › Staff.</EmptyState>
        )}
      </>
    );

  const days = eventDays(event.startsOn, event.endsOn);
  const dayOf = (a: Activity) => (a.startsAt ? dayInZone(a.startsAt, tz) : ANY);
  const usedDays = days.filter((d) => all.some((a) => dayOf(a) === d));
  const bucket = (a: Activity) => (usedDays.includes(dayOf(a)) ? dayOf(a) : ANY);
  const hasAny = all.some((a) => bucket(a) === ANY);
  const today = todayInZone(tz);
  const dayValues = [...usedDays, ...(hasAny ? [ANY] : [])];
  const fallback = usedDays.includes(today) ? today : (dayValues[0] ?? ANY);
  const shownDay = day === ALL || (day && dayValues.includes(day)) ? day : fallback;
  const searching = q.trim() !== '';
  const contexts = new Map((live.data?.contexts ?? []).map((c) => [c.key, c]));
  const isFull = (a: Activity) => a.capacity !== null && a.booked >= a.capacity;
  const showMatch = (a: Activity) =>
    show === 'signup' ? a.signupOpen && a.status === 'active' : show === 'full' ? isFull(a) && a.status === 'active' : show === 'cancelled' ? a.status === 'cancelled' : true;
  const onDay = (a: Activity) => searching || dayValues.length < 2 || shownDay === ALL || bucket(a) === shownDay;

  const visible = all
    .filter((a) => (searching ? matchesSearch(q, a.name, a.location) : true) && onDay(a) && showMatch(a))
    .sort((x, y) => (x.startsAt ?? '').localeCompare(y.startsAt ?? '') || x.name.localeCompare(y.name));

  // Counts on the chips follow the other filter, so they say what pressing them would show.
  const dayCount = (d: string) => all.filter((a) => (d === ALL || bucket(a) === d) && showMatch(a)).length;
  const showCount = (s: Show) => all.filter((a) => (searching || dayValues.length < 2 || shownDay === ALL || bucket(a) === shownDay) && (s === 'all' || (s === 'signup' ? a.signupOpen && a.status === 'active' : s === 'full' ? isFull(a) && a.status === 'active' : a.status === 'cancelled'))).length;
  const showOptions = (
    [
      { value: 'all' as const, label: 'All' },
      { value: 'signup' as const, label: 'Sign-up open' },
      { value: 'full' as const, label: 'Full' },
      { value: 'cancelled' as const, label: 'Cancelled' },
    ] satisfies { value: Show; label: string }[]
  )
    .map((o) => ({ ...o, count: showCount(o.value) }))
    .filter((o) => o.value === 'all' || o.value === show || all.some((a) => (o.value === 'signup' ? a.signupOpen : o.value === 'full' ? isFull(a) : a.status === 'cancelled')));

  const nowCount = (a: Activity) => {
    const ctx = contexts.get(`activity:${a.id}`);
    return ctx ? (a.trackSignOut ? ctx.presentNow : ctx.people) : null;
  };
  const nowText = (a: Activity) => {
    const n = nowCount(a);
    return n !== null && n > 0 ? `${n} ${a.trackSignOut ? 'here now' : 'checked in'}` : '';
  };
  const bookedText = (a: Activity) => (a.capacity !== null ? `${a.booked}/${a.capacity}` : a.booked > 0 ? String(a.booked) : '');
  const badges = (a: Activity) => (
    <>
      {a.status === 'cancelled' && <Badge>Cancelled</Badge>}
      {a.status === 'active' && isFull(a) && <Badge tone="warning">Full</Badge>}
      {a.status === 'active' && a.signupOpen && <Badge tone="brand">Sign-up open</Badge>}
      {a.bookingRequired && <Badge>Booking required</Badge>}
    </>
  );
  const time = (a: Activity) =>
    a.startsAt ? (
      <>
        {timeInZone(a.startsAt, tz)}
        {a.endsAt && <span className="meta">{timeInZone(a.endsAt, tz)}</span>}
      </>
    ) : (
      <span className="meta">Any time</span>
    );
  const groupLabel = (d: string) => (d === ANY ? 'No time set' : d === today ? `Today, ${dayLabel(d)}` : dayLabel(d, 'long'));
  // "All days" and search results are grouped by day so the list still reads in order.
  const grouped = searching || shownDay === ALL;
  const groups = grouped ? dayValues.map((d) => [d, visible.filter((a) => bucket(a) === d)] as const).filter(([, l]) => l.length > 0) : [[shownDay, visible] as const];

  const table = (list: readonly Activity[], caption: string | null) => (
    <div key={caption ?? 'list'} className="pg-group">
      {caption && <h2 className="pg-group-heading">{caption}</h2>}
      <div className="table-wrap">
        <table className="table pg-table pg-table-fixed">
          <thead>
            <tr>
              <th scope="col" className="pg-col-time">
                Time
              </th>
              <th scope="col">Activity</th>
              <th scope="col" className="pg-col-place">
                Place
              </th>
              <th scope="col" className="cell-num pg-col-num">
                Booked
              </th>
              {live.data && (
                <th scope="col" className="cell-num pg-col-num">
                  Now
                </th>
              )}
              <th scope="col" className="pg-col-status">
                <span className="visually-hidden">Status</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.id} className={a.status === 'cancelled' ? 'row-link is-muted' : 'row-link'}>
                <td className="pg-col-time num">
                  <span className="activity-time">{time(a)}</span>
                </td>
                <td>
                  <Link to={a.id} className="cell-link">
                    {a.name}
                  </Link>
                </td>
                <td className="meta">{a.location}</td>
                <td className="cell-num num">{bookedText(a)}</td>
                {live.data && <td className="cell-num num">{nowCount(a) || ''}</td>}
                <td>
                  <span className="pg-badges">{badges(a)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const rows = (list: readonly Activity[], caption: string | null) => (
    <div key={caption ?? 'list'} className="pg-group">
      {caption && <h2 className="pg-group-heading">{caption}</h2>}
      <ul className="list">
        {list.map((a) => (
          <li key={a.id} className={a.status === 'cancelled' ? 'row row-link is-muted' : 'row row-link'}>
            <span className="activity-time num">{time(a)}</span>
            <span className="row-main">
              <span className="row-title">
                <Link to={a.id}>{a.name}</Link>
              </span>
              <span className="row-meta">{[a.location || null, bookedText(a) ? `${bookedText(a)} booked` : null, nowText(a) || null].filter(Boolean).join(' · ')}</span>
              {(a.status === 'cancelled' || isFull(a) || a.signupOpen || a.bookingRequired) && <span className="activity-badges">{badges(a)}</span>}
            </span>
            <span className="row-chevron">
              <Icon name="chevron" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  const dayOptions = [
    ...dayValues.map((d) => ({ value: d, label: d === ANY ? 'No time set' : d === today ? `Today, ${dayLabel(d)}` : dayLabel(d), count: dayCount(d) })),
    ...(dayValues.length > 1 ? [{ value: ALL, label: 'All days', count: dayCount(ALL) }] : []),
  ];

  return (
    <>
      {header}
      <div className="sections pg-sections">
        <Toolbar sticky label="Find activities">
          <SearchField id="activity-search" label="Search activities or places" value={q} onChange={setQ} slash />
          {manager && showOptions.length > 1 && (
            <div className="toolbar-end">
              <FilterChips label="Show" value={show} onChange={setShow} options={showOptions} />
            </div>
          )}
          {dayValues.length > 1 && !searching && (
            <div className="pg-toolbar-row">
              <FilterChips label="Day" value={shownDay} onChange={setDay} options={dayOptions} />
            </div>
          )}
        </Toolbar>
        {visible.length === 0 ? (
          <EmptyState
            title={searching ? `No activities match "${q}"` : show !== 'all' ? 'None here' : 'Nothing on this day'}
            actions={
              (searching || show !== 'all') && (
                <Button
                  kind="secondary"
                  onClick={() => {
                    setQ('');
                    setShow('all');
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        ) : (
          groups.map(([d, list]) => (wide ? table(list, grouped ? groupLabel(d) : null) : rows(list, grouped ? groupLabel(d) : null)))
        )}
      </div>
    </>
  );
}
