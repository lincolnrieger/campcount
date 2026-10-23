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
  const { me, signOut } = useSession();
  const navigate = useNavigate();
  if (me?.kind !== 'user') return null;
  return (
    <div className="narrow">
      <h1>Your account</h1>
      <dl className="facts">
        <dt>Name</dt>
        <dd>{me.user.displayName}</dd>
        <dt>Email</dt>
        <dd>{me.user.email}</dd>
        <dt>Password</dt>
        <dd>{me.user.hasPassword ? 'Set' : 'Not set'}</dd>
      </dl>
      <div className="actions">
        {!me.user.isDemo && (
          <button className="btn btn-secondary" onClick={() => navigate('/account/password')}>
            {me.user.hasPassword ? 'Change password' : 'Set a password'}
          </button>
        )}
        <button className="btn btn-secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
      {me.platformPermissions.includes('platform.users.manage') && (
        <ul className="launch section-gap">
          <li>
            <a href="/admin">
              Admin <span>People and demo mode</span>
            </a>
          </li>
        </ul>
      )}
    </div>
  );
}
