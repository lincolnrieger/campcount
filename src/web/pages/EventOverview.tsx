import { useState } from 'react';
import { ApiFailure, api } from '../api';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { canScan } from '../scan/targets';
import { useApi } from '../useApi';
import type { RegistrationData } from './Registration';
import { Exports } from './CloseOut';
import { Notice } from '../components/ui';
import type { EventFeatures, EventStatus } from '../../shared/schemas';
import { EVENT_TRANSITIONS } from '../../shared/lifecycle';
import { FeatureChecklist } from './Events';
import { useEvent } from './EventLayout';

const TRANSITION_COPY: Partial<Record<EventStatus, { label: string; confirm: string; tone: 'btn' | 'btn btn-secondary' | 'btn btn-danger' }>> = {
  open: { label: 'Open event', confirm: 'Open this event? Assigned staff will be able to scan.', tone: 'btn' },
  completed: { label: 'Close event', confirm: 'Close this event? Scanning stops and settings are locked. You can reopen it for corrections.', tone: 'btn btn-secondary' },
  cancelled: { label: 'Cancel event', confirm: 'Cancel this event? Nobody will be able to scan.', tone: 'btn btn-danger' },
  draft: { label: 'Return to draft', confirm: 'Move this cancelled event back to draft?', tone: 'btn btn-secondary' },
  archived: { label: 'Archive', confirm: 'Archive this event? Event staff lose access. This cannot be undone.', tone: 'btn btn-danger' },
};

export function EventOverview() {
  const { event, can, reload } = useEvent();
  const [features, setFeatures] = useState<EventFeatures>(event.features);
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = can('event.configure') && (event.status === 'draft' || event.status === 'open');
  const dirty = JSON.stringify(features) !== JSON.stringify(event.features);
  const registration = useApi<RegistrationData>(can('roster.edit') ? `/events/${event.id}/registration` : null);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await reload();
      setMessage({ tone: 'ok', text: success });
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  const transitions = EVENT_TRANSITIONS[event.status].filter((to) => {
    if (to === 'archived') return false; // platform admins archive from the admin area
    if (event.status === 'draft' && to === 'open') return can('event.configure');
    return can('event.close');
  });

  return (
    <>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {event.status === 'draft' && (
        <Notice title="This event is a draft">
          <p>Set up staff and features, then open the event when you're ready for scanning.</p>
        </Notice>
      )}
      {!can('event.configure') && can('staff.manage') && (
        <Notice title="You can manage staff for this event">
          <p>
            To change settings or see participant details, use View as (the eye button) or add yourself as an event manager on the Staff page. Both are recorded in the audit log.
          </p>
        </Notice>
      )}
      {event.description && <p>{event.description}</p>}
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
      {registration.data && (
        <Link to="roster/registration" className="expected">
          <span className="expected-main">
            <strong>{registration.data.counts.registered}</strong>
            <span>
              expected attendees
              {registration.data.settings.limit ? ` of ${registration.data.settings.limit}` : ''}
            </span>
          </span>
          <span className="expected-side">
            {registration.data.counts.waiting > 0 ? (
              <span className="tag tag-warn">{registration.data.counts.waiting} waiting for approval</span>
            ) : (
              <span className="field-hint">{registration.data.settings.open ? 'Registration open' : 'Registration closed'}</span>
            )}
            <Icon name="chevron" />
          </span>
        </Link>
      )}
      {!can('reports.view') && <Exports />}

      {can('event.configure') && (
      <section aria-labelledby="features-heading" className="narrow">
        <h2 id="features-heading">Features</h2>
        <FeatureChecklist value={features} onChange={setFeatures} disabled={!editable || busy} />
        {editable && (
          <button
            className="btn"
            disabled={!dirty || busy}
            onClick={() => void run(() => api(`/events/${event.id}`, { method: 'PATCH', body: { features } }), 'Features saved.')}
          >
            Save features
          </button>
        )}
      </section>
      )}

      {transitions.length > 0 && (
        <section aria-labelledby="status-heading" className="narrow">
          <h2 id="status-heading" className="section-gap">Event status</h2>
          <div className="actions">
            {transitions.map((to) => {
              const copy = TRANSITION_COPY[to]!;
              return (
                <button
                  key={to}
                  className={copy.tone}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(copy.confirm)) {
                      void run(() => api(`/events/${event.id}/transition`, { body: { to } }), `Event is now ${to}.`);
                    }
                  }}
                >
                  {copy.label}
                </button>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
