import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { canScan } from '../scan/targets';
import { useApi } from '../useApi';
import type { Registration } from './Roster';
import { Notice, PageHeader } from '../components/ui';
import { LiveBoard } from './Live';
import { StatusActions } from './Settings';
import { useEvent } from './EventLayout';

interface Step {
  key: string;
  label: string;
  hint: string;
  to: string;
  done: boolean;
}

/**
 * The event dashboard. During camp it's where everyone is (with one-tap
 * arrivals); for a draft it's what's left to set up; for staff who only
 * scan, it's the way into the scanner.
 */
export function EventOverview() {
  const { event, can } = useEvent();
  const draft = event.status === 'draft';
  const setup = draft && can('event.configure');
  const roster = useApi<{ registrations: Registration[] }>(setup && can('roster.view') ? `/events/${event.id}/registrations` : null);
  const activities = useApi<{ activities: unknown[] }>(setup && event.features.activities ? `/events/${event.id}/activities` : null);
  const staff = useApi<{ staff: unknown[] }>(setup && can('staff.manage') ? `/events/${event.id}/staff` : null);
  const meals = useApi<{ meals: unknown[] }>(setup && event.features.meals && can('meals.manage') ? `/events/${event.id}/meals` : null);
  const expected = roster.data?.registrations.filter((r) => r.status === 'active') ?? null;

  const steps: Step[] = setup
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
  const scanLink = canScan(event) ? `/scan?event=${event.id}` : null;
  const board = !draft && can('reports.view');

  return (
    <>
      <PageHeader
        title="Dashboard"
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

      {setup && (
        <section aria-labelledby="setup-heading" className="section narrow">
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
                  <Icon name="chevron" size={18} />
                </Link>
              </li>
            ))}
          </ol>
          <p className="field-hint">Nobody can scan until the event is open. You can keep changing things afterwards.</p>
          <StatusActions only={['open']} />
        </section>
      )}
      {draft && !setup && (
        <Notice title="This event hasn't opened yet">
          <p>Scanning starts when an event manager opens it.</p>
        </Notice>
      )}

      {board && <LiveBoard />}

      {!board && !draft && !scanLink && (
        <div className="empty">
          <p className="flush">
            {event.features.activities && can('activity.view_roster') ? (
              <>
                Your activities are on the <Link to="activities">Activities</Link> tab.
              </>
            ) : (
              'There is nothing for your role to do here yet.'
            )}
          </p>
        </div>
      )}
    </>
  );
}
