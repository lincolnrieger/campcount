import { createContext, useContext, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation, useParams } from 'react-router';
import { Breadcrumbs } from '../components/Layout';
import { useShell, useShellEvent, useTitle } from '../shell';
import type { Permission } from '../../shared/permissions';
import { EventStatusBadge, formatDateRange, Loading, LoadError, Skeleton, SkeletonHeading, SkeletonList } from '../components/ui';
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

  if (loading && !data)
    return (
      <Loading label="Loading event">
        <SkeletonHeading width="16rem" />
        <div className="skeleton-tabs">{[5, 4, 4, 5, 4].map((w, i) => <Skeleton key={i} width={`${w}rem`} height="1rem" />)}</div>
        <SkeletonList rows={4} />
      </Loading>
    );
  if (error) return <LoadError error={error} onRetry={reload} message={error.status === 404 ? "This event doesn't exist, or you're not on its staff." : undefined} />;
  if (!data) return null;
  return <EventShell event={data.event} reload={reload} />;
}

function EventShell({ event, reload }: { event: EventSummary; reload: () => Promise<void> }) {
  const navRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const { title } = useShell();
  // Keep the current tab visible in the swipeable tab row (phones).
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [location.pathname]);

  const can = (p: Permission) => event.permissions.includes(p);
  // Ordered by how often they're used during camp; setup lives in Settings.
  const tabs = [
    { to: '', label: 'Overview', show: true },
    { to: 'live', label: 'Live', show: can('reports.view') && event.status !== 'draft' },
    { to: 'people', label: 'People', show: can('roster.view') },
    { to: 'activities', label: 'Activities', show: event.features.activities && (can('activities.manage') || can('activity.view_roster')) },
    { to: 'meals', label: 'Meals', show: event.features.meals && can('meals.manage') },
    { to: 'reports', label: 'Reports', show: can('reports.view') && event.status !== 'draft' },
    { to: 'settings', label: 'Settings', show: can('event.configure') || can('staff.manage') || can('stations.manage') },
  ].filter((t) => t.show);
  const dates = `${formatDateRange(event.startsOn, event.endsOn)}${event.location ? `, ${event.location}` : ''}`;
  useShellEvent({ id: event.id, name: event.name, meta: dates, sections: tabs.map(({ to, label }) => ({ to, label })) });

  const rest = location.pathname.replace(/^\/events\/[^/]+\/?/, '').split('/').filter(Boolean);
  const tab = tabs.find((t) => t.to === (rest[0] ?? ''));
  // Tab pages are titled "People: Camp name"; deeper pages (a person, Lanyards…) set their own title.
  useTitle(rest.length <= 1 && tab ? `${tab.label}: ${event.name}` : null);
  const base = `/events/${event.id}`;
  const trail = [
    { to: '/', label: 'Events' },
    { to: base, label: event.name },
    ...(tab && tab.to ? [{ to: `${base}/${tab.to}`, label: tab.label }] : []),
    ...(rest.length > 1 && title ? [{ label: title }] : []),
  ];

  return (
    <EventContext.Provider value={{ event, can, reload }}>
      <Breadcrumbs trail={trail} />
      <div className="event-head">
        <div>
          <h1>{event.name}</h1>
          <p className="lede">{dates}</p>
        </div>
        <div className="event-badges">
          {event.isDemo && <span className="badge-demo">Demo</span>}
          <EventStatusBadge status={event.status} />
        </div>
      </div>
      <nav className="subnav subnav-section" aria-label="Event sections" ref={navRef} hidden={tabs.length < 2}>
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '' || t.to === 'live'}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </EventContext.Provider>
  );
}
