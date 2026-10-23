import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import { Field, Notice } from '../components/ui';
import { useSession } from '../session';

function SignInFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="signin">
      <div className="signin-band">
        <p className="wordmark">CampCount</p>
        <p>Attendance, meals and activities for Scouts SA camps.</p>
      </div>
      <main className="signin-body">{children}</main>
    </div>
  );
}

export function SignIn() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'code') codeInput.current?.focus();
  }, [step]);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/request', { body: { email } });
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/verify', { body: { email, code } });
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SignInFrame>
      {step === 'email' ? (
        <form onSubmit={requestCode} noValidate>
          <h1>Sign in</h1>
          <p className="lede">We'll email you a 6-digit code. No password needed.</p>
          {error && <Notice tone="stop">{error}</Notice>}
          <Field id="email" label="Email address">
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <button className="btn btn-block" disabled={busy || !email}>
            {busy ? 'Sending…' : 'Email me a code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} noValidate>
          <h1>Check your email</h1>
          <p className="lede">
            If <strong>{email}</strong> has a CampCount account, a code is on its way. It expires in 10 minutes.
          </p>
          {error && <Notice tone="stop">{error}</Notice>}
          <Field id="code" label="Sign-in code">
            <input
              ref={codeInput}
              id="code"
              className="input input-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <button className="btn btn-block" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <div className="actions">
            <button type="button" className="btn-link" onClick={() => { setStep('email'); setCode(''); setError(null); }}>
              Use a different email
            </button>
          </div>
        </form>
      )}
    </SignInFrame>
  );
}

/**
 * Landing page for the emailed link. The token lives in the URL fragment and
 * is only sent when the person presses the button, so automated link
 * scanners cannot use it up.
 */
export function VerifyLink() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = new URLSearchParams(window.location.hash.slice(1)).get('t');

  async function confirm() {
    if (!token) return;
    setBusy(true);
    try {
      await api('/auth/verify', { body: { token } });
      history.replaceState(null, '', window.location.pathname);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <SignInFrame>
      <h1>Sign in to CampCount</h1>
      {error && <Notice tone="stop">{error}</Notice>}
      {token ? (
        <button className="btn btn-block" onClick={() => void confirm()} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      ) : (
        <Notice tone="warn">This link is incomplete. Copy the whole link from the email, or enter the code instead.</Notice>
      )}
      <div className="actions">
        <a href="/sign-in">Enter a code instead</a>
      </div>
    </SignInFrame>
  );
}
