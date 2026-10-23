import { Navigate, Route, Routes, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { AdminUsers } from './pages/AdminUsers';
import { EventLayout } from './pages/EventLayout';
import { EventOverview } from './pages/EventOverview';
import { Events, NewEvent } from './pages/Events';
import { SignIn, VerifyLink } from './pages/SignIn';
import { Staff } from './pages/Staff';
import { useSession } from './session';

function RequireSignIn({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const location = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/sign-in/verify" element={<VerifyLink />} />
      <Route
        element={
          <RequireSignIn>
            <Layout />
          </RequireSignIn>
        }
      >
        <Route index element={<Events />} />
        <Route path="events/new" element={<NewEvent />} />
        <Route path="events/:eventId" element={<EventLayout />}>
          <Route index element={<EventOverview />} />
          <Route path="staff" element={<Staff />} />
        </Route>
        <Route path="admin/users" element={<AdminUsers />} />
        <Route path="*" element={<p>That page doesn't exist.</p>} />
      </Route>
    </Routes>
  );
}
