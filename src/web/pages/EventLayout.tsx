import { createContext, useContext, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation, useParams } from 'react-router';
import { useCollapsingTitle } from '../components/Layout';
import type { Permission } from '../../shared/permissions';
import { EventStatusBadge, Loading, Notice, formatDateRange } from '../components/ui';
import type { EventSummary } from '../types';
import { useApi } from '../useApi';

interface EventContextValue {
  event: EventSummary;
  can: (permission: Permission) => boolean;
  reload: () => Promise<void>;
}

const EventContext = createContext<EventContextValue | null>(null);

export function useEvent(): EventContextValue {
  const value = useContext(EventContext);
  if (!value) throw new Error('useEvent outside EventLayout');
  return value;
}

export function EventLayout() {
  const { eventId } = useParams();
  const { data, error, loading, reload } = useApi<{ event: EventSummary }>(`/events/${eventId}`);

  if (loading && !data) return <Loading />;
  if (error) return <Notice tone="stop">{error.status === 404 ? 'This event does not exist, or you are not assigned to it.' : error.message}</Notice>;
  if (!data) return null;
  return <EventShell event={data.event} reload={reload} />;
}

function EventShell({ event, reload }: { event: EventSummary; reload: () => Promise<void> }) {
  const titleRef = useCollapsingTitle<HTMLHeadingElement>(event.name);
  const navRef = useRef<HTMLElement>(null);
  const location = useLocation();
  // Keep the current tab visible in the swipeable tab row.
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [location.pathname]);

  const can = (p: Permission) => event.permissions.includes(p);
  const tabs: { to: string; label: string; show: boolean }[] = [
    { to: '', label: 'Overview', show: true },
    { to: 'live', label: 'Live', show: can('reports.view') && event.status !== 'draft' },
    { to: 'roster', label: 'Roster', show: can('roster.view') },
    { to: 'activities', label: 'Activities', show: event.features.activities && can('activities.manage') },
    { to: 'meals', label: 'Meals', show: event.features.meals && can('meals.manage') },
    { to: 'stations', label: 'Stations', show: can('stations.manage') },
    { to: 'close-out', label: 'Close-out', show: can('reports.view') && event.status !== 'draft' },
    { to: 'staff', label: 'Staff', show: can('staff.manage') },
  ];

  return (
    <EventContext.Provider value={{ event, can, reload }}>
      <div className="page-head event-head">
        <div>
          <h1 ref={titleRef}>{event.name}</h1>
          <p className="lede flush">
            {formatDateRange(event.startsOn, event.endsOn)}
            {event.location && `, ${event.location}`}
          </p>
        </div>
        <div className="event-badges">
          {event.isDemo && <span className="badge-demo">Demo</span>}
          <EventStatusBadge status={event.status} />
        </div>
      </div>
      <nav className="subnav" aria-label="Event sections" ref={navRef} hidden={tabs.filter((t) => t.show).length < 2}>
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <NavLink key={t.to} to={t.to} end>
              {t.label}
            </NavLink>
          ))}
      </nav>
      <Outlet />
    </EventContext.Provider>
  );
}
