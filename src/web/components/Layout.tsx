import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Icon } from './Icon';
import { ViewAsSheet, stopPreview } from './ViewAs';
import { useSession } from '../session';

/**
 * iOS-style collapsing title: pages register their large heading; when it
 * scrolls under the header, its text appears in the compact header instead.
 */
const TitleContext = createContext<(title: string | null) => void>(() => undefined);

export function useCollapsingTitle<T extends HTMLElement>(title: string): RefObject<T | null> {
  const setTitle = useContext(TitleContext);
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(([entry]) => setTitle(entry!.isIntersecting ? null : title), {
      rootMargin: '-56px 0px 0px 0px',
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      setTitle(null);
    };
  }, [title, setTitle]);
  return ref;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Main sections: a bottom tab bar on phones, links in the header on wider screens. */
function TabLinks({ className, isAdmin }: { className: string; isAdmin: boolean }) {
  const { pathname } = useLocation();
  const scanning = pathname === '/scan' || /^\/events\/[^/]+\/scan\//.test(pathname);
  const tabs = [
    { to: '/', label: 'Home', icon: 'home' as const, active: !scanning && (pathname === '/' || pathname.startsWith('/events')) },
    { to: '/scan', label: 'Scan', icon: 'scan' as const, active: scanning },
    ...(isAdmin ? [{ to: '/admin', label: 'Admin', icon: 'admin' as const, active: pathname.startsWith('/admin') }] : []),
    { to: '/account', label: 'You', icon: 'user' as const, active: pathname.startsWith('/account') },
  ];
  return (
    <nav className={className} aria-label="Main">
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
  const [title, setTitle] = useState<string | null>(null);
  const [viewAs, setViewAs] = useState(false);
  const preview = me?.kind === 'user' ? me.preview : null;
  const canViewAs = me?.kind === 'user' && (me.platformPermissions.includes('platform.users.manage') || preview !== null);
  const isAdmin = me?.kind === 'user' && me.platformPermissions.includes('platform.users.manage');
  const eventMatch = /^\/events\/([0-9a-f-]{36})/.exec(location.pathname);

  // New page: start at the top, like a native navigation push.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <TitleContext.Provider value={setTitle}>
      <div className="shell">
        <header className={title ? 'topbar has-title' : 'topbar'}>
          {me?.kind === 'user' && <TabLinks className="topnav" isAdmin={isAdmin} />}
          <p className={title ? 'topbar-title is-shown' : 'topbar-title'} aria-hidden={!title}>
            {title}
          </p>
          <div className="topbar-actions">
            {canViewAs && (
              <button type="button" className="viewas-button" onClick={() => setViewAs(true)}>
                <Icon name="eye" size={18} />
                <span>View as</span>
              </button>
            )}
            {me?.kind === 'user' && (
              <Link to="/account" className="avatar hide-phone" aria-label={`Your account: ${me.user.displayName}`}>
                {initials(me.user.displayName)}
              </Link>
            )}
            {me?.kind === 'station' && (
              <button type="button" className="btn-link" onClick={() => void signOut()}>
                Unpair
              </button>
            )}
          </div>
        </header>
        {preview && (
          <div className="preview-banner" role="note">
            <p>
              Viewing <strong>{preview.eventName}</strong> as <strong>{preview.roleName}</strong>
              {preview.activityName && ` (${preview.activityName})`}
            </p>
            <div className="preview-actions">
              <button type="button" onClick={() => setViewAs(true)}>
                <Icon name="swap" size={16} /> Switch
              </button>
              <button
                type="button"
                onClick={async () => {
                  await stopPreview();
                  window.location.assign('/');
                }}
              >
                Back to me
              </button>
            </div>
          </div>
        )}
        {me?.kind === 'user' && me.user.isDemo && (
          <div className="demo-banner" role="note">
            Demo account: {me.user.displayName}.{' '}
            <button type="button" className="btn-link" onClick={() => void signOut()}>
              Sign out
            </button>{' '}
            to go back to your own account.
          </div>
        )}
        <main className="page" id="main">
          <Outlet />
        </main>
        {me?.kind === 'user' && <TabLinks className="tabbar" isAdmin={isAdmin} />}
        {canViewAs && <ViewAsSheet open={viewAs} onClose={() => setViewAs(false)} initialEventId={eventMatch?.[1]} />}
      </div>
    </TitleContext.Provider>
  );
}
