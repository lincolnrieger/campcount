import { useEffect, useRef, useState } from 'react';
import { ApiFailure, api } from '../api';
import { clearDevice } from '../offline/db';
import { useSession } from '../session';
import { Icon } from './Icon';
import { Notice } from './ui';

interface Options {
  events: { id: string; name: string; isDemo: boolean; status: string; activities: { id: string; name: string }[] }[];
  roles: { key: string; name: string; description: string; scope: 'event' | 'activity' }[];
}

/** Start viewing an event as a role. Rosters cached for the old view are wiped first. */
export async function startPreview(eventId: string, roleKey: string, activityId: string | null) {
  await clearDevice(true).catch(() => undefined);
  await api('/admin/preview', { body: { eventId, roleKey, activityId } });
}

export async function stopPreview() {
  await clearDevice(true).catch(() => undefined);
  await api('/admin/preview', { method: 'DELETE' });
}

/** Bottom sheet (phones) / dialog (desktop) for choosing an event and role to view as. */
export function ViewAsSheet({ open, onClose, initialEventId }: { open: boolean; onClose: () => void; initialEventId?: string }) {
  const { me } = useSession();
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [eventId, setEventId] = useState(initialEventId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = me?.kind === 'user' ? me.preview : null;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      api<Options>('/admin/preview/options')
        .then((o) => {
          setOptions(o);
          setEventId((id) => id || current?.eventId || initialEventId || o.events[0]?.id || '');
        })
        .catch((err) => setError(err instanceof ApiFailure ? err.message : 'Could not load events.'));
    }
    if (!open && d.open) d.close();
  }, [open, current?.eventId, initialEventId]);

  const event = options?.events.find((e) => e.id === eventId);

  async function choose(roleKey: string, activityId: string | null) {
    setBusy(true);
    setError(null);
    try {
      await startPreview(eventId, roleKey, activityId);
      // Full reload so nothing loaded under the previous role lingers on screen.
      window.location.assign(`/events/${eventId}`);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function backToMe() {
    setBusy(true);
    try {
      await stopPreview();
      window.location.assign('/');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} className="sheet-dialog" onClose={onClose} aria-labelledby="viewas-title">
      <div className="sheet-head">
        <h2 id="viewas-title">View as</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>
      </div>
      <p className="field-hint">See exactly what each role sees. Nothing changes for anyone else.</p>
      {error && <Notice tone="stop">{error}</Notice>}
      {current && (
        <button type="button" className="btn btn-block section-gap-sm" disabled={busy} onClick={() => void backToMe()}>
          Back to me
        </button>
      )}
      {options && (
        <>
          <div className="field section-gap-sm">
            <label htmlFor="viewas-event">Event</label>
            <select id="viewas-event" className="input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {options.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.isDemo ? ' (demo)' : ''}
                </option>
              ))}
            </select>
          </div>
          <ul className="role-list">
            {options.roles.map((r) =>
              r.scope === 'activity' && event && event.activities.length > 0 ? (
                <li key={r.key} className="role-group">
                  <p>
                    <strong>{r.name}</strong>
                    <span>Choose an activity</span>
                  </p>
                  <div className="role-chips">
                    {event.activities.map((a) => {
                      const isCurrent = current?.eventId === eventId && current.roleKey === r.key && current.activityId === a.id;
                      return (
                        <button
                          key={a.id}
                          type="button"
                          className={isCurrent ? 'role-chip is-current' : 'role-chip'}
                          aria-current={isCurrent || undefined}
                          disabled={busy}
                          onClick={() => void choose(r.key, a.id)}
                        >
                          {a.name}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ) : (
                <li key={r.key}>
                  <RoleButton
                    name={r.name}
                    detail={r.description}
                    current={current?.eventId === eventId && current.roleKey === r.key}
                    disabled={busy || !eventId}
                    onClick={() => void choose(r.key, null)}
                  />
                </li>
              ),
            )}
          </ul>
        </>
      )}
    </dialog>
  );
}

function RoleButton({ name, detail, current, disabled, onClick }: { name: string; detail: string; current: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className={current ? 'role-button is-current' : 'role-button'} disabled={disabled} onClick={onClick} aria-current={current || undefined}>
      <strong>{name}</strong>
      <span>{detail}</span>
    </button>
  );
}
