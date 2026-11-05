import { useEffect } from 'react';
import { eventSiteUrl, useSite } from '../site';
import type { EventSummary } from '../types';
import { useApi } from '../useApi';
import { EmptyState, LoadError, Loading, PageHeader, SkeletonHeader, SkeletonRows } from '../ui';
import { CampMark } from './Camps';
import { Events } from './Events';

/**
 * Staff who sign in at the main address: send them to their camp's own
 * address. With several camps, list them; when addresses aren't set up
 * (for example on the workers.dev address), fall back to the events list.
 */
export function StaffLanding() {
  const site = useSite();
  const { data, error, loading, reload } = useApi<{ events: EventSummary[] }>('/events');
  const camps = (data?.events ?? []).map((e) => ({ e, url: eventSiteUrl(site.rootDomain, e.subdomain) })).filter((c) => c.url);
  const only = camps.length === 1 ? camps[0]!.url : null;
  useEffect(() => {
    if (only) window.location.replace(only);
  }, [only]);

  if ((loading && !data) || only)
    return (
      <Loading what="your camp">
        <SkeletonHeader />
        <SkeletonRows rows={2} />
      </Loading>
    );
  if (error) return <LoadError error={error} onRetry={reload} what="your camps" />;
  if (camps.length === 0) {
    if ((data?.events.length ?? 0) > 0) return <Events />;
    return (
      <>
        <PageHeader title="CampCount" />
        <EmptyState title="You're not on a camp yet">An event manager adds you to their camp's staff. Then you'll be sent straight there.</EmptyState>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Your camps" summary="Each camp has its own address. Choose one." />
      <ul className="list">
        {camps.map(({ e, url }) => (
          <li key={e.id} className="row row-link row-large">
            <CampMark event={e} />
            <span className="row-main">
              <span className="row-title">
                <a href={url!}>{e.name}</a>
              </span>
              <span className="row-meta">{url!.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
