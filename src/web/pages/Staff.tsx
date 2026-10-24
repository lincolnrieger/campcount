import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { Field, Loading, Notice } from '../components/ui';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import type { Activity } from './Activities';

interface StaffRow {
  assignmentId: string;
  user: { id: string; email: string; displayName: string; status: string };
  role: { key: string; name: string };
  activity: { id: string; name: string } | null;
}
interface Role {
  key: string;
  name: string;
  description: string;
  scope: 'event' | 'activity';
}

export function Staff() {
  const { event } = useEvent();
  const staff = useApi<{ staff: StaffRow[] }>(`/events/${event.id}/staff`);
  const roles = useApi<{ roles: Role[] }>('/me/roles');
  const activities = useApi<{ activities: Activity[] }>(`/events/${event.id}/activities`);
  const [form, setForm] = useState({ email: '', displayName: '', roleKey: 'scanner', activityId: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedRole = roles.data?.roles.find((r) => r.key === form.roleKey);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setErrors({});
    try {
      await api(`/events/${event.id}/staff`, {
        body: {
          email: form.email,
          roleKey: form.roleKey,
          ...(form.displayName ? { displayName: form.displayName } : {}),
          ...(selectedRole?.scope === 'activity' && form.activityId ? { activityId: form.activityId } : {}),
        },
      });
      setMessage({ tone: 'ok', text: `Added ${form.email} as ${selectedRole?.name ?? form.roleKey}.` });
      setForm({ ...form, email: '', displayName: '' });
      await staff.reload();
    } catch (err) {
      if (err instanceof ApiFailure) {
        setErrors(err.fieldErrors());
        setMessage({ tone: 'stop', text: err.message });
      }
    } finally {
      setBusy(false);
    }
  }

  const roleOptions = (roles.data?.roles ?? []).flatMap((r) =>
    r.scope === 'activity'
      ? [
          { value: `${r.key}|`, label: `${r.name}: all activities` },
          ...(activities.data?.activities ?? []).map((a) => ({ value: `${r.key}|${a.id}`, label: `${r.name}: ${a.name}` })),
        ]
      : [{ value: `${r.key}|`, label: r.name }],
  );

  async function changeRole(row: StaffRow, value: string) {
    const [roleKey, activityId] = value.split('|');
    try {
      await api(`/events/${event.id}/staff/${row.assignmentId}`, {
        method: 'PATCH',
        body: { roleKey, activityId: activityId || null },
      });
      setMessage({ tone: 'ok', text: `${row.user.displayName} is now ${roleOptions.find((o) => o.value === value)?.label ?? roleKey}.` });
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    }
    await staff.reload();
  }

  async function remove(row: StaffRow) {
    if (!window.confirm(`Remove ${row.user.displayName} as ${row.role.name}? They lose access straight away.`)) return;
    try {
      await api(`/events/${event.id}/staff/${row.assignmentId}`, { method: 'DELETE' });
      setMessage({ tone: 'ok', text: `Removed ${row.user.displayName} as ${row.role.name}.` });
      await staff.reload();
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    }
  }

  return (
    <>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <h2>People on this event</h2>
      {staff.loading && !staff.data && <Loading />}
      {staff.error && <Notice tone="stop">{staff.error.message}</Notice>}
      {staff.data && staff.data.staff.length === 0 && (
        <div className="empty">
          <p>
            <strong>No one is assigned yet.</strong>
          </p>
          <p className="lede">Add an event manager first. They can bring in the rest of the crew.</p>
        </div>
      )}
      {staff.data && staff.data.staff.length > 0 && (
        <div className="sheet-wrap">
          <table className="sheet sheet-stack">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {staff.data.staff.map((row) => (
                <tr key={row.assignmentId}>
                  <td>
                    <strong>{row.user.displayName}</strong>
                    <div className="field-hint">{row.user.email}</div>
                  </td>
                  <td data-label="Role">
                    <label className="visually-hidden" htmlFor={`role-${row.assignmentId}`}>
                      Role for {row.user.displayName}
                    </label>
                    <select
                      id={`role-${row.assignmentId}`}
                      className="input input-compact"
                      value={`${row.role.key}|${row.activity?.id ?? ''}`}
                      onChange={(e) => void changeRole(row, e.target.value)}
                    >
                      {roleOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <button className="btn-link" onClick={() => void remove(row)}>
                      Remove<span className="visually-hidden"> {row.user.displayName}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={add} noValidate className="narrow section-gap">
        <h2>Add someone</h2>
        <p className="lede">They sign in with this email address. If they're new to CampCount, an account is created for them.</p>
        <Field id="staff-email" label="Email address" hint="Their Scouts SA email is best." error={errors.email}>
          <input
            id="staff-email"
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </Field>
        <Field id="staff-name" label="Name" hint="Only needed if they don't have an account yet.">
          <input
            id="staff-name"
            className="input"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </Field>
        <fieldset className="fieldset-plain">
          <legend className="field-legend">What will they do?</legend>
          <div className="role-pick">
            {roles.data?.roles.map((r) => (
              <label key={r.key} className={form.roleKey === r.key ? 'role-option is-on' : 'role-option'}>
                <input type="radio" name="staff-role" value={r.key} checked={form.roleKey === r.key} onChange={() => setForm({ ...form, roleKey: r.key })} />
                <strong>{r.name}</strong>
                <span>{r.description}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {selectedRole?.scope === 'activity' && (
          <Field id="staff-activity" label="Activity" hint="Leaders only see and scan the activity you choose.">
            <select
              id="staff-activity"
              className="input"
              value={form.activityId}
              onChange={(e) => setForm({ ...form, activityId: e.target.value })}
            >
              <option value="">All activities</option>
              {activities.data?.activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <button className="btn" disabled={busy || !form.email}>
          {busy ? 'Adding…' : 'Add to event'}
        </button>
      </form>
    </>
  );
}
