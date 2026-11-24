import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import { Badge } from './Feedback';
import { stopPreview } from '../components/ViewAs';
import { useSession } from '../session';
import type { NavSection } from '../shell';
import { activeNav, useShell } from '../shell';
import { useSite } from '../site';

/** True when event addresses work here (on campcount.com, not workers.dev): the main site is then just the admin console. */
function useConsoleOnly(): boolean {
  const site = useSite();
  const host = window.location.hostname;
  return !!site.rootDomain && (host === site.rootDomain || host.endsWith(`.${site.rootDomain}`));
}

/**
 * The CampCount mark: a rounded square with a green tick breaking out of its
 * corner (the logo without its words, which can't be read this small).
 * Same drawing as public/favicon.svg.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="178 180 900 900" aria-hidden="true" focusable="false">
      <path d="M868 270H346a130 130 0 0 0-130 130v512a130 130 0 0 0 130 130h554a130 130 0 0 0 130-130V420q0-40-18-70" fill="none" stroke="#000" strokeWidth="72" />
      <path d="M702 374l93 102 213-245" fill="none" stroke="#169239" strokeWidth="104" strokeLinecap="round" strokeLinejoin="round" />
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
    events: !scanning && (pathname === '/' || pathname.startsWith('/events') || pathname.startsWith('/camps')),
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
  const consoleOnly = useConsoleOnly();
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
              {isAdmin ? 'Camps' : 'Events'}
            </Link>
          </li>
          {!consoleOnly && (
            <li>
              <Link to="/scan" aria-current={area.scanning ? 'page' : undefined}>
                <Icon name="scan" />
                Scan
              </Link>
            </li>
          )}
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
            <EventNavList base={event.base} sections={event.sections} label={`${event.name} sections`} />
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
  const location = useLocation();
  const area = useArea();
  const consoleOnly = useConsoleOnly();
  const tabs: { to: string; label: string; icon: IconName; active: boolean }[] = [
    { to: '/', label: isAdmin ? 'Camps' : 'Events', icon: 'events', active: area.events || location.pathname.startsWith('/camps') },
    ...(consoleOnly ? [] : [{ to: '/scan', label: 'Scan', icon: 'scan' as const, active: area.scanning }]),
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

/** The path inside the event ('' for Home). */
function useRel(base: string) {
  const { pathname } = useLocation();
  const inside = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  return inside.replace(/^\/+|\/+$/g, '');
}

/**
 * An event's sections in the sidebar. Sections with pages under them open
 * and close (the one you're in starts open), so every page is one click away
 * without hunting through menus.
 */
export function EventNavList({ base, sections, label }: { base: string; sections: NavSection[]; label: string }) {
  const rel = useRel(base);
  const active = activeNav(sections, rel);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // Opening a page in a section opens that section.
  useEffect(() => {
    if (active.section !== null) setOpen((o) => (o[active.section!] ? o : { ...o, [active.section!]: true }));
  }, [active.section]);
  return (
    <ul className="navtree" aria-label={label}>
      {sections.map((s) => {
        const here = active.section === s.to;
        const isOpen = !!open[s.to];
        const id = `nav-${s.to || 'home'}`.replace(/\W/g, '-');
        return (
          <li key={s.to} className={here ? 'navtree-section is-here' : 'navtree-section'}>
            <div className="navtree-head">
              <Link to={`${base}/${s.to}`} aria-current={here && (!s.children || active.page === null) ? 'page' : undefined}>
                <Icon name={(s.icon as IconName) ?? 'chevron'} />
                <span>{s.label}</span>
              </Link>
              {s.children && (
                <button
                  type="button"
                  className="navtree-toggle"
                  aria-expanded={isOpen}
                  aria-controls={id}
                  aria-label={`${isOpen ? 'Hide' : 'Show'} ${s.label} pages`}
                  onClick={() => setOpen((o) => ({ ...o, [s.to]: !isOpen }))}
                >
                  <Icon name="down" size={18} />
                </button>
              )}
            </div>
            {s.children && (
              <div className={isOpen ? 'navtree-body is-open' : 'navtree-body'} id={id}>
                <ul inert={!isOpen}>
                  {s.children.map((c) => (
                    <li key={c.to}>
                      <Link to={`${base}/${c.to}`} aria-current={here && active.page === c.to ? 'page' : undefined}>
                        {c.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Event sections on phones: one scrollable row of tabs under the top bar. */
export function EventTabs({ base, sections }: { base: string; sections: NavSection[] }) {
  const ref = useRef<HTMLElement>(null);
  const rel = useRel(base);
  const active = activeNav(sections, rel);
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [active.section]);
  if (sections.length < 2) return null;
  return (
    <nav className="tabs event-tabs only-phone" aria-label="Event sections" ref={ref}>
      {sections.map((s) => (
        <Link key={s.to} to={`${base}/${s.to}`} aria-current={active.section === s.to ? 'page' : undefined}>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

/** Phones: the pages of the section you're in, as a second row of chips. */
export function EventSubTabs({ base, sections }: { base: string; sections: NavSection[] }) {
  const ref = useRef<HTMLElement>(null);
  const rel = useRel(base);
  const active = activeNav(sections, rel);
  const section = sections.find((s) => s.to === active.section);
  useEffect(() => {
    ref.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [active.page]);
  if (!section?.children) return null;
  return (
    <nav className="subtabs only-phone" aria-label={`${section.label} pages`} ref={ref}>
      {section.children.map((c) => (
        <Link key={c.to} to={`${base}/${c.to}`} aria-current={active.page === c.to ? 'page' : undefined}>
          {c.label}
        </Link>
      ))}
    </nav>
  );
}
