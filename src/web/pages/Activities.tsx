import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import { useState } from 'react';
import { Loading, LoadError, PageHeader, Skeleton, SkeletonTable } from '../components/ui';
import { matchesSearch } from '../../shared/search';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import { dayInZone, dayLabel, eventDays, timeInZone } from '../../shared/time';
import { useTitle } from '../shell';

export interface Activity {
  id: string;
  name: string;
  description: string;
  location: string;
  instructions: string;
  startsAt: string | null;
  endsAt: string | null;
  capacity: number | null;
  capacityPolicy: 'warn' | 'block';
  trackSignOut: boolean;
  allowRepeat: boolean;
  bookingRequired: boolean;
  signupOpen: boolean;
  booked: number;
  status: 'active' | 'cancelled';
}

/** Activities: the programme as a table, grouped by day. Each row opens the activity's own page. */
export function Activities() {
  useTitle('Activities');
  const { event, can } = useEvent();
  const { data, error, loading, reload } = useApi<{ activities: Activity[] }>(`/events/${event.id}/activities`);
  const [q, setQ] = useState('');
  const [day, setDay] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const manage = can('activities.manage') && (event.status === 'draft' || event.status === 'open');
  const tz = event.timezone;
  const days = eventDays(event.startsOn, event.endsOn);

  if (loading && !data)
    return (
      <Loading label="Loading activities">
        <div className="skeleton-actions">
          <Skeleton width="8rem" height="1rem" />
          <Skeleton width="7rem" height="var(--control)" radius="var(--radius-control)" />
        </div>
        <SkeletonTable rows={6} cols={5} />
      </Loading>
    );
  if (error) return <LoadError error={error} onRetry={reload} />;
  const activities = data?.activities ?? [];
  if (!can('activities.manage')) return <LeaderActivities activities={activities} />;
  const dayOf = (a: Activity) => (a.startsAt ? dayInZone(a.startsAt, tz) : null);
  const cancelled = activities.filter((a) => a.status === 'cancelled').length;
  const visible = activities.filter(
    (a) => (showCancelled || a.status === 'active') && matchesSearch(q, a.name, a.location) && (!day || (day === 'all-camp' ? !a.startsAt : dayOf(a) === day)),
  );
  const groups = [null, ...days, 'other']
    .map((d) => ({
      day: d,
      items: visible
        .filter((a) => (d === 'other' ? dayOf(a) !== null && !days.includes(dayOf(a)!) : dayOf(a) === d))
        .sort((x, y) => (x.startsAt ?? '').localeCompare(y.startsAt ?? '') || x.name.localeCompare(y.name)),
    }))
    .filter((g) => g.items.length > 0);
  const signup = event.features.selfSignup;
  const cols = signup ? 6 : 5;

  return (
    <>
      <PageHeader
        title="Activities"
        titleOn="desktop"
        sub={activities.length > 0 && `${activities.length - cancelled} activities${cancelled ? `, ${cancelled} cancelled` : ''}`}
        actions={
          <>
            {manage && (
              <Link className="btn" to="new">
                Add activity
              </Link>
            )}
            <Menu label="More activity actions" items={[signup && { label: 'Sign-up screen and posters', to: 'signup' }]} />
          </>
        }
      />
      {activities.length === 0 ? (
        <div className="empty">
          <p>
            <strong>No activities yet.</strong>
          </p>
          <p className="lede">Add each activity with its day and time. Running one several times? Add it once, then add more sessions from its page.</p>
          {manage && (
            <Link className="btn" to="new">
              Add activity
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="toolbar">
            <input
              className="input input-search toolbar-search"
              type="search"
              aria-label="Search activities"
              placeholder="Search activities or locations"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select className="input" aria-label="Day" value={day} onChange={(e) => setDay(e.target.value)}>
              <option value="">All days</option>
              <option value="all-camp">All camp (no set time)</option>
              {days.map((d) => (
                <option key={d} value={d}>
                  {dayLabel(d, 'long')}
                </option>
              ))}
            </select>
            {cancelled > 0 && (
              <label className="check check-compact">
                <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
                <span>Show cancelled</span>
              </label>
            )}
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" className="nowrap">
                    Time
                  </th>
                  <th scope="col">Activity</th>
                  <th scope="col" className="hide-sm">
                    Location
                  </th>
                  <th scope="col" className="hide-md">
                    Scanning
                  </th>
                  <th scope="col" className="num hide-sm">
                    Capacity
                  </th>
                  {signup && (
                    <th scope="col" className="num hide-sm">
                      Signed up
                    </th>
                  )}
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.day ?? 'all'}>
                  <tr className="group-row">
                    <th scope="colgroup" colSpan={cols}>
                      {g.day === null ? 'All camp' : g.day === 'other' ? 'Outside the event dates' : dayLabel(g.day, 'long')}
                    </th>
                  </tr>
                  {g.items.map((a) => (
                    <tr key={a.id} className={a.status === 'cancelled' ? 'is-muted' : undefined}>
                      <td className="nowrap meta">
                        {a.startsAt ? `${timeInZone(a.startsAt, tz)}${a.endsAt ? `–${timeInZone(a.endsAt, tz)}` : ''}` : 'Any time'}
                      </td>
                      <td>
                        <Link to={a.id} className="row-link">
                          {a.name}
                        </Link>{' '}
                        {a.status === 'cancelled' && <span className="tag">Cancelled</span>}
                        <span className="cell-sub show-sm">
                          {[a.location || null, a.capacity ? `${a.capacityPolicy === 'block' ? 'max' : 'aim for'} ${a.capacity}` : null, a.signupOpen ? `${a.booked} signed up` : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </td>
                      <td className="hide-sm">{a.location}</td>
                      <td className="hide-md meta">
                        {a.trackSignOut ? 'In and out' : 'Sign-in only'}
                        {a.allowRepeat ? '' : ', once each'}
                      </td>
                      <td className="num hide-sm">{a.capacity ? `${a.capacityPolicy === 'block' ? 'Max' : 'Aim'} ${a.capacity}` : '—'}</td>
                      {signup && <td className="num hide-sm">{a.signupOpen ? `${a.booked}${a.capacity ? ` / ${a.capacity}` : ''}` : a.booked ? a.booked : '—'}</td>}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
            {groups.length === 0 && (
              <div className="empty">
                <p className="flush">
                  No activities match.{' '}
                  <button
                    className="btn-link"
                    onClick={() => {
                      setQ('');
                      setDay('');
                    }}
                  >
                    Clear filters
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

/** Activity leaders: just the activities they run, each opening its roster. */
function LeaderActivities({ activities }: { activities: Activity[] }) {
  const { event } = useEvent();
  const tz = event.timezone;
  const mine = activities.filter((a) => a.status === 'active').sort((x, y) => (x.startsAt ?? '').localeCompare(y.startsAt ?? ''));
  if (mine.length === 0)
    return (
      <div className="empty">
        <p>
          <strong>No activities for you yet.</strong>
        </p>
        <p className="lede">An event manager gives you an activity in Settings › Staff. It shows up here straight away.</p>
      </div>
    );
  return (
    <section className="list-section">
      <h2 className="list-heading">Your activities</h2>
      <ul className="list">
        {mine.map((a) => (
          <li key={a.id}>
            <Link to={a.id} className="list-row board-row">
              <span className="list-main">
                <strong>{a.name}</strong>
                <span>
                  {[a.startsAt ? `${dayLabel(dayInZone(a.startsAt, tz))}, ${timeInZone(a.startsAt, tz)}` : 'All camp', a.location || null, a.booked ? `${a.booked} booked` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <Icon name="chevron" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
