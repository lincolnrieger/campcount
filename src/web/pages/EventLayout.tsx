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
  /** Where this event's pages live: '' on the event's own site, '/events/<id>' on the main site. */
  base: string;
  /** True on the event's own address (supersplash.campcount.com). */
  onSite: boolean;
}

const EventContext = createContext<EventContextValue | null>(null);

export function useEvent(): EventContextValue {
  const value = useContext(EventContext);
  if (!value) throw new Error('useEvent outside EventLayout');
  return value;
}

/** Can this person do anything here other than scan? */
export function scanOnly(event: EventSummary): boolean {
  const can = (p: Permission) => event.permissions.includes(p);
  return !can('reports.view') && !can('roster.view') && !can('activity.view_roster') && !can('event.configure') && !can('staff.manage') && !can('stations.manage') && !can('meals.manage');
}

/** The sections of an event this person can open, most used first. On the event's own site, Scan is one of them. */
export function eventSections(event: EventSummary, onSite = false) {
  const can = (p: Permission) => event.permissions.includes(p);
  const scans = event.status === 'open' && (['site.scan', 'meal.scan', 'activity.scan'] as const).some((p) => can(p));
  return [
    { to: '', label: 'Home', show: !scanOnly(event) || !onSite },
    { to: 'scan', label: 'Scan', show: onSite && scans },
    { to: 'people', label: 'People', show: can('roster.view') },
    { to: 'activities', label: 'Activities', show: event.features.activities && (can('activities.manage') || can('activity.view_roster')) },
    {
      to: 'schedule',
      label: 'Schedule',
      show: (event.features.activities && can('activities.manage')) || (event.features.meals && can('meals.manage')),
    },
    { to: 'meals', label: 'Meals', show: event.features.meals && can('meals.manage') },
    { to: 'reports', label: 'Reports', show: can('reports.view') && event.status !== 'draft' },
    { to: 'settings', label: 'Settings', show: can('event.configure') || can('staff.manage') || can('stations.manage') },
  ]
    .filter((s) => s.show)
    .map(({ to, label }) => ({ to, label }));
}

export function EventLayout({ siteEventId }: { siteEventId?: string }) {
  const params = useParams();
  const eventId = siteEventId ?? params.eventId;
  const { data, error, loading, reload } = useApi<{ event: EventSummary }>(`/events/${eventId}`);

  if (loading && !data)
    return (
      <Loading what="event">
        <SkeletonHeader />
      </Loading>
    );
  if (error) return <LoadError error={error} onRetry={reload} what="this event" />;
  if (!data) return null;
  return <EventShell event={data.event} reload={reload} onSite={Boolean(siteEventId)} />;
}

function EventShell({ event, reload, onSite }: { event: EventSummary; reload: () => Promise<void>; onSite: boolean }) {
  const can = (p: Permission) => event.permissions.includes(p);
  const sections = eventSections(event, onSite);
  const base = onSite ? '' : `/events/${event.id}`;
  useShellEvent({ id: event.id, name: event.name, status: event.status, isDemo: event.isDemo, sections, base });
  return (
    <EventContext.Provider value={{ event, can, reload, base, onSite }}>
      {!onSite && <EventTabs base={base} sections={sections} />}
      <Outlet />
    </EventContext.Provider>
  );
}
