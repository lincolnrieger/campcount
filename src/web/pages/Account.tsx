import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ApiFailure, api } from '../api';
import { Field, Notice } from '../components/ui';
import { useSession } from '../session';

export function SetPassword() {
  const { me, refresh } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const first = params.get('first') === '1';
  const hasPassword = me?.kind === 'user' && me.user.hasPassword;
  const [password, setPassword] = useState('');
  const [current, setCurrent] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password', { body: current ? { password, currentPassword: current } : { password } });
      await refresh();
      if (first) navigate('/', { replace: true });
      else setDone(true);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="narrow">
      <h1>{first ? 'Choose a password' : hasPassword ? 'Change password' : 'Set a password'}</h1>
      <p className="lede">
        {first
          ? "You're signed in. Choose a password so next time you can sign in without waiting for an email."
          : 'Changing your password signs you out on your other devices.'}
      </p>
      {done && <Notice tone="ok">Password saved.</Notice>}
      {error && <Notice tone="stop">{error}</Notice>}
      <input type="email" autoComplete="username" value={me?.kind === 'user' ? me.user.email : ''} readOnly hidden />
      {hasPassword && !first && (
        <Field id="current" label="Current password" hint="Forgotten it? Sign out, then use 'Email me a sign-in code'.">
          <input id="current" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
      )}
      <Field id="new-password" label="New password" hint="At least 10 characters. A short phrase is easy to remember and hard to guess.">
        <input
          id="new-password"
          className="input"
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <label className="check">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        <div>
          <strong>Show password</strong>
        </div>
      </label>
      <div className="actions">
        <button className="btn" disabled={busy || password.length < 10}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
        {first && (
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/', { replace: true })}>
            Not now
          </button>
        )}
      </div>
    </form>
  );
}

export function Account() {
  const { me, signOut, refresh } = useSession();
  const navigate = useNavigate();
  const [message, setMessage] = useState<{ tone: 'ok' | 'stop'; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');
  if (me?.kind !== 'user') return null;
  const isAdmin = me.platformPermissions.includes('platform.users.manage');

  async function rename() {
    const name = window.prompt('Your name', me?.kind === 'user' ? me.user.displayName : '');
    if (!name || !name.trim()) return;
    try {
      await api('/me', { method: 'PATCH', body: { displayName: name.trim() } });
      await refresh();
      setMessage({ tone: 'ok', text: 'Name updated.' });
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/me', { method: 'DELETE', body: password ? { password } : {} });
      await refresh();
      navigate('/sign-in', { replace: true });
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    }
  }

  return (
    <div className="narrow">
      <h1>Your account</h1>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <ul className="settings-list">
        <li>
          <span>
            <strong>Name</strong>
            <span>{me.user.displayName}</span>
          </span>
          <button className="btn-link" onClick={() => void rename()}>
            Change
          </button>
        </li>
        <li>
          <span>
            <strong>Email</strong>
            <span>{me.user.email}</span>
          </span>
        </li>
        {!me.user.isDemo && (
          <li>
            <span>
              <strong>Password</strong>
              <span>{me.user.hasPassword ? 'Set' : 'Not set yet'}</span>
            </span>
            <button className="btn-link" onClick={() => navigate('/account/password')}>
              {me.user.hasPassword ? 'Change' : 'Set one'}
            </button>
          </li>
        )}
        {isAdmin && (
          <li>
            <span>
              <strong>Admin</strong>
              <span>People, demo mode and View as</span>
            </span>
            <button className="btn-link" onClick={() => navigate('/admin')}>
              Open
            </button>
          </li>
        )}
      </ul>
      <div className="actions">
        <button className="btn btn-secondary btn-block" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>

      <details className="section-gap" open={deleting} onToggle={(e) => setDeleting((e.target as HTMLDetailsElement).open)}>
        <summary>Delete my account</summary>
        <form onSubmit={deleteAccount} noValidate>
          <p className="field-hint">
            Your account and access are removed. Records of scans you made stay, but no longer show your name. This can't be undone.
          </p>
          {me.user.hasPassword && (
            <Field id="delete-pw" label="Your password">
              <input id="delete-pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
          )}
          <button className="btn btn-danger" disabled={me.user.hasPassword && !password}>
            Delete my account
          </button>
        </form>
      </details>
    </div>
  );
}
