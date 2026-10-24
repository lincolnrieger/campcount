import { useState } from 'react';
import { ApiFailure, api } from '../api';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import { canScan } from '../scan/targets';
import { useApi } from '../useApi';
import type { Registration } from './Roster';
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
  const roster = useApi<{ registrations: Registration[] }>(can('roster.view') ? `/events/${event.id}/registrations` : null);
  const expected = roster.data?.registrations.filter((r) => r.status === 'active') ?? null;

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
      {expected && (
        <Link to="roster" className="expected">
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
      {(can('activities.manage') || can('credentials.manage')) && (
        <Link to="qr-codes" className="expected">
          <span className="expected-main">
            <Icon name="qr" size={22} />
            <span>
              <strong className="expected-title">QR codes and posters</strong>
              <span className="field-hint">Lanyards, the activity sign-up screen and session posters</span>
            </span>
          </span>
          <Icon name="chevron" />
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
