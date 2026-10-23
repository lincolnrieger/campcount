import { createContext, useContext } from 'react';
import { NavLink, Outlet, useParams } from 'react-router';
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

  const event = data.event;
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
      <div className="page-head">
        <div>
          <h1>{event.name}</h1>
          <p className="lede flush">
            {formatDateRange(event.startsOn, event.endsOn)}
            {event.location && `, ${event.location}`}
          </p>
        </div>
        <EventStatusBadge status={event.status} />
      </div>
      <nav className="subnav" aria-label="Event sections">
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
