import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { Field, Loading, Notice } from '../components/ui';
import { useSession } from '../session';
import { useApi } from '../useApi';

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'disabled';
  platformAdmin: boolean;
}

export function AdminUsers() {
  const { me } = useSession();
  const users = useApi<{ users: UserRow[] }>('/admin/users');
  const [form, setForm] = useState({ email: '', displayName: '', platformAdmin: false });
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage({ tone: 'ok', text: success });
      await users.reload();
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    void act(async () => {
      await api('/admin/users', { body: form });
      setForm({ email: '', displayName: '', platformAdmin: false });
    }, `Created an account for ${form.email}.`);
  }

  return (
    <>
      <div className="page-head">
        <h1>People</h1>
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {users.loading && !users.data && <Loading />}
      {users.error && <Notice tone="stop">{users.error.message}</Notice>}
      {users.data && (
        <div className="sheet-wrap">
          <table className="sheet sheet-stack">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Access</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.data.users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.displayName}</strong>
                    <div className="field-hint">{u.email}</div>
                  </td>
                  <td data-label="Access">
                    {u.status === 'disabled' ? 'Disabled' : u.platformAdmin ? 'Platform administrator' : 'Event staff'}
                  </td>
                  <td className="num">
                    {me?.kind === 'user' && me.user.id !== u.id && (
                      <button
                        className="btn-link"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () => api(`/admin/users/${u.id}/status`, { body: { status: u.status === 'active' ? 'disabled' : 'active' } }),
                            u.status === 'active' ? `Disabled ${u.displayName}. They have been signed out.` : `Enabled ${u.displayName}.`,
                          )
                        }
                      >
                        {u.status === 'active' ? 'Disable' : 'Enable'}
                        <span className="visually-hidden"> {u.displayName}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form onSubmit={create} noValidate className="narrow section-gap">
        <h2>Add a person</h2>
        <p className="lede">Most people are added by a camp director from their event's Staff page. Use this for administrators.</p>
        <Field id="u-email" label="Email address">
          <input id="u-email" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field id="u-name" label="Name">
          <input id="u-name" className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={form.platformAdmin} onChange={(e) => setForm({ ...form, platformAdmin: e.target.checked })} />
          <div>
            <strong>Platform administrator</strong>
            <span>Can create events, manage accounts and read the audit log.</span>
          </div>
        </label>
        <div className="actions">
          <button className="btn" disabled={busy || !form.email || !form.displayName}>
            Add person
          </button>
        </div>
      </form>
    </>
  );
}
