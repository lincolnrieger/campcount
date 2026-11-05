import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { canScan } from '../scan/targets';
import { useApi } from '../useApi';
import type { Registration } from './Roster';
import type { Activity } from './Activities';
import { Loading, Notice, PageHeader, Skeleton } from '../components/ui';
import { StatusActions } from './Settings';
import { useEvent } from './EventLayout';
import { dayInZone, dayLabel, eventDays, timeInZone, todayInZone } from '../../shared/time';

interface Step {
  key: string;
  label: string;
  hint: string;
  to: string;
  done: boolean;
}

interface LiveSummary {
  contexts: { key: string; type: string; presentNow: number; trackSignOut: boolean; people: number; expected: number | null; name: string; status: string }[];
  openItems: number;
}

/**
 * The event's home. Key figures first, then what's on today (or, for a draft,
 * what's left to set up), then shortcuts to the tasks people do most.
 */
export function EventOverview() {
  const { event, can } = useEvent();
  const tz = event.timezone;
  const draft = event.status === 'draft' && can('event.configure');
  const roster = useApi<{ registrations: Registration[] }>(can('roster.view') ? `/events/${event.id}/registrations` : null);
  const live = useApi<LiveSummary>(can('reports.view') && event.status === 'open' ? `/events/${event.id}/live` : null);
  const showsActivities = event.features.activities && (can('activities.manage') || can('activity.view_roster'));
  const activities = useApi<{ activities: Activity[] }>(showsActivities ? `/events/${event.id}/activities` : null);
  const staff = useApi<{ staff: unknown[] }>(draft && can('staff.manage') ? `/events/${event.id}/staff` : null);
  const meals = useApi<{ meals: unknown[] }>(draft && event.features.meals && can('meals.manage') ? `/events/${event.id}/meals` : null);

  const expected = roster.data?.registrations.filter((r) => r.status === 'active') ?? null;
  const ctx = live.data?.contexts ?? [];
  const onSite = event.features.site ? ctx.find((c) => c.type === 'site')?.presentNow : undefined;
  const atActivities = ctx.filter((c) => c.type === 'activity' && c.trackSignOut).reduce((n, c) => n + c.presentNow, 0);
  const presentAt = new Map(ctx.map((c) => [c.key, c.presentNow]));

  const days = eventDays(event.startsOn, event.endsOn);
  const today = todayInZone(tz);
  const programmeDay = days.includes(today) ? today : today < event.startsOn ? (days[0] ?? today) : null;
  const programme = (activities.data?.activities ?? [])
    .filter((a) => a.status === 'active' && (!a.startsAt || dayInZone(a.startsAt, tz) === programmeDay))
    .sort((x, y) => (x.startsAt ?? '').localeCompare(y.startsAt ?? '') || x.name.localeCompare(y.name));

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

  const shortcuts = [
    can('roster.edit') && { to: 'people/add', label: 'Add a person' },
    can('roster.import') && { to: 'people/import', label: 'Import from MyScout' },
    can('credentials.manage') && { to: 'people/lanyards', label: 'Print lanyards' },
    event.features.selfSignup && can('activities.manage') && { to: 'activities/signup', label: 'Activity sign-up screen' },
    can('reports.view') && event.status !== 'draft' && { to: 'reports', label: 'Downloads and close-out' },
    can('staff.manage') && { to: 'settings/staff', label: 'Staff' },
    can('event.configure') && { to: 'settings', label: 'Event settings' },
  ].filter((s): s is { to: string; label: string } => Boolean(s));

  const scanLink = canScan(event) ? `/scan?event=${event.id}` : null;

  return (
    <>
      <PageHeader
        title="Overview"
        titleOn="desktop"
        actions={
          scanLink && (
            <Link to={scanLink} className="btn hide-sm">
              <Icon name="scan" size={18} /> Start scanning
            </Link>
          )
        }
      />
      {scanLink && (
        <Link to={scanLink} className="scan-cta show-sm">
          <Icon name="scan" size={24} />
          <span>
            <strong>Start scanning</strong>
            <span>Gate, meals and activities</span>
          </span>
          <Icon name="chevron" />
        </Link>
      )}
      {event.description && <p className="event-notes">{event.description}</p>}
      {!can('event.configure') && can('staff.manage') && (
        <Notice title="You can manage staff for this event">
          <p>To see participant details, add yourself as an event manager in Settings › Staff, or use View as. Both are recorded in the activity log.</p>
        </Notice>
      )}

      {(expected || live.data) && (
        <ul className="kpis" aria-label="Key figures">
          {expected && (
            <li>
              <Link to="people" className="kpi">
                <span className="kpi-label">Expected attendees</span>
                <span className="kpi-value">{expected.length}</span>
                <span className="kpi-note">
                  {expected.filter((r) => r.kind === 'youth').length} youth, {expected.filter((r) => r.kind === 'adult').length} adults
                </span>
              </Link>
            </li>
          )}
          {live.data && onSite !== undefined && (
            <li>
              <Link to="live" className="kpi">
                <span className="kpi-label">On site now</span>
                <span className="kpi-value">{onSite}</span>
                <span className="kpi-note">{expected ? `of ${expected.length} expected` : 'From gate scans'}</span>
              </Link>
            </li>
          )}
          {live.data && (
            <li>
              <Link to="live" className="kpi">
                <span className="kpi-label">At activities now</span>
                <span className="kpi-value">{atActivities}</span>
                <span className="kpi-note">Signed in and not yet out</span>
              </Link>
            </li>
          )}
          {live.data && (
            <li>
              <Link to="reports" className={live.data.openItems > 0 ? 'kpi kpi-warn' : 'kpi'}>
                <span className="kpi-label">Scans to check</span>
                <span className="kpi-value">{live.data.openItems}</span>
                <span className="kpi-note">{live.data.openItems ? 'Unknown cards or missing sign-ins' : 'Nothing to sort out'}</span>
              </Link>
            </li>
          )}
        </ul>
      )}
      {roster.loading && !roster.data && (
        <Loading label="Loading figures">
          <Skeleton width="100%" height="84px" radius="var(--radius)" className="skeleton-gap-lg" />
        </Loading>
      )}

      <div className={draft || (showsActivities && programmeDay) ? 'split' : 'narrow'}>
        <div>
          {draft && (
            <section aria-labelledby="setup-heading" className="section">
              <div className="section-head">
                <h2 id="setup-heading">Get ready</h2>
              </div>
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
                      <Icon name="chevron" size={18} />
                    </Link>
                  </li>
                ))}
              </ol>
              <p className="field-hint">Nobody can scan until the event is open. You can keep changing things afterwards.</p>
              <StatusActions only={['open']} />
            </section>
          )}

          {showsActivities && programmeDay && (
            <section aria-labelledby="programme-heading" className="section">
              <div className="section-head">
                <h2 id="programme-heading">{programmeDay === today ? "Today's programme" : `Programme: ${dayLabel(programmeDay, 'long')}`}</h2>
                <Link to="activities" className="btn-link">
                  All activities
                </Link>
              </div>
              {activities.loading && !activities.data ? (
                <Loading label="Loading the programme">
                  <Skeleton width="100%" height="9rem" radius="var(--radius)" />
                </Loading>
              ) : programme.length === 0 ? (
                <div className="empty">
                  <p className="flush">Nothing on the programme for this day.</p>
                </div>
              ) : (
                <ul className="programme">
                  {programme.map((a) => {
                    const here = presentAt.get(`activity:${a.id}`);
                    return (
                      <li key={a.id}>
                        <time dateTime={a.startsAt ?? undefined}>
                          {a.startsAt ? `${timeInZone(a.startsAt, tz)}${a.endsAt ? `–${timeInZone(a.endsAt, tz)}` : ''}` : 'All day'}
                        </time>
                        <span>
                          <Link to={`activities/${a.id}`}>{a.name}</Link>
                          {a.location && <span className="cell-sub">{a.location}</span>}
                        </span>
                        <span className="meta">
                          {here !== undefined && a.trackSignOut ? `${here} here` : a.booked ? `${a.booked} booked` : ''}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>

        {shortcuts.length > 0 && (
          <aside aria-labelledby="shortcuts-heading" className="section">
            <div className="section-head">
              <h2 id="shortcuts-heading">Shortcuts</h2>
            </div>
            <ul className="list">
              {shortcuts.map((s) => (
                <li key={s.to}>
                  <Link to={s.to} className="list-row">
                    <span className="list-main">{s.label}</span>
                    <Icon name="chevron" size={18} />
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
    </>
  );
}
