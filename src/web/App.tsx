import { Navigate, Route, Routes, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { AdminUsers } from './pages/AdminUsers';
import { Admin } from './pages/Admin';
import { AdminDemo } from './pages/AdminDemo';
import { Account, SetPassword } from './pages/Account';
import { EventLayout } from './pages/EventLayout';
import { EventOverview } from './pages/EventOverview';
import { Events, NewEvent } from './pages/Events';
import { SignIn, VerifyLink } from './pages/SignIn';
import { Staff } from './pages/Staff';
import { Import } from './pages/Import';
import { Lanyards } from './pages/Lanyards';
import { Roster } from './pages/Roster';
import { Activities } from './pages/Activities';
import { Meals } from './pages/Meals';
import { Pair } from './pages/Pair';
import { Scan } from './pages/Scan';
import { ScanHub } from './pages/ScanHub';
import { Stations } from './pages/Stations';
import { Live } from './pages/Live';
import { CloseOut } from './pages/CloseOut';
import { RollSheet } from './pages/RollSheet';
import { useSession } from './session';

function RequireSignIn({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const location = useLocation();
  if (loading) return <Loading />;
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

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/sign-up" element={<SignIn />} />
      <Route path="/sign-in/verify" element={<VerifyLink />} />
      <Route path="/pair" element={<Pair />} />
      <Route
        element={
          <RequireSignIn>
            <Layout />
          </RequireSignIn>
        }
      >
        <Route index element={<Home />} />
        <Route path="scan" element={<ScanHub />} />
        <Route path="events/:eventId/scan/:type/:contextId?" element={<ScanRoute />} />
        <Route path="events/new" element={<NewEvent />} />
        <Route path="events/:eventId" element={<EventLayout />}>
          <Route index element={<EventOverview />} />
          <Route path="staff" element={<Staff />} />
          <Route path="roster" element={<Roster />} />
          <Route path="import" element={<Import />} />
          <Route path="lanyards" element={<Lanyards />} />
          <Route path="activities" element={<Activities />} />
          <Route path="meals" element={<Meals />} />
          <Route path="stations" element={<Stations />} />
          <Route path="live" element={<Live />} />
          <Route path="close-out" element={<CloseOut />} />
          <Route path="roll-sheet" element={<RollSheet />} />
        </Route>
        <Route path="admin" element={<Admin />} />
        <Route path="admin/users" element={<AdminUsers />} />
        <Route path="admin/demo" element={<AdminDemo />} />
        <Route path="account" element={<Account />} />
        <Route path="account/password" element={<SetPassword />} />
        <Route path="*" element={<p>That page doesn't exist.</p>} />
      </Route>
    </Routes>
  );
}
