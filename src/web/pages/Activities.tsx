import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { Field, Loading, Notice } from '../components/ui';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';

export interface Activity {
  id: string;
  name: string;
  description: string;
  location: string;
  instructions: string;
  startsAt: string | null;
  endsAt: string | null;
  capacity: number | null;
  capacityPolicy: 'warn' | 'block';
  trackSignOut: boolean;
  allowRepeat: boolean;
  bookingRequired: boolean;
  status: 'active' | 'cancelled';
}

const EMPTY = { name: '', location: '', instructions: '', capacity: '', capacityPolicy: 'warn', trackSignOut: true, allowRepeat: true };

function ActivityForm({ initial, onSave, onCancel }: { initial?: Activity; onSave: (body: object) => Promise<void>; onCancel?: () => void }) {
  const [form, setForm] = useState(
    initial
      ? { ...EMPTY, ...initial, capacity: initial.capacity ? String(initial.capacity) : '' }
      : EMPTY,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = initial?.id ?? 'new';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      await onSave({
        name: form.name,
        location: form.location,
        instructions: form.instructions,
        capacity: form.capacity ? Number(form.capacity) : null,
        capacityPolicy: form.capacityPolicy,
        trackSignOut: form.trackSignOut,
        allowRepeat: form.allowRepeat,
      });
      if (!initial) setForm(EMPTY);
    } catch (err) {
      if (err instanceof ApiFailure) {
        setErrors(err.fieldErrors());
        setFailure(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="narrow">
      {failure && <Notice tone="stop">{failure}</Notice>}
      <Field id={`${id}-name`} label="Activity name" error={errors.name}>
        <input id={`${id}-name`} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <div className="row">
        <Field id={`${id}-loc`} label="Location">
          <input id={`${id}-loc`} className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
        <Field id={`${id}-cap`} label="Capacity" hint="Leave blank for no limit">
          <input
            id={`${id}-cap`}
            className="input"
            inputMode="numeric"
            value={form.capacity}
            onChange={(e) => setForm({ ...form, capacity: e.target.value.replace(/\D/g, '') })}
          />
        </Field>
      </div>
      <Field id={`${id}-ins`} label="Instructions for leaders" hint="Shown on the activity's scanning screen.">
        <textarea id={`${id}-ins`} className="input" rows={2} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={form.trackSignOut} onChange={(e) => setForm({ ...form, trackSignOut: e.target.checked })} />
        <div>
          <strong>Sign people out as well as in</strong>
          <span>Shows who is at the activity right now. Needed for capacity limits.</span>
        </div>
      </label>
      <label className="check">
        <input type="checkbox" checked={form.allowRepeat} onChange={(e) => setForm({ ...form, allowRepeat: e.target.checked })} />
        <div>
          <strong>Allow people to do it more than once</strong>
          <span>If off, a second visit is flagged as already done.</span>
        </div>
      </label>
      {form.capacity && (
        <label className="check">
          <input
            type="checkbox"
            checked={form.capacityPolicy === 'block'}
            onChange={(e) => setForm({ ...form, capacityPolicy: e.target.checked ? 'block' : 'warn' })}
          />
          <div>
            <strong>Refuse sign-ins when full</strong>
            <span>If off, the leader sees a warning but the sign-in is still recorded.</span>
          </div>
        </label>
      )}
      <div className="actions">
        <button className="btn" disabled={busy || !form.name.trim()}>
          {initial ? 'Save activity' : 'Add activity'}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export function Activities() {
  const { event, can } = useEvent();
  const { data, error, loading, reload } = useApi<{ activities: Activity[] }>(`/events/${event.id}/activities`);
  const [editing, setEditing] = useState<string | null>(null);
  const manage = can('activities.manage') && (event.status === 'draft' || event.status === 'open');

  if (loading && !data) return <Loading />;
  if (error) return <Notice tone="stop">{error.message}</Notice>;
  const activities = data?.activities ?? [];

  return (
    <>
      {activities.length === 0 ? (
        <div className="empty">
          <p>
            <strong>No activities yet.</strong>
          </p>
          <p className="lede">Add each activity station, then assign leaders to it from the Staff page.</p>
        </div>
      ) : (
        <div className="sheet-wrap">
          <table className="sheet sheet-stack">
            <thead>
              <tr>
                <th scope="col">Activity</th>
                <th scope="col">Rules</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a) =>
                editing === a.id ? (
                  <tr key={a.id}>
                    <td colSpan={3}>
                      <ActivityForm
                        initial={a}
                        onCancel={() => setEditing(null)}
                        onSave={async (body) => {
                          await api(`/events/${event.id}/activities/${a.id}`, { method: 'PATCH', body });
                          setEditing(null);
                          await reload();
                        }}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={a.id} className={a.status === 'cancelled' ? 'is-muted' : undefined}>
                    <td>
                      <strong>{a.name}</strong>
                      {a.location && <div className="field-hint">{a.location}</div>}
                      {a.status === 'cancelled' && <div className="field-hint">Cancelled</div>}
                    </td>
                    <td data-label="Rules">
                      {[
                        a.trackSignOut ? 'In and out' : 'Sign-in only',
                        a.capacity ? `${a.capacityPolicy === 'block' ? 'Max' : 'Aim for'} ${a.capacity}` : null,
                        a.allowRepeat ? null : 'Once each',
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </td>
                    <td className="num">
                      {manage && (
                        <>
                          <button className="btn-link" onClick={() => setEditing(a.id)}>
                            Edit<span className="visually-hidden"> {a.name}</span>
                          </button>{' '}
                          <button
                            className="btn-link"
                            onClick={async () => {
                              await api(`/events/${event.id}/activities/${a.id}`, {
                                method: 'PATCH',
                                body: { status: a.status === 'active' ? 'cancelled' : 'active' },
                              });
                              await reload();
                            }}
                          >
                            {a.status === 'active' ? 'Cancel' : 'Restore'}
                            <span className="visually-hidden"> {a.name}</span>
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {manage && (
        <section className="section-gap">
          <h2>Add an activity</h2>
          <ActivityForm
            onSave={async (body) => {
              await api(`/events/${event.id}/activities`, { body });
              await reload();
            }}
          />
        </section>
      )}
    </>
  );
}
