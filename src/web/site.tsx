import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import { brandShades } from '../shared/site';
import { loadSnapshot, saveSnapshot } from './offline/db';

export interface SiteEvent {
  id: string;
  name: string;
  subdomain: string;
  brandColor: string | null;
  logoUrl: string | null;
}

/**
 * Which site this address is. An event's own address (supersplash.campcount.com)
 * is a separate, branded site for that one event; the main address is the
 * admin console.
 */
export type SiteInfo =
  | { kind: 'platform'; rootDomain: string | null }
  | { kind: 'event'; rootDomain: string | null; event: SiteEvent }
  | { kind: 'unknown'; rootDomain: string | null; subdomain: string };

const SiteContext = createContext<SiteInfo>({ kind: 'platform', rootDomain: null });

export function useSite(): SiteInfo {
  return useContext(SiteContext);
}

/** The event this address belongs to, if it's an event's own site. */
export function useSiteEvent(): SiteEvent | null {
  const site = useSite();
  return site.kind === 'event' ? site.event : null;
}

/** The full address of an event's own site, or null when addresses aren't set up (e.g. on workers.dev). */
export function eventSiteUrl(rootDomain: string | null, subdomain: string | null | undefined, path = '/'): string | null {
  if (!rootDomain || !subdomain) return null;
  const { protocol, hostname, port } = window.location;
  // Only link to subdomains when we're on the root domain itself (or one of its subdomains).
  if (hostname !== rootDomain && !hostname.endsWith(`.${rootDomain}`)) return null;
  return `${protocol}//${subdomain}.${rootDomain}${port ? `:${port}` : ''}${path}`;
}

/** Paint the event's colour, logo and name onto the page. */
export function applyBranding(event: { brandColor: string | null; logoUrl: string | null; name: string } | null) {
  const root = document.documentElement.style;
  if (event?.brandColor) {
    const { brand, hover, tint } = brandShades(event.brandColor);
    root.setProperty('--brand', brand);
    root.setProperty('--brand-hover', hover);
    root.setProperty('--brand-tint', tint);
  } else {
    root.removeProperty('--brand');
    root.removeProperty('--brand-hover');
    root.removeProperty('--brand-tint');
  }
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) {
    icon.dataset.default ??= icon.href;
    icon.href = event?.logoUrl ?? icon.dataset.default;
  }
  const theme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (theme && event?.brandColor) theme.content = brandShades(event.brandColor).brand;
}

export function SiteProvider({ children }: { children: ReactNode }) {
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const key = `ui:site:${window.location.host}`;
    const use = (s: SiteInfo) => {
      setSite(s);
      if (s.kind === 'event') applyBranding(s.event);
    };
    api<SiteInfo>('/site')
      .then((s) => {
        use(s);
        void saveSnapshot(key, s).catch(() => undefined);
      })
      // Offline at start-up (a scanner with no signal): use what this phone saw last time.
      .catch(async () => {
        const saved = await loadSnapshot<SiteInfo>(key).catch(() => null);
        if (saved) use(saved);
        else setFailed(true);
      });
  }, []);
  if (!site && !failed) return null;
  return <SiteContext.Provider value={site ?? { kind: 'platform', rootDomain: null }}>{children}</SiteContext.Provider>;
}
