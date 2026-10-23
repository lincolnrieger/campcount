import { Link } from 'react-router';
import type { Activity } from '../pages/Activities';
import type { Meal } from '../pages/Meals';
import type { EventSummary } from '../types';
import { useApi } from '../useApi';

/** The volunteer's front door: one tap from the event page to the right scanner. */
export function ScanLauncher({ event }: { event: EventSummary }) {
  const can = (p: string) => event.permissions.includes(p as never);
  const activities = useApi<{ activities: Activity[] }>(event.features.activities ? `/events/${event.id}/activities` : null);
  const meals = useApi<{ meals: Meal[] }>(event.features.meals && can('meal.scan') ? `/events/${event.id}/meals` : null);
  if (event.status !== 'open') return null;

  const activityLinks = (activities.data?.activities ?? []).filter((a) => a.status === 'active');
  // The server only returns activities this person may scan (or manage).
  const canScanActivities = can('activity.scan');
  const links = [
    ...(event.features.site && can('site.scan') ? [{ to: `/events/${event.id}/scan/site`, label: 'On site', hint: 'Arrivals and departures' }] : []),
    ...(meals.data?.meals ?? []).filter((m) => m.status === 'active').map((m) => ({ to: `/events/${event.id}/scan/meal/${m.id}`, label: m.name, hint: 'Meal' })),
    ...(canScanActivities ? activityLinks : []).map((a) => ({ to: `/events/${event.id}/scan/activity/${a.id}`, label: a.name, hint: a.location || 'Activity' })),
  ];
  if (links.length === 0) return null;

  return (
    <section aria-labelledby="scan-heading">
      <h2 id="scan-heading">Start scanning</h2>
      <ul className="launch">
        {links.map((l) => (
          <li key={l.to}>
            <Link to={l.to}>
              {l.label} <span>{l.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
