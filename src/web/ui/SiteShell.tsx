import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Badge } from './Feedback';
import { BrandMark } from './AppShell';
import { stopPreview } from '../components/ViewAs';
import { useSession } from '../session';
import { useShell } from '../shell';
import { useSiteEvent } from '../site';

const ICONS: Record<string, IconName> = { '': 'home', scan: 'scan', people: 'user', activities: 'events', meals: 'events', reports: 'download', settings: 'admin', more: 'more', account: 'user' };

/** The event's own logo (or the CampCount mark when it has none). */
export function SiteLogo({ size = 32 }: { size?: number }) {
  const event = useSiteEvent();
  if (event?.logoUrl) return <img className="site-logo" src={event.logoUrl} alt="" width={size} height={size} />;
  return <BrandMark size={size} />;
}

/** How many sections fit in the phone tab bar before the rest go under More. */
const TAB_LIMIT = 4;

/**
 * The frame for an event's own address. It only ever shows this event:
 * its logo, colour and name, and the sections this person can use.
 * Computers get a sidebar; phones a top bar and a bottom tab bar.
 */
export function SiteShell() {
  const { me, signOut } = useSession();
  const { event: shellEvent } = useShell();
  const site = useSiteEvent()!;
  const location = useLocation();
  const first = useRef(true);
  const preview = me?.kind === 'user' ? me.preview : null;
  const sections = shellEvent?.sections ?? [];
  const tabs = sections.length + 1 > TAB_LIMIT ? [...sections.slice(0, TAB_LIMIT - 1), { to: 'more', label: 'More' }] : [...sections, { to: 'account', label: 'Account' }];
  const inMore = sections.slice(TAB_LIMIT - 1).some((s) => location.pathname.startsWith(`/${s.to}`)) || location.pathname.startsWith('/account');

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
      {me?.kind === 'user' && (
        <aside className="sidebar">
          <Link to="/" className="sidebar-brand">
            <SiteLogo />
            <span>{site.name}</span>
          </Link>
          <nav className="sidebar-nav" aria-label="Main">
            {shellEvent && shellEvent.status !== 'open' && (
              <p className="sidebar-status">
                <Badge tone={shellEvent.status === 'draft' ? 'warning' : 'neutral'}>{shellEvent.status === 'draft' ? 'Not open yet' : 'Closed'}</Badge>
              </p>
            )}
            <ul>
              {sections.map((s) => (
                <li key={s.to}>
                  <NavLink to={`/${s.to}`} end={s.to === ''}>
                    <Icon name={ICONS[s.to] ?? 'chevron'} />
                    {s.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <Link to="/account" className="sidebar-user" aria-current={location.pathname.startsWith('/account') ? 'page' : undefined}>
            <span className="avatar" aria-hidden="true">
              {me.user.displayName
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((p) => p[0]!.toUpperCase())
                .join('')}
            </span>
            <span className="sidebar-user-text">
              <strong>{me.user.displayName}</strong>
              <span>Account</span>
            </span>
          </Link>
        </aside>
      )}
      <div className="shell-main">
        <header className="topbar">
          <Link to="/" className="topbar-title">
            <SiteLogo size={28} />
            <span>{site.name}</span>
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
              Viewing as <strong>{preview.roleName}</strong>
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
        <main className="page" id="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      {me?.kind === 'user' && (
        <nav className="tabbar" aria-label="Main">
          {tabs.map((t) => {
            const active = t.to === 'more' ? inMore : t.to === '' ? location.pathname === '/' : location.pathname.startsWith(`/${t.to}`);
            return (
              <Link key={t.to} to={`/${t.to}`} aria-current={active ? 'page' : undefined}>
                <Icon name={ICONS[t.to] ?? 'chevron'} size={24} />
                <span>{t.label}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
