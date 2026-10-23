import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { Field, Loading, Notice } from '../components/ui';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';

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
  const [form, setForm] = useState({ email: '', displayName: '', roleKey: 'activity_leader' });
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
        body: { email: form.email, roleKey: form.roleKey, ...(form.displayName ? { displayName: form.displayName } : {}) },
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
          <p className="lede">Start with a Camp Director. They can add the rest of the team.</p>
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
                    {row.role.name}
                    {row.activity && <div className="field-hint">{row.activity.name}</div>}
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
        <Field id="staff-role" label="Role" hint={selectedRole?.description}>
          <select
            id="staff-role"
            className="input"
            value={form.roleKey}
            onChange={(e) => setForm({ ...form, roleKey: e.target.value })}
          >
            {roles.data?.roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
        </Field>
        {selectedRole?.scope === 'activity' && (
          <p className="field-hint">This gives access to all activities. Limiting a leader to one activity comes with the Activities screen.</p>
        )}
        <button className="btn" disabled={busy || !form.email}>
          {busy ? 'Adding…' : 'Add to event'}
        </button>
      </form>
    </>
  );
}
