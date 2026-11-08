import { useState } from 'react';
import { Link } from 'react-router';
import { matchesSearch } from '../../shared/search';
import { dayInZone, dayLabel, eventDays, timeInZone, todayInZone } from '../../shared/time';
import type { Activity } from '../model';
import { useApi } from '../useApi';
import { Badge, Button, ButtonLink, EmptyState, FilterTabs, Icon, LoadError, Loading, PageHeader, SearchField, SkeletonRows } from '../ui';
import { useEvent } from './EventLayout';

interface LiveContext {
  key: string;
  presentNow: number;
  people: number;
}

const ANY = 'any';

/** Activities: the programme, one day at a time. Each row opens the activity's page. */
export function Activities() {
  const { event, can, base } = useEvent();
  const { data, error, loading, reload } = useApi<{ activities: Activity[] }>(`/events/${event.id}/activities`);
  const live = useApi<{ contexts: LiveContext[] }>(can('reports.view') && event.status !== 'draft' ? `/events/${event.id}/live` : null);
  const [q, setQ] = useState('');
  const [day, setDay] = useState<string | null>(null);
  const manager = can('activities.manage');
  const editable = manager && (event.status === 'draft' || event.status === 'open');
  const tz = event.timezone;

  const header = (
    <PageHeader
      title="Activities"
      summary={manager ? undefined : 'The activities you run'}
      primary={
        editable && (
          <ButtonLink to="new" kind="primary">
            Add activity
          </ButtonLink>
        )
      }
      menu={
        manager
          ? [
              { label: 'Import programme', to: 'import' },
              { label: 'Schedule view', to: `${base}/schedule` },
              event.features.selfSignup && { label: 'Sign-up kiosk and posters', to: 'signup' },
            ]
          : undefined
      }
      menuLabel="More activity actions"
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

  // Managers find team events on the Teams tab; their leaders see them here with their other activities.
  const all = (data?.activities ?? []).filter((a) => a.kind !== 'program' && !(manager && a.teamEvent) && (manager || a.status === 'active'));
  if (all.length === 0)
    return (
      <>
        {header}
        {manager ? (
          <EmptyState
            title="No activities yet"
            actions={
              editable && (
                <ButtonLink to="new" kind="primary">
                  Add activity
                </ButtonLink>
              )
            }
          >
            Add each activity with its day and time. Running one several times? Add it once, then add more sessions from its page.
          </EmptyState>
        ) : (
          <EmptyState title="No activities for you yet">An event manager gives you an activity in Settings › Staff. It shows up here straight away.</EmptyState>
        )}
      </>
    );

  const days = eventDays(event.startsOn, event.endsOn);
  const dayOf = (a: Activity) => (a.startsAt ? dayInZone(a.startsAt, tz) : ANY);
  const usedDays = days.filter((d) => all.some((a) => dayOf(a) === d));
  const hasAny = all.some((a) => dayOf(a) === ANY || (a.startsAt && !days.includes(dayOf(a))));
  const tabs = [...usedDays.map((d) => ({ value: d, label: dayLabel(d) })), ...(hasAny ? [{ value: ANY, label: 'No time set' }] : [])];
  const today = todayInZone(tz);
  const shownDay = day ?? (usedDays.includes(today) ? today : (tabs[0]?.value ?? ANY));
  const searching = q.trim() !== '';
  const contexts = new Map((live.data?.contexts ?? []).map((c) => [c.key, c]));

  const visible = all
    .filter((a) => (searching ? matchesSearch(q, a.name, a.location) : tabs.length < 2 || (shownDay === ANY ? !usedDays.includes(dayOf(a)) : dayOf(a) === shownDay)))
    .sort((x, y) => (x.startsAt ?? '').localeCompare(y.startsAt ?? '') || x.name.localeCompare(y.name));

  const counts = (a: Activity) => {
    const ctx = contexts.get(`activity:${a.id}`);
    const here = ctx ? (a.trackSignOut ? ctx.presentNow : ctx.people) : null;
    return [a.capacity ? `${a.booked} of ${a.capacity} places booked` : a.booked ? `${a.booked} booked` : null, here !== null ? `${here} ${a.trackSignOut ? 'here' : 'checked in'}` : null]
      .filter(Boolean)
      .join(' · ');
  };

  return (
    <>
      {header}
      <div className="sections">
        {(all.length > 15 || searching) && <SearchField id="activity-search" label="Search activities or places" value={q} onChange={setQ} />}
        {tabs.length > 1 && !searching && (
          <FilterTabs label="Day" value={shownDay} onChange={setDay} options={tabs.map((t) => ({ ...t, label: t.value === today ? `Today, ${t.label}` : t.label }))} />
        )}
        {visible.length === 0 ? (
          <EmptyState
            title={searching ? `No activities match "${q}"` : 'Nothing on this day'}
            actions={
              searching && (
                <Button kind="secondary" onClick={() => setQ('')}>
                  Clear search
                </Button>
              )
            }
          />
        ) : (
          <ul className="list">
            {visible.map((a) => (
              <li key={a.id} className={a.status === 'cancelled' ? 'row row-link is-muted' : 'row row-link'}>
                <span className="activity-time num">
                  {a.startsAt ? (
                    <>
                      {timeInZone(a.startsAt, tz)}
                      {a.endsAt && <span className="meta">{timeInZone(a.endsAt, tz)}</span>}
                    </>
                  ) : (
                    <span className="meta">Any time</span>
                  )}
                </span>
                <span className="row-main">
                  <span className="row-title">
                    <Link to={a.id}>{a.name}</Link>
                  </span>
                  <span className="row-meta">
                    {[searching && a.startsAt ? dayLabel(dayOf(a)) : null, a.location || null, counts(a) || null].filter(Boolean).join(' · ') || 'No bookings yet'}
                  </span>
                  {(a.status === 'cancelled' || a.bookingRequired || (a.capacity !== null && a.booked >= a.capacity)) && (
                    <span className="activity-badges">
                      {a.status === 'cancelled' && <Badge>Cancelled</Badge>}
                      {a.status !== 'cancelled' && a.capacity !== null && a.booked >= a.capacity && <Badge tone="warning">Full</Badge>}
                      {a.bookingRequired && <Badge tone="brand">Booking required</Badge>}
                    </span>
                  )}
                </span>
                <span className="row-chevron">
                  <Icon name="chevron" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
