import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../api';
import { clearDevice } from '../offline/db';
import { useSession } from '../session';
import { Badge, Button, Loading, Notice, Sheet } from '../ui';

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

/** Pick an event, then a role (and an activity, for activity leaders), and see the app as they do. */
export function ViewAsForm({ initialEventId }: { initialEventId?: string }) {
  const { me } = useSession();
  const [options, setOptions] = useState<Options | null>(null);
  const [eventId, setEventId] = useState(initialEventId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = me?.kind === 'user' ? me.preview : null;

  useEffect(() => {
    api<Options>('/admin/preview/options')
      .then((o) => {
        setOptions(o);
        setEventId((id) => id || current?.eventId || initialEventId || o.events[0]?.id || '');
      })
      .catch((err) => setError(err instanceof ApiFailure ? err.message : "Couldn't load events. Check your signal and try again."));
  }, [current?.eventId, initialEventId]);

  const event = options?.events.find((e) => e.id === eventId);

  async function choose(roleKey: string, activityId: string | null) {
    setBusy(true);
    setError(null);
    try {
      await startPreview(eventId, roleKey, activityId);
      // Full reload so nothing loaded under the previous role lingers on screen.
      window.location.assign(`/events/${eventId}`);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong. Try again.');
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
    <div className="stack">
      {error && (
        <Notice tone="error">
          <p>{error}</p>
        </Notice>
      )}
      {current && (
        <div>
          <Button kind="primary" busy={busy} onClick={() => void backToMe()}>
            Stop viewing as
          </Button>
        </div>
      )}
      {!options && !error && <Loading what="events and roles" rows={4} />}
      {options && (
        <>
          <div className="field viewas-event">
            <label htmlFor="viewas-event" className="field-label">
              Event
            </label>
            <select id="viewas-event" className="select" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {options.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {e.isDemo ? ' (demo)' : ''}
                </option>
              ))}
            </select>
          </div>
          <ul className="list">
            {options.roles.map((r) => {
              const isCurrent = current?.eventId === eventId && current.roleKey === r.key;
              if (r.scope === 'activity' && event && event.activities.length > 0) {
                return (
                  <li key={r.key} className="row viewas-role">
                    <span className="row-main">
                      <span className="row-title">{r.name}</span>
                      <span className="row-meta">Choose an activity</span>
                      <span className="viewas-activities">
                        {event.activities.map((a) => {
                          const on = isCurrent && current?.activityId === a.id;
                          return (
                            <Button key={a.id} small kind={on ? 'primary' : 'secondary'} aria-current={on || undefined} disabled={busy} onClick={() => void choose(r.key, a.id)}>
                              {a.name}
                            </Button>
                          );
                        })}
                      </span>
                    </span>
                  </li>
                );
              }
              return (
                <li key={r.key}>
                  <button type="button" className="row row-button" aria-current={isCurrent || undefined} disabled={busy || !eventId} onClick={() => void choose(r.key, null)}>
                    <span className="row-main">
                      <span className="row-title">{r.name}</span>
                      <span className="row-meta">{r.description}</span>
                    </span>
                    {isCurrent && <Badge tone="brand">Viewing</Badge>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** The same choice in a sheet. */
export function ViewAsSheet({ open, onClose, initialEventId }: { open: boolean; onClose: () => void; initialEventId?: string }) {
  return (
    <Sheet open={open} title="View as a role" onClose={onClose}>
      {open && <ViewAsForm initialEventId={initialEventId} />}
    </Sheet>
  );
}

