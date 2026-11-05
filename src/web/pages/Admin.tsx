import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { Breadcrumbs } from '../components/Layout';
import { useSession } from '../session';

const SECTIONS = [
  { to: 'accounts', label: 'Accounts' },
  { to: 'log', label: 'Activity log' },
  { to: 'demo', label: 'Demo camps' },
];

/**
 * Administration: accounts, the activity log and demo camps. On desktop the
 * sidebar lists them; on phones they're a tab row. Platform admins only
 * (the server checks too).
 */
export function AdminLayout() {
  const { me } = useSession();
  const { pathname } = useLocation();
  if (me?.kind !== 'user' || !me.platformPermissions.includes('platform.users.manage')) return <Navigate to="/" replace />;
  const here = SECTIONS.find((s) => pathname.startsWith(`/admin/${s.to}`));
  return (
    <>
      <Breadcrumbs trail={[{ to: '/admin', label: 'Administration' }, { label: here?.label ?? '' }]} />
      <nav className="subnav subnav-section" aria-label="Administration sections">
        {SECTIONS.map((s) => (
          <NavLink key={s.to} to={s.to}>
            {s.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
export function AdminIndex() { return null; } // TODO(rebuild)
