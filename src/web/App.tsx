import { Navigate, Outlet, Route, Routes, useLocation, useParams } from 'react-router';
import { Suspense, lazy } from 'react';
import type { ReactNode } from 'react';
import { AppShell } from './ui/AppShell';
import { Loading, SkeletonHeader, SkeletonRows } from './ui';
import { AdminIndex } from './pages/Admin';
import { AdminUsers } from './pages/AdminUsers';
import { AdminDemo } from './pages/AdminDemo';
import { AdminLog } from './pages/AdminLog';
import { Account, SetPassword, ViewAsPage } from './pages/Account';
import { EventLayout } from './pages/EventLayout';
import { EventHome } from './pages/EventHome';
import { NewEvent } from './pages/Events';
import { CampPage, Camps, NewCamp } from './pages/Camps';
import { StaffLanding } from './pages/StaffLanding';
import { PasswordLink, SignIn, VerifyLink } from './pages/SignIn';
import { AddStaff, Staff } from './pages/Staff';
import { Roster } from './pages/Roster';
import { Person, PersonEdit } from './pages/Person';
import { AddPerson } from './pages/AddPerson';
import { SignupScreen } from './pages/SignupScreen';
import { ActivityRoster } from './pages/ActivityRoster';
import { Activities } from './pages/Activities';
import { ActivityEdit } from './pages/ActivityEdit';
import { Meals } from './pages/Meals';
import { ProgramImport } from './pages/ProgramImport';
import { Schedule } from './pages/Schedule';
import { TeamEventPage, TeamEvents } from './pages/Teams';
import { Pair } from './pages/Pair';
import { ScanHub } from './pages/ScanHub';
import { Stations } from './pages/Stations';
import { Reports } from './pages/Reports';
import { RollSheet } from './pages/RollSheet';
import { EventDetails, SettingsIndex } from './pages/Settings';
import { CopyEvent } from './pages/CopyEvent';
import { NotFound } from './pages/NotFound';
import { ComponentSheet } from './pages/ComponentSheet';
import { useSession } from './session';
import { useSite } from './site';
import type { SiteInfo } from './site';
import { SiteShell } from './ui/SiteShell';
import { More } from './pages/More';
import { eventSections, hasHome, scanOnly } from './pages/EventLayout';
import { useEvent } from './pages/EventLayout';
import { PageHeader, EmptyState } from './ui';

// The camera, PDF and spreadsheet code is heavy: load it only on the pages that need it.
const Scan = lazy(() => import('./pages/Scan').then((m) => ({ default: m.Scan })));
const Lanyards = lazy(() => import('./pages/Lanyards').then((m) => ({ default: m.Lanyards })));
const LanyardSettings = lazy(() => import('./pages/LanyardSettings').then((m) => ({ default: m.LanyardSettings })));
const Import = lazy(() => import('./pages/Import').then((m) => ({ default: m.Import })));
const SignupKiosk = lazy(() => import('./pages/Signup').then((m) => ({ default: m.SignupKiosk })));
const MyActivities = lazy(() => import('./pages/Signup').then((m) => ({ default: m.MyActivities })));

function PageLoading() {
  return (
    <div className="page">
      <Loading what="page">
        <SkeletonHeader />
        <SkeletonRows rows={3} />
      </Loading>
    </div>
  );
}

function RequireSignIn({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const location = useLocation();
  if (loading) return <PageLoading />;
  if (!me) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

/** Stations go straight to their one scanner; admins get the camps console; staff go to their camp. */
function Home() {
  const { me } = useSession();
  if (me?.kind === 'station') {
    const { eventId, contextType, contextId } = me.station;
    return <Navigate to={`/events/${eventId}/scan/${contextType}${contextId ? `/${contextId}` : ''}`} replace />;
  }
  if (me?.kind === 'user' && me.platformPermissions.length > 0) return <Camps />;
  return <StaffLanding />;
}

/** A fresh scanner per context, so switching never carries one meal's result into the next. */
function ScanRoute() {
  const location = useLocation();
  return <Scan key={location.pathname} />;
}

/** Old event addresses (bookmarks, history) land on the page's new home. */
function Moved({ to }: { to: string }) {
  const { eventId, '*': rest } = useParams();
  return <Navigate to={`/events/${eventId}/${to}${rest ? `/${rest}` : ''}`} replace />;
}

export function App() {
  const site = useSite();
  if (site.kind === 'event') return <EventSiteApp site={site} />;
  if (site.kind === 'unknown') return <NoSuchSite />;
  return <PlatformApp />;
}

/** An address under campcount.com that no event uses. */
function NoSuchSite() {
  return (
    <main className="public" id="main">
      <div className="public-card">
        <PageHeader title="There's no camp at this address" />
        <EmptyState title="Check the address">
          Your camp's address is in the email or link your event manager sent you.{' '}
          <a href={`${window.location.protocol}//${window.location.host.split('.').slice(1).join('.')}/`}>Go to CampCount</a>
        </EmptyState>
      </div>
    </main>
  );
}

/** On an event's own site, `/events/<id>/people/…` (old links, scanner links) maps to `/people/…`. */
function StripEventPrefix() {
  const { '*': rest } = useParams();
  const location = useLocation();
  return <Navigate to={`/${rest ?? ''}${location.search}`} replace />;
}

/** The event's own site home: people who only scan go straight to the scan menu. */
function SiteHome() {
  const { me } = useSession();
  const { event } = useEvent();
  if (me?.kind === 'station') {
    const { contextType, contextId } = me.station;
    return <Navigate to={`/events/${event.id}/scan/${contextType}${contextId ? `/${contextId}` : ''}`} replace />;
  }
  if (hasHome(event, true)) return <EventHome />;
  // Nothing for them on Home: open their first section instead (Scan, Activities…).
  const first = eventSections(event, true)[0];
  if (scanOnly(event) || !first) return <Navigate to="/scan" replace />;
  return <Navigate to={`/${first.to}`} replace />;
}

/** Main site: an event's Home, or its first section when Home has nothing for this person. */
function PlatformEventHome() {
  const { event, base } = useEvent();
  if (hasHome(event, false)) return <EventHome />;
  const first = eventSections(event, false).find((s) => s.to !== '');
  return first ? <Navigate to={`${base}/${first.to}`} replace /> : <EventHome />;
}

/**
 * An event's own address (supersplash.campcount.com): a separate, branded
 * site for that one event. No event list, no admin area.
 */
function EventSiteApp({ site }: { site: Extract<SiteInfo, { kind: 'event' }> }) {
  const id = site.event.id;
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignIn />} />
        <Route path="/sign-in/verify" element={<VerifyLink />} />
        <Route path="/set-password" element={<PasswordLink />} />
        <Route path="/pair" element={<Pair />} />
        <Route path="/signup/:code" element={<SignupKiosk />} />
        <Route path="/c" element={<MyActivities />} />
        <Route
          path="/events/:eventId/scan/:type/:contextId?"
          element={
            <RequireSignIn>
              <ScanRoute />
            </RequireSignIn>
          }
        />
        <Route path="/events/:eventId/*" element={<StripEventPrefix />} />
        <Route
          element={
            <RequireSignIn>
              <SiteShell />
            </RequireSignIn>
          }
        >
          <Route element={<EventLayout siteEventId={id} />}>
            <Route index element={<SiteHome />} />
            <Route path="scan" element={<ScanHub />} />
            <Route path="people" element={<Roster />} />
            <Route path="people/add" element={<AddPerson />} />
            <Route path="people/import" element={<Import />} />
            <Route path="people/lanyards" element={<Lanyards />} />
            <Route path="people/roll-sheet" element={<RollSheet />} />
            <Route path="people/:registrationId" element={<Person />} />
            <Route path="people/:registrationId/edit" element={<PersonEdit />} />
            <Route path="activities" element={<Activities />} />
            <Route path="activities/new" element={<ActivityEdit />} />
            <Route path="activities/import" element={<ProgramImport />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="teams" element={<TeamEvents />} />
            <Route path="teams/:teamEventId" element={<TeamEventPage />} />
            <Route path="activities/signup" element={<SignupScreen />} />
            <Route path="activities/:activityId" element={<ActivityRoster />} />
            <Route path="activities/:activityId/edit" element={<ActivityEdit />} />
            <Route path="meals" element={<Meals />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Outlet />}>
              <Route index element={<SettingsIndex />} />
              <Route path="event" element={<EventDetails />} />
              <Route path="staff" element={<Staff />} />
              <Route path="staff/add" element={<AddStaff />} />
              <Route path="stations" element={<Stations />} />
              <Route path="lanyards" element={<LanyardSettings />} />
            </Route>
            <Route path="more" element={<More />} />
            <Route path="account" element={<Account />} />
            <Route path="account/password" element={<SetPassword />} />
            <Route path="account/view-as" element={<ViewAsPage />} />
            <Route path="*" element={<NotFound inEvent />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}

/** The main address: the admin console (and the fallback when events have no address of their own). */
function PlatformApp() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/sign-in" element={<SignIn />} />
        <Route path="/sign-up" element={<SignIn />} />
        <Route path="/sign-in/verify" element={<VerifyLink />} />
        <Route path="/set-password" element={<PasswordLink />} />
        <Route path="/pair" element={<Pair />} />
        <Route path="/signup/:code" element={<SignupKiosk />} />
        <Route path="/c" element={<MyActivities />} />
        {/* The scanner is full screen: no sidebar or tab bar. */}
        <Route
          path="/events/:eventId/scan/:type/:contextId?"
          element={
            <RequireSignIn>
              <ScanRoute />
            </RequireSignIn>
          }
        />
        <Route
          element={
            <RequireSignIn>
              <AppShell />
            </RequireSignIn>
          }
        >
          <Route index element={<Home />} />
          <Route path="scan" element={<ScanHub />} />
          <Route path="events/new" element={<NewEvent />} />
          <Route path="camps/new" element={<NewCamp />} />
          <Route path="camps/:campId" element={<CampPage />} />
          <Route path="events/:eventId" element={<EventLayout />}>
            <Route index element={<PlatformEventHome />} />
            <Route path="people" element={<Roster />} />
            <Route path="people/add" element={<AddPerson />} />
            <Route path="people/import" element={<Import />} />
            <Route path="people/lanyards" element={<Lanyards />} />
            <Route path="people/roll-sheet" element={<RollSheet />} />
            <Route path="people/:registrationId" element={<Person />} />
            <Route path="people/:registrationId/edit" element={<PersonEdit />} />
            <Route path="activities" element={<Activities />} />
            <Route path="activities/new" element={<ActivityEdit />} />
            <Route path="activities/import" element={<ProgramImport />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="teams" element={<TeamEvents />} />
            <Route path="teams/:teamEventId" element={<TeamEventPage />} />
            <Route path="activities/signup" element={<SignupScreen />} />
            <Route path="activities/:activityId" element={<ActivityRoster />} />
            <Route path="activities/:activityId/edit" element={<ActivityEdit />} />
            <Route path="meals" element={<Meals />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Outlet />}>
              <Route index element={<SettingsIndex />} />
              <Route path="event" element={<EventDetails />} />
              <Route path="staff" element={<Staff />} />
              <Route path="staff/add" element={<AddStaff />} />
              <Route path="stations" element={<Stations />} />
              <Route path="lanyards" element={<LanyardSettings />} />
              <Route path="copy" element={<CopyEvent />} />
            </Route>
            {/* Old addresses */}
            <Route path="live" element={<Moved to="" />} />
            <Route path="roster/*" element={<Moved to="people" />} />
            <Route path="import" element={<Moved to="people/import" />} />
            <Route path="lanyards" element={<Moved to="people/lanyards" />} />
            <Route path="roll-sheet" element={<Moved to="people/roll-sheet" />} />
            <Route path="qr-codes" element={<Moved to="activities/signup" />} />
            <Route path="close-out" element={<Moved to="reports" />} />
            <Route path="staff" element={<Moved to="settings/staff" />} />
            <Route path="stations" element={<Moved to="settings/stations" />} />
            <Route path="*" element={<NotFound inEvent />} />
          </Route>
          <Route path="admin" element={<AdminIndex />} />
          <Route path="admin/accounts" element={<AdminUsers />} />
          <Route path="admin/log" element={<AdminLog />} />
          <Route path="admin/demo" element={<AdminDemo />} />
          <Route path="admin/users" element={<Navigate to="/admin/accounts" replace />} />
          <Route path="account" element={<Account />} />
          <Route path="account/password" element={<SetPassword />} />
          <Route path="account/view-as" element={<ViewAsPage />} />
          {import.meta.env.DEV && <Route path="_components" element={<ComponentSheet />} />}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
