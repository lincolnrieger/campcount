import { Link, Outlet } from 'react-router';
import { useSession } from '../session';

export function Layout() {
  const { me, signOut } = useSession();
  const isAdmin = me?.kind === 'user' && me.platformPermissions.includes('platform.users.manage');
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          CampCount
        </Link>
        <nav className="topbar-nav" aria-label="Account">
          {isAdmin && <Link to="/admin/users">People</Link>}
          {me?.kind === 'user' && <span className="visually-hidden">Signed in as </span>}
          {me?.kind === 'user' && <span className="hide-narrow">{me.user.displayName}</span>}
          <button type="button" className="btn-link" onClick={() => void signOut()}>
            Sign out
          </button>
        </nav>
      </header>
      <main className="page" id="main">
        <Outlet />
      </main>
    </div>
  );
}
