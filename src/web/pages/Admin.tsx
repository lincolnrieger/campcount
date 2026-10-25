import { Navigate, NavLink, Outlet } from 'react-router';
import { useSession } from '../session';

/** Admin: accounts, the activity log and demo camps, as tabs. Platform admins only (the server checks too). */
export function AdminLayout() {
  const { me } = useSession();
  if (me?.kind !== 'user' || !me.platformPermissions.includes('platform.users.manage')) return <Navigate to="/" replace />;
  return (
    <>
      <div className="page-head">
        <h1>Admin</h1>
      </div>
      <nav className="subnav" aria-label="Admin sections">
        <NavLink to="accounts">Accounts</NavLink>
        <NavLink to="log">Activity log</NavLink>
        <NavLink to="demo">Demo camps</NavLink>
      </nav>
      <Outlet />
    </>
  );
}
