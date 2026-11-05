import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Icon } from './Icon';
import { ViewAsSheet, stopPreview } from './ViewAs';
import { useSession } from '../session';
import { useShell } from '../shell';


function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** The CampCount mark: a tent in a rounded square, as on the favicon. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="6" fill="#1F4D3F" />
      <path d="M6 25 16 7l10 18z" fill="none" stroke="#F5C542" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M13 25l3-6 3 6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

function useSections() {
  const { pathname } = useLocation();
  const scanning = pathname === '/scan' || /^\/events\/[^/]+\/scan\//.test(pathname);
  return {
    scanning,
    events: !scanning && (pathname === '/' || pathname.startsWith('/events')),
    admin: pathname.startsWith('/admin'),
    account: pathname.startsWith('/account'),
  };
}

/** Desktop sidebar: the app's sections, the current event's sections, Admin, and you. */
function Sidebar({ isAdmin, canViewAs, onViewAs }: { isAdmin: boolean; canViewAs: boolean; onViewAs: () => void }) {
  const { me } = useSession();
  const { event } = useShell();
  const here = useSections();
  if (me?.kind !== 'user') return null;
  return (
    <aside className="sidebar" aria-label="Sidebar">
      <Link to="/" className="sidebar-brand">
        <BrandMark /> CampCount <span>Scouts SA</span>
      </Link>
      <nav className="sidebar-nav" aria-label="Main">
        <div className="nav-group">
          <ul className="nav-list">
            <li>
              <Link to="/" className={here.events && !event ? 'is-active' : undefined} aria-current={here.events && !event ? 'page' : undefined}>
                Events
              </Link>
            </li>
            <li>
              <Link to="/scan" className={here.scanning ? 'is-active' : undefined} aria-current={here.scanning ? 'page' : undefined}>
                Scan
              </Link>
            </li>
          </ul>
        </div>
        {event && (
          <div className="nav-group">
            <p className="nav-event">
              <Link to={`/events/${event.id}`}>{event.name}</Link>
              <span>{event.meta}</span>
            </p>
            <ul className="nav-list" aria-label={`${event.name} sections`}>
              {event.sections.map((s) => (
                <li key={s.to}>
                  <NavLink to={`/events/${event.id}${s.to ? `/${s.to}` : ''}`} end={s.to === '' || s.to === 'live'}>
                    {s.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
        {isAdmin && (
          <div className="nav-group">
            <p className="nav-group-label">Administration</p>
            <ul className="nav-list">
              <li>
                <NavLink to="/admin/accounts">Accounts</NavLink>
              </li>
              <li>
                <NavLink to="/admin/log">Activity log</NavLink>
              </li>
              <li>
                <NavLink to="/admin/demo">Demo camps</NavLink>
              </li>
            </ul>
          </div>
        )}
      </nav>
      <div className="sidebar-foot">
        <Link to="/account" className="user-chip" aria-current={here.account ? 'page' : undefined}>
          <span className="avatar" aria-hidden="true">
            {initials(me.user.displayName)}
          </span>
          <span>
            <strong>{me.user.displayName}</strong>
            <small>{me.user.email}</small>
          </span>
        </Link>
        {canViewAs && (
          <button type="button" className="btn btn-secondary btn-small" aria-haspopup="dialog" onClick={onViewAs}>
            <Icon name="eye" size={16} /> View as a role
          </button>
        )}
      </div>
    </aside>
  );
}

/** Phones and tablets: a thumb-reach tab bar. */
function TabBar({ isAdmin }: { isAdmin: boolean }) {
  const here = useSections();
  const tabs = [
    { to: '/', label: 'Events', icon: 'home' as const, active: here.events },
    { to: '/scan', label: 'Scan', icon: 'scan' as const, active: here.scanning },
    ...(isAdmin ? [{ to: '/admin', label: 'Admin', icon: 'admin' as const, active: here.admin }] : []),
    { to: '/account', label: 'Account', icon: 'user' as const, active: here.account },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => (
        <Link key={t.to} to={t.to} className={t.active ? 'is-active' : undefined} aria-current={t.active ? 'page' : undefined}>
          <Icon name={t.icon} size={22} />
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export function Layout() {
  const { me, signOut } = useSession();
  const location = useLocation();
  const [viewAs, setViewAs] = useState(false);
  const preview = me?.kind === 'user' ? me.preview : null;
  const isAdmin = me?.kind === 'user' && me.platformPermissions.includes('platform.users.manage');
  const canViewAs = me?.kind === 'user' && (isAdmin || preview !== null);
  const eventMatch = /^\/events\/([0-9a-f-]{36})/.exec(location.pathname);

  // New page: start at the top, like a native navigation push.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {me?.kind === 'user' && <Sidebar isAdmin={isAdmin} canViewAs={canViewAs} onViewAs={() => setViewAs(true)} />}
      <div className="main">
        <header className="topbar">
          <Link to="/" className="topbar-title" aria-label="CampCount, go to Events">
            <BrandMark />
            CampCount
          </Link>
          <div className="topbar-actions">
            {canViewAs && (
              <button type="button" className="icon-button" aria-label="View as a role" aria-haspopup="dialog" onClick={() => setViewAs(true)}>
                <Icon name="eye" size={20} />
              </button>
            )}
            {me?.kind === 'station' && (
              <button type="button" className="btn btn-secondary btn-small" onClick={() => void signOut()}>
                Unpair this device
              </button>
            )}
          </div>
        </header>
        {preview && (
          <div className="banner" role="note">
            <p>
              Viewing <strong>{preview.eventName}</strong> as <strong>{preview.roleName}</strong>
              {preview.activityName && ` (${preview.activityName})`}
            </p>
            <div className="banner-actions">
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setViewAs(true)}>
                Switch role
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={async () => {
                  await stopPreview();
                  window.location.assign('/');
                }}
              >
                Stop viewing as
              </button>
            </div>
          </div>
        )}
        {me?.kind === 'user' && me.user.isDemo && (
          <div className="banner" role="note">
            <p>
              Demo account: <strong>{me.user.displayName}</strong>.
            </p>
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void signOut()}>
              Sign out of demo
            </button>
          </div>
        )}
        <main className="page" id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      {me?.kind === 'user' && <TabBar isAdmin={isAdmin} />}
      {canViewAs && <ViewAsSheet open={viewAs} onClose={() => setViewAs(false)} initialEventId={eventMatch?.[1]} />}
    </div>
  );
}

/** Desktop breadcrumbs: every level above this page, each a link. */
export function Breadcrumbs({ trail }: { trail: { to?: string; label: string }[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map((c, i) => (
          <li key={i}>{c.to && i < trail.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}
