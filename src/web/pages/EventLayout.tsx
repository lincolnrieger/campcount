import { createContext, useContext } from 'react';
import { Outlet, useParams } from 'react-router';
import type { Permission } from '../../shared/permissions';
import type { EventSummary } from '../types';
import { useApi } from '../useApi';
import type { NavPage, NavSection } from '../shell';
import { useShellEvent } from '../shell';
import { EventSubTabs, EventTabs } from '../ui/AppShell';
import { LoadError, Loading, SkeletonHeader } from '../ui';

interface EventContextValue {
  event: EventSummary;
  can: (permission: Permission) => boolean;
  reload: () => Promise<void>;
  /** Where this event's pages live: '' on the event's own site, '/events/<id>' on the main site. */
  base: string;
  /** True on the event's own address (summercamp.campcount.com). */
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

/**
 * Does Home have anything for this person? Event managers see who's where,
 * and the setup checklist on a draft. For others, Home was just a pointer
 * elsewhere, so it's left out and they land on their first real section.
 */
export function hasHome(event: EventSummary, onSite: boolean): boolean {
  const can = (p: Permission) => event.permissions.includes(p);
  if (can('reports.view')) return true;
  if (event.status === 'draft' && can('event.configure')) return true;
  // On the main site, Home holds the way into the scanner.
  return !onSite && event.status === 'open' && (['site.scan', 'meal.scan', 'activity.scan'] as const).some((p) => can(p));
}

/**
 * The sections of an event this person can open, most used first, each with
 * the pages under it, so every page is reachable from the sidebar (and the
 * second tab row on phones) instead of from menus on other pages. All the
 * links people are sent live together under Links & sign-up. On the event's
 * own site, Scan is a section too.
 */
export function eventSections(event: EventSummary, onSite = false): NavSection[] {
  const can = (p: Permission) => event.permissions.includes(p);
  const scans = event.status === 'open' && (['site.scan', 'meal.scan', 'activity.scan'] as const).some((p) => can(p));
  const acts = event.features.activities;
  const signup = acts && event.features.selfSignup && can('activities.manage');
  const pages = (list: (NavPage | false)[]) => list.filter((x): x is NavPage => Boolean(x));

  const people = pages([
    { to: 'people', label: 'Everyone' },
    can('roster.import') && { to: 'people/import', label: 'Import & check' },
    { to: 'people/leader-roster', label: 'Leader roster' },
    (can('credentials.manage') || can('event.configure')) && {
      to: can('credentials.manage') ? 'people/lanyards/print' : 'people/lanyards',
      label: 'Lanyards',
      also: ['people/lanyards'],
    },
    { to: 'people/roll-sheet', label: 'Roll sheet' },
  ]);
  const programme = pages([
    acts && (can('activities.manage') || can('activity.view_roster')) && { to: 'activities', label: 'Activities' },
    ((acts && can('activities.manage')) || (event.features.meals && can('meals.manage'))) && { to: 'schedule', label: 'Schedule' },
    acts && can('activities.manage') && { to: 'teams', label: 'Teams' },
    event.features.meals && can('meals.manage') && { to: 'meals', label: 'Meals' },
    acts && can('activities.manage') && { to: 'activities/import', label: 'Import programme' },
  ]);
  const links = pages([
    can('activities.manage') && { to: 'people/share', label: 'For everyone' },
    signup && { to: 'activities/links', label: 'Booking links' },
    signup && { to: 'activities/signup', label: 'Kiosk & posters' },
    can('credentials.manage') && { to: 'people/links', label: 'Personal links' },
  ]);
  const settings = pages([
    can('event.configure') && { to: 'settings/event', label: 'Event details' },
    can('event.configure') && { to: 'settings/sections', label: 'Sections' },
    can('event.configure') && { to: 'settings/banner', label: 'Page banner' },
    can('staff.manage') && { to: 'settings/staff', label: 'Staff' },
    can('stations.manage') && { to: 'settings/stations', label: 'Scanning stations' },
  ]);
  // A section with one page is just a link.
  const group = (to: string, label: string, icon: string, children: NavPage[]): NavSection => (children.length > 1 ? { to, label, icon, children } : { to, label, icon });

  return [
    hasHome(event, onSite) && { to: '', label: 'Home', icon: 'home' },
    onSite && scans && { to: 'scan', label: 'Scan', icon: 'scan' },
    can('roster.view') && group('people', 'People', 'user', people),
    programme.length > 0 && group(programme[0]!.to, 'Programme', 'events', programme),
    links.length > 0 && { to: 'links', label: 'Links', icon: 'qr', children: links },
    can('reports.view') && event.status !== 'draft' && { to: 'reports', label: 'Reports', icon: 'clipboard' },
    (can('event.configure') || can('staff.manage') || can('stations.manage')) && group('settings', 'Settings', 'admin', settings),
  ].filter((s): s is NavSection => Boolean(s));
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
      <EventSubTabs base={base} sections={sections} />
      <Outlet />
    </EventContext.Provider>
  );
}
