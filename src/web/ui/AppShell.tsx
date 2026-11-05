import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Badge } from './Feedback';
import { stopPreview } from '../components/ViewAs';
import { useSession } from '../session';
import { useShell } from '../shell';

/** The CampCount mark: a tent in a rounded square, as on the favicon. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="6" fill="#1F5C46" />
      <path d="M6 25 16 7l10 18z" fill="none" stroke="#F5C542" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M13 25l3-6 3 6" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
    </svg>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

function useArea() {
  const { pathname } = useLocation();
  const scanning = pathname === '/scan' || /^\/events\/[^/]+\/scan\//.test(pathname);
  return {
    scanning,
    events: !scanning && (pathname === '/' || pathname.startsWith('/events')),
    admin: pathname.startsWith('/admin'),
    account: pathname.startsWith('/account'),
  };
}

const STATUS: Record<string, { label: string; tone: 'neutral' | 'warning' | 'success' }> = {
  draft: { label: 'Draft', tone: 'warning' },
  completed: { label: 'Closed', tone: 'neutral' },
  archived: { label: 'Archived', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** Computers: a fixed left sidebar with the app's areas, the current event's sections, Admin, and you. */
function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const { me } = useSession();
  const { event } = useShell();
  const area = useArea();
  if (me?.kind !== 'user') return null;
  const status = event ? STATUS[event.status] : undefined;
  return (
    <aside className="sidebar">
      <Link to="/" className="sidebar-brand">
        <BrandMark />
        <span>CampCount</span>
      </Link>
      <nav className="sidebar-nav" aria-label="Main">
        <ul>
          <li>
            <Link to="/" aria-current={area.events && !event ? 'page' : undefined}>
              <Icon name="events" />
              Events
            </Link>
          </li>
          <li>
            <Link to="/scan" aria-current={area.scanning ? 'page' : undefined}>
              <Icon name="scan" />
              Scan
            </Link>
          </li>
        </ul>
        {event && (
          <div className="sidebar-event">
            <p className="sidebar-event-name">
              <Link to={`/events/${event.id}`}>{event.name}</Link>
              {(status || event.isDemo) && (
                <span className="sidebar-event-badges">
                  {status && <Badge tone={status.tone}>{status.label}</Badge>}
                  {event.isDemo && <Badge tone="info">Demo</Badge>}
                </span>
              )}
            </p>
            <ul aria-label={`${event.name} sections`}>
              {event.sections.map((s) => (
                <li key={s.to}>
                  <NavLink to={`/events/${event.id}${s.to ? `/${s.to}` : ''}`} end={s.to === ''}>
                    {s.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        )}
        {isAdmin && (
          <div className="sidebar-group">
            <p className="sidebar-group-label" id="sidebar-admin">
              Admin
            </p>
            <ul aria-labelledby="sidebar-admin">
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
      <Link to="/account" className="sidebar-user" aria-current={area.account ? 'page' : undefined}>
        <span className="avatar" aria-hidden="true">
          {initials(me.user.displayName)}
        </span>
        <span className="sidebar-user-text">
          <strong>{me.user.displayName}</strong>
          <span>Account</span>
        </span>
      </Link>
    </aside>
  );
}

/** Phones and tablets: a thumb-reach tab bar. */
function TabBar({ isAdmin }: { isAdmin: boolean }) {
  const area = useArea();
  const tabs: { to: string; label: string; icon: IconName; active: boolean }[] = [
    { to: '/', label: 'Events', icon: 'events', active: area.events },
    { to: '/scan', label: 'Scan', icon: 'scan', active: area.scanning },
    ...(isAdmin ? [{ to: '/admin', label: 'Admin', icon: 'admin' as const, active: area.admin }] : []),
    { to: '/account', label: 'Account', icon: 'user', active: area.account },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => (
        <Link key={t.to} to={t.to} aria-current={t.active ? 'page' : undefined}>
          <Icon name={t.icon} size={24} />
          <span>{t.label}</span>
        </Link>
      ))}
    </nav>
  );
}

/** The app frame for signed-in pages. */
export function AppShell() {
  const { me, signOut } = useSession();
  const { event } = useShell();
  const location = useLocation();
  const preview = me?.kind === 'user' ? me.preview : null;
  const isAdmin = me?.kind === 'user' && me.platformPermissions.includes('platform.users.manage');
  const first = useRef(true);

  // A new page: start at the top and move focus to its heading, so screen readers announce it.
  useEffect(() => {
    window.scrollTo(0, 0);
    if (first.current) {
      first.current = false;
      return;
    }
    const t = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>('#main h1') ?? document.getElementById('main');
      target?.focus({ preventScroll: true });
    }, 50);
    return () => window.clearTimeout(t);
  }, [location.pathname]);

  return (
    <div className={me?.kind === 'user' ? 'shell has-tabbar' : 'shell'}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {me?.kind === 'user' && <Sidebar isAdmin={isAdmin} />}
      <div className="shell-main">
        <header className="topbar">
          <Link to={event ? `/events/${event.id}` : '/'} className="topbar-title">
            <BrandMark size={24} />
            <span>{event ? event.name : 'CampCount'}</span>
          </Link>
          {me?.kind === 'station' && (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => void signOut()}>
              Unpair this device
            </button>
          )}
        </header>
        {preview && (
          <div className="banner" role="note">
            <p>
              Viewing <strong>{preview.eventName}</strong> as <strong>{preview.roleName}</strong>
              {preview.activityName && ` (${preview.activityName})`}
            </p>
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
        )}
        {me?.kind === 'user' && me.user.isDemo && (
          <div className="banner" role="note">
            <p>
              Demo account: <strong>{me.user.displayName}</strong>
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
    </div>
  );
}

/** Event sections on phones: one scrollable row of tabs under the top bar. */
export function EventTabs({ eventId, sections }: { eventId: string; sections: { to: string; label: string }[] }) {
  const ref = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);
  if (sections.length < 2) return null;
  return (
    <nav className="tabs event-tabs only-phone" aria-label="Event sections" ref={ref}>
      {sections.map((s) => (
        <NavLink key={s.to} to={`/events/${eventId}${s.to ? `/${s.to}` : ''}`} end={s.to === ''}>
          {s.label}
        </NavLink>
      ))}
    </nav>
  );
}
