import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { Field, Loading, Notice } from '../components/ui';
import { LinkShare } from '../components/LinkShare';
import { useSession } from '../session';
import { useApi } from '../useApi';
import { matchesSearch } from '../../shared/search';
import { minutesAgo } from './Live';

interface UserRow {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'disabled';
  platformAdmin: boolean;
  verified: boolean;
  isDemo: boolean;
  hasPassword: boolean;
  events: number;
  lastSeen: string | null;
}

export function AdminUsers() {
  const { me } = useSession();
  const users = useApi<{ users: UserRow[] }>('/admin/users');
  const [form, setForm] = useState({ email: '', displayName: '', platformAdmin: false, sendEmail: true });
  const [shared, setShared] = useState<{ userId: string; link: string; expiresAt: string; label: string } | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const myId = me?.kind === 'user' ? me.user.id : null;

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      const text = typeof result === 'string' ? result : success;
      if (text) setMessage({ tone: 'ok', text });
      await users.reload();
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  }

  function create(e: FormEvent) {
    e.preventDefault();
    const name = form.displayName;
    void act(async () => {
      const res = await api<{ id: string; link: string; expiresAt: string; emailed: boolean }>('/admin/users', { body: form });
      setForm({ email: '', displayName: '', platformAdmin: false, sendEmail: true });
      setShared({ userId: res.id, link: res.link, expiresAt: res.expiresAt, label: `Set-up link for ${name}` });
      setOpen(null);
      return res.emailed
        ? `Added ${name}. We've emailed them a link to set their password. You can also copy it below.`
        : `Added ${name}. Send them the set-up link below so they can choose a password.`;
    }, '');
  }

  function passwordLink(u: UserRow, sendEmail: boolean) {
    void act(async () => {
      const res = await api<{ link: string; expiresAt: string; purpose: 'setup' | 'reset'; emailed: boolean }>(`/admin/users/${u.id}/password-link`, {
        body: { sendEmail },
      });
      if (sendEmail) {
        setShared(null);
        if (!res.emailed) throw new ApiFailure(503, 'email_unavailable', 'The email could not be sent. Copy the link and send it to them yourself.');
        return `Emailed ${u.displayName} a link to ${res.purpose === 'reset' ? 'reset' : 'set'} their password.`;
      }
      setShared({ userId: u.id, link: res.link, expiresAt: res.expiresAt, label: `${res.purpose === 'reset' ? 'Reset' : 'Set-up'} link for ${u.displayName}` });
      return null;
    }, '');
  }

  const list = (users.data?.users ?? []).filter((u) => matchesSearch(query, u.displayName, u.email));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p className="lede flush">Everyone with a CampCount account. People can also sign themselves up.</p>
        </div>
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="field">
        <label htmlFor="people-q" className="visually-hidden">
          Search people
        </label>
        <input id="people-q" className="input" type="search" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {users.loading && !users.data && <Loading />}
      {users.error && <Notice tone="stop">{users.error.message}</Notice>}
      <ul className="people-list">
        {list.map((u) => {
          const isMe = u.id === myId;
          const expanded = open === u.id;
          return (
            <li key={u.id} className={u.status === 'disabled' ? 'is-muted' : undefined}>
              <button type="button" className="people-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : u.id)}>
                <span className="people-main">
                  <strong>
                    {u.displayName}
                    {isMe && ' (you)'}
                  </strong>
                  <span>{u.email}</span>
                </span>
                <span className="people-tags">
                  {u.platformAdmin && <span className="tag tag-admin">Admin</span>}
                  {u.isDemo && <span className="tag">Demo</span>}
                  {!u.hasPassword && !u.isDemo && u.status === 'active' && <span className="tag tag-warn">No password</span>}
                  {u.hasPassword && !u.verified && !u.isDemo && <span className="tag">Not confirmed</span>}
                  {u.status === 'disabled' && <span className="tag tag-stop">Disabled</span>}
                </span>
              </button>
              {expanded && (
                <div className="people-detail">
                  <p className="field-hint">
                    {u.events === 0 ? 'Not on any events' : `On ${u.events} event${u.events === 1 ? '' : 's'}`}
                    {u.lastSeen ? `, last active ${minutesAgo(u.lastSeen)}` : ', never signed in'}
                  </p>
                  <div className="actions flush">
                    {!u.isDemo && u.status === 'active' && (
                      <button className="btn btn-small" disabled={busy} onClick={() => passwordLink(u, false)}>
                        {u.hasPassword ? 'Reset password' : 'Set-up link'}
                      </button>
                    )}
                    <button
                      className="btn btn-secondary btn-small"
                      disabled={busy}
                      onClick={() => {
                        const name = window.prompt('New name', u.displayName);
                        if (name && name.trim() && name.trim() !== u.displayName) {
                          void act(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { displayName: name.trim() } }), `Renamed to ${name.trim()}.`);
                        }
                      }}
                    >
                      Rename
                    </button>
                    {!isMe && (
                      <button
                        className="btn btn-secondary btn-small"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { platformAdmin: !u.platformAdmin } }),
                            u.platformAdmin ? `${u.displayName} is no longer an admin.` : `${u.displayName} is now an admin.`,
                          )
                        }
                      >
                        {u.platformAdmin ? 'Remove admin' : 'Make admin'}
                      </button>
                    )}
                    {!isMe && (
                      <button
                        className="btn btn-secondary btn-small"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () => api(`/admin/users/${u.id}/status`, { body: { status: u.status === 'active' ? 'disabled' : 'active' } }),
                            u.status === 'active' ? `Disabled ${u.displayName}. They've been signed out.` : `Enabled ${u.displayName}.`,
                          )
                        }
                      >
                        {u.status === 'active' ? 'Disable' : 'Enable'}
                      </button>
                    )}
                    {!isMe && (
                      <button
                        className="btn btn-danger btn-small"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`Delete ${u.displayName}'s account? This can't be undone.`)) return;
                          void act(async () => {
                            const res = await api<{ result: string }>(`/admin/users/${u.id}`, { method: 'DELETE' });
                            if (res.result === 'anonymised') {
                              setMessage({ tone: 'ok', text: `${u.displayName}'s account was removed. Their name was wiped from past records.` });
                            }
                          }, `Deleted ${u.displayName}.`);
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  {shared?.userId === u.id && (
                    <LinkShare link={shared.link} expiresAt={shared.expiresAt} label={shared.label} emailBusy={busy} onEmail={() => passwordLink(u, true)} />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {shared && !list.some((u) => u.id === shared.userId && open === u.id) && (
        <div className="narrow section-gap-sm">
          <LinkShare link={shared.link} expiresAt={shared.expiresAt} label={shared.label} />
        </div>
      )}

      <details className="section-gap narrow">
        <summary>Add someone yourself</summary>
        <form onSubmit={create} noValidate>
          <p className="field-hint">Usually people sign up themselves, or an event manager adds them from their event's Staff page. New accounts set their own password from a one-time link.</p>
          <Field id="u-name" label="Name">
            <input id="u-name" className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </Field>
          <Field id="u-email" label="Email address">
            <input id="u-email" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={form.platformAdmin} onChange={(e) => setForm({ ...form, platformAdmin: e.target.checked })} />
            <div>
              <strong>Admin</strong>
              <span>Can create events, manage everyone's accounts, use View as and read the audit log.</span>
            </div>
          </label>
          <label className="check">
            <input type="checkbox" checked={form.sendEmail} onChange={(e) => setForm({ ...form, sendEmail: e.target.checked })} />
            <div>
              <strong>Email them a set-up link</strong>
              <span>They choose their own password from the link. You'll also get the link to copy.</span>
            </div>
          </label>
          <div className="actions">
            <button className="btn" disabled={busy || !form.email || !form.displayName}>
              Add person
            </button>
          </div>
        </form>
      </details>
    </>
  );
}
