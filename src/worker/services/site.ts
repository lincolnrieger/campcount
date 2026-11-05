import type { AppContext } from '../context';
import type { EventRow } from '../routes/events';

/**
 * Which site a request is for. Each event can have its own address,
 * <subdomain>.<ROOT_DOMAIN>, which only ever shows that event. Every other
 * host (the main address, workers.dev, localhost) is the platform site.
 */
export type Site = { kind: 'platform' } | { kind: 'event'; event: EventRow } | { kind: 'unknown'; subdomain: string };

export function subdomainOf(host: string, root: string | undefined): string | null {
  if (!root) return null;
  const h = host.toLowerCase().replace(/:\d+$/, '');
  const r = root.toLowerCase();
  if (!h.endsWith(`.${r}`)) return null;
  const sub = h.slice(0, -(r.length + 1));
  if (!sub || sub === 'www' || sub.includes('.')) return null;
  return sub;
}

export async function resolveSite(c: AppContext): Promise<Site> {
  const cached = c.get('site');
  if (cached) return cached;
  const sub = subdomainOf(new URL(c.req.url).host, c.env.ROOT_DOMAIN);
  let site: Site = { kind: 'platform' };
  if (sub) {
    const event = await c.env.DB.prepare(`SELECT * FROM events WHERE subdomain = ?`).bind(sub).first<EventRow>();
    site = event ? { kind: 'event', event } : { kind: 'unknown', subdomain: sub };
  }
  c.set('site', site);
  return site;
}
