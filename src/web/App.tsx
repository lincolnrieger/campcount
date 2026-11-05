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
import { Events, NewEvent } from './pages/Events';
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
import { Pair } from './pages/Pair';
import { ScanHub } from './pages/ScanHub';
import { Stations } from './pages/Stations';
import { Reports } from './pages/Reports';
import { RollSheet } from './pages/RollSheet';
import { EventDetails, SettingsIndex } from './pages/Settings';
import { CopyEvent } from './pages/CopyEvent';
import { NotFound } from './pages/NotFound';
import { useSession } from './session';

// The camera, PDF and spreadsheet code is heavy: load it only on the pages that need it.
const Scan = lazy(() => import('./pages/Scan').then((m) => ({ default: m.Scan })));
const Lanyards = lazy(() => import('./pages/Lanyards').then((m) => ({ default: m.Lanyards })));
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

/** Stations go straight to their one scanner; people see their events. */
function Home() {
  const { me } = useSession();
  if (me?.kind === 'station') {
    const { eventId, contextType, contextId } = me.station;
    return <Navigate to={`/events/${eventId}/scan/${contextType}${contextId ? `/${contextId}` : ''}`} replace />;
  }
  return <Events />;
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
          <Route path="events/:eventId" element={<EventLayout />}>
            <Route index element={<EventHome />} />
            <Route path="people" element={<Roster />} />
            <Route path="people/add" element={<AddPerson />} />
            <Route path="people/import" element={<Import />} />
            <Route path="people/lanyards" element={<Lanyards />} />
            <Route path="people/roll-sheet" element={<RollSheet />} />
            <Route path="people/:registrationId" element={<Person />} />
            <Route path="people/:registrationId/edit" element={<PersonEdit />} />
            <Route path="activities" element={<Activities />} />
            <Route path="activities/new" element={<ActivityEdit />} />
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
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
