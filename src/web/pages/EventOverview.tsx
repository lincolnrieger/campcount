import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { canScan } from '../scan/targets';
import { useApi } from '../useApi';
import type { Registration } from './Roster';
import { Loading, Notice, Skeleton } from '../components/ui';
import { StatusActions } from './Settings';
import { useEvent } from './EventLayout';

interface Step {
  key: string;
  label: string;
  hint: string;
  to: string;
  done: boolean;
}

/** The event's home: what to do next, and the shortest way to the busiest tasks. */
export function EventOverview() {
  const { event, can } = useEvent();
  const roster = useApi<{ registrations: Registration[] }>(can('roster.view') ? `/events/${event.id}/registrations` : null);
  const draft = event.status === 'draft' && can('event.configure');
  const staff = useApi<{ staff: unknown[] }>(draft && can('staff.manage') ? `/events/${event.id}/staff` : null);
  const activities = useApi<{ activities: unknown[] }>(draft && event.features.activities ? `/events/${event.id}/activities` : null);
  const meals = useApi<{ meals: unknown[] }>(draft && event.features.meals ? `/events/${event.id}/meals` : null);
  const expected = roster.data?.registrations.filter((r) => r.status === 'active') ?? null;
  const live = useApi<{ contexts: { type: string; presentNow: number; trackSignOut: boolean }[] }>(
    can('reports.view') && event.status === 'open' ? `/events/${event.id}/live` : null,
  );
  const onSite = live.data?.contexts.find((c) => c.type === 'site')?.presentNow;
  const atActivities = live.data?.contexts.filter((c) => c.type === 'activity' && c.trackSignOut).reduce((n, c) => n + c.presentNow, 0);

  const steps: Step[] = draft
    ? [
        can('staff.manage') && { key: 'staff', label: 'Add staff', hint: 'Event managers, scanners, activity leaders and the meal team', to: 'settings/staff', done: (staff.data?.staff.length ?? 0) > 1 },
        can('roster.edit') && { key: 'people', label: 'Add people', hint: 'Import the MyScout export, or add people one at a time', to: 'people', done: (expected?.length ?? 0) > 0 },
        event.features.activities &&
          can('activities.manage') && { key: 'activities', label: 'Add activities', hint: 'With their days and times', to: 'activities', done: (activities.data?.activities.length ?? 0) > 0 },
        event.features.meals && can('meals.manage') && { key: 'meals', label: 'Add meals', hint: 'Each meal you want to count', to: 'meals', done: (meals.data?.meals.length ?? 0) > 0 },
        can('credentials.manage') && {
          key: 'lanyards',
          label: 'Print lanyards',
          hint: 'One card per person, with their QR code',
          to: 'people/lanyards',
          done: !!expected && expected.length > 0 && expected.every((r) => r.shortCode),
        },
      ].filter((s): s is Step => Boolean(s))
    : [];

  return (
    <>
      {event.description && <p className="event-notes">{event.description}</p>}
      {!can('event.configure') && can('staff.manage') && (
        <Notice title="You can manage staff for this event">
          <p>To see participant details, add yourself as an event manager in Settings › Staff, or use View as. Both are recorded in the activity log.</p>
        </Notice>
      )}

      {canScan(event) && (
        <Link to={`/scan?event=${event.id}`} className="scan-cta">
          <Icon name="scan" size={28} />
          <span>
            <strong>Start scanning</strong>
            <span>Gate, meals and activities</span>
          </span>
          <Icon name="chevron" />
        </Link>
      )}

      {draft && (
        <section aria-labelledby="setup-heading" className="setup">
          <h2 id="setup-heading">Get ready</h2>
          <ol className="setup-steps">
            {steps.map((s) => (
              <li key={s.key} className={s.done ? 'is-done' : undefined}>
                <Link to={s.to}>
                  <span className="setup-mark" aria-hidden="true">
                    {s.done ? '✓' : ''}
                  </span>
                  <span className="list-main">
                    <strong>
                      {s.label}
                      {s.done && <span className="visually-hidden"> (done)</span>}
                    </strong>
                    <span>{s.hint}</span>
                  </span>
                  <Icon name="chevron" />
                </Link>
              </li>
            ))}
          </ol>
          <div className="setup-open">
            <p className="field-hint">Nobody can scan until the event is open. You can keep changing things afterwards.</p>
            <StatusActions only={['open']} />
          </div>
        </section>
      )}

      {live.data && (
        <Link to="live" className="expected">
          <span className="expected-main">
            <strong>{event.features.site && onSite !== undefined ? onSite : atActivities}</strong>
            <span>{event.features.site && onSite !== undefined ? 'on site now' : 'at activities now'}</span>
          </span>
          <span className="expected-side">
            <span className="field-hint">{event.features.site && onSite !== undefined ? `${atActivities} at activities. ` : ''}See where everyone is</span>
            <Icon name="chevron" />
          </span>
        </Link>
      )}
      {roster.loading && !roster.data && (
        <Loading label="Loading attendees">
          <Skeleton width="100%" height="74px" radius="var(--radius)" className="skeleton-gap-lg" />
        </Loading>
      )}
      {expected && (
        <Link to="people" className="expected">
          <span className="expected-main">
            <strong>{expected.length}</strong>
            <span>expected attendees</span>
          </span>
          <span className="expected-side">
            <span className="field-hint">
              {expected.filter((r) => r.kind === 'youth').length} youth, {expected.filter((r) => r.kind === 'adult').length} adults
            </span>
            <Icon name="chevron" />
          </span>
        </Link>
      )}
      {event.features.selfSignup && can('activities.manage') && event.status !== 'draft' && (
        <Link to="activities/signup" className="expected">
          <span className="expected-main">
            <Icon name="qr" size={22} />
            <strong className="expected-title">Activity sign-up screen and posters</strong>
          </span>
          <Icon name="chevron" />
        </Link>
      )}
    </>
  );
}
