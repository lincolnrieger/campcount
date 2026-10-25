import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import { Loading, LoadError, PageHeader, SkeletonList } from '../components/ui';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import { dayInZone, dayLabel, eventDays, timeInZone } from '../../shared/time';
import { useTitle } from '../useTitle';

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

/** Activities: the programme, grouped by day. Each row opens the activity's own page. */
export function Activities() {
  useTitle('Activities');
  const { event, can } = useEvent();
  const { data, error, loading, reload } = useApi<{ activities: Activity[] }>(`/events/${event.id}/activities`);
  const manage = can('activities.manage') && (event.status === 'draft' || event.status === 'open');
  const tz = event.timezone;
  const days = eventDays(event.startsOn, event.endsOn);

  if (loading && !data)
    return (
      <Loading label="Loading activities">
        <SkeletonList rows={4} aside="chevron" heading />
        <SkeletonList rows={2} aside="chevron" heading />
      </Loading>
    );
  if (error) return <LoadError error={error} onRetry={reload} />;
  const activities = data?.activities ?? [];
  if (!can('activities.manage')) return <LeaderActivities activities={activities} />;
  const dayOf = (a: Activity) => (a.startsAt ? dayInZone(a.startsAt, tz) : null);
  const groups = [null, ...days, 'other']
    .map((d) => ({
      day: d,
      items: activities
        .filter((a) => (d === 'other' ? dayOf(a) !== null && !days.includes(dayOf(a)!) : dayOf(a) === d))
        .sort((x, y) => (x.startsAt ?? '').localeCompare(y.startsAt ?? '') || x.name.localeCompare(y.name)),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <PageHeader
        title={<span className="visually-hidden">Activities</span>}
        sub={activities.length > 0 && `${activities.filter((a) => a.status === 'active').length} activities`}
        actions={
          <>
            {manage && (
              <Link className="btn" to="new">
                Add activity
              </Link>
            )}
            <Menu label="More activity actions" items={[event.features.selfSignup && { label: 'Sign-up screen and posters', to: 'signup' }]} />
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
        groups.map((g) => (
          <section key={g.day ?? 'all'} className="list-section">
            <h2 className="list-heading">{g.day === null ? 'All camp' : g.day === 'other' ? 'Outside the event dates' : dayLabel(g.day, 'long')}</h2>
            <ul className="list">
              {g.items.map((a) => (
                <li key={a.id} className={a.status === 'cancelled' ? 'is-muted' : undefined}>
                  <Link to={a.id} className="list-row board-row activity-row">
                    {a.startsAt && (
                      <span className="activity-time">
                        <strong>{timeInZone(a.startsAt, tz)}</strong>
                        {a.endsAt && <span>{timeInZone(a.endsAt, tz)}</span>}
                      </span>
                    )}
                    <span className="list-main">
                      <strong>{a.name}</strong>
                      <span>
                        {[
                          a.location || null,
                          a.trackSignOut ? 'In and out' : 'Sign-in only',
                          a.capacity ? `${a.capacityPolicy === 'block' ? 'max' : 'aim for'} ${a.capacity}` : null,
                          a.allowRepeat ? null : 'once each',
                          a.signupOpen ? `${a.booked}${a.capacity ? ` of ${a.capacity}` : ''} signed up` : a.booked ? `${a.booked} booked` : null,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </span>
                    </span>
                    <span className="list-side">
                      {a.status === 'cancelled' && <span className="tag">Cancelled</span>}
                      <Icon name="chevron" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
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
