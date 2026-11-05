import { createContext, useContext } from 'react';
import { Outlet, useParams } from 'react-router';
import type { Permission } from '../../shared/permissions';
import type { EventSummary } from '../types';
import { useApi } from '../useApi';
import { useShellEvent } from '../shell';
import { EventTabs } from '../ui/AppShell';
import { LoadError, Loading, SkeletonHeader } from '../ui';

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

/** The sections of an event this person can open, most used first. */
export function eventSections(event: EventSummary) {
  const can = (p: Permission) => event.permissions.includes(p);
  return [
    { to: '', label: 'Home', show: true },
    { to: 'people', label: 'People', show: can('roster.view') },
    { to: 'activities', label: 'Activities', show: event.features.activities && (can('activities.manage') || can('activity.view_roster')) },
    { to: 'meals', label: 'Meals', show: event.features.meals && can('meals.manage') },
    { to: 'reports', label: 'Reports', show: can('reports.view') && event.status !== 'draft' },
    { to: 'settings', label: 'Settings', show: can('event.configure') || can('staff.manage') || can('stations.manage') },
  ]
    .filter((s) => s.show)
    .map(({ to, label }) => ({ to, label }));
}

export function EventLayout() {
  const { eventId } = useParams();
  const { data, error, loading, reload } = useApi<{ event: EventSummary }>(`/events/${eventId}`);

  if (loading && !data)
    return (
      <Loading what="event">
        <SkeletonHeader />
      </Loading>
    );
  if (error) return <LoadError error={error} onRetry={reload} what="this event" />;
  if (!data) return null;
  return <EventShell event={data.event} reload={reload} />;
}

function EventShell({ event, reload }: { event: EventSummary; reload: () => Promise<void> }) {
  const can = (p: Permission) => event.permissions.includes(p);
  const sections = eventSections(event);
  useShellEvent({ id: event.id, name: event.name, status: event.status, isDemo: event.isDemo, sections });
  return (
    <EventContext.Provider value={{ event, can, reload }}>
      <EventTabs eventId={event.id} sections={sections} />
      <Outlet />
    </EventContext.Provider>
  );
}
