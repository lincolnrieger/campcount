import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
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

export function Layout() {
  const { me, signOut } = useSession();
  const location = useLocation();
  const [title, setTitle] = useState<string | null>(null);
  const isAdmin = me?.kind === 'user' && me.platformPermissions.includes('platform.users.manage');

  // New page: start at the top, like a native navigation push.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <TitleContext.Provider value={setTitle}>
      <div className="shell">
        <header className="topbar">
          <Link to="/" className="brand" aria-label="CampCount home">
            <img src="/favicon.svg" alt="" width="26" height="26" />
            <span className={title ? 'brand-word is-hidden' : 'brand-word'}>CampCount</span>
          </Link>
          <p className={title ? 'topbar-title is-shown' : 'topbar-title'} aria-hidden={!title}>
            {title}
          </p>
          <nav className="topbar-nav" aria-label="Account">
            {isAdmin && (
              <Link to="/admin" className="hide-narrow">
                Admin
              </Link>
            )}
            {me?.kind === 'user' && (
              <Link to="/account" className="avatar" aria-label={`Your account: ${me.user.displayName}`}>
                {initials(me.user.displayName)}
              </Link>
            )}
            {me?.kind === 'station' && (
              <button type="button" className="btn-link" onClick={() => void signOut()}>
                Unpair
              </button>
            )}
          </nav>
        </header>
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
      </div>
    </TitleContext.Provider>
  );
}
