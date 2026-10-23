import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import { Field, Notice } from '../components/ui';
import { useSession } from '../session';
import type { Me } from '../types';

function SignInFrame({ children }: { children: ReactNode }) {
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

const message = (err: unknown) => (err instanceof ApiFailure ? err.message : 'Something went wrong. Please try again.');

/** After any sign-in: people without a password are asked to set one. */
async function afterSignIn(refresh: () => Promise<void>, navigate: ReturnType<typeof useNavigate>) {
  await refresh();
  const me = await api<Me>('/me').catch(() => null);
  navigate(me?.kind === 'user' && !me.user.hasPassword ? '/account/password?first=1' : '/', { replace: true });
}

export function SignIn() {
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState<'password' | 'code'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'code') codeInput.current?.focus();
  }, [step]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const signInWithPassword = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/auth/password/sign-in', { body: { email, password } });
      await afterSignIn(refresh, navigate);
    });
  };

  const emailCode = () => {
    if (!email.includes('@')) {
      setError('Enter your email address first.');
      return;
    }
    void run(async () => {
      await api('/auth/request', { body: { email } });
      setStep('code');
    });
  };

  const verifyCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/auth/verify', { body: { email, code } });
      await afterSignIn(refresh, navigate);
    });
  };

  return (
    <SignInFrame>
      {step === 'password' ? (
        <>
          <form onSubmit={signInWithPassword} noValidate>
            <h1>Sign in</h1>
            {error && <Notice tone="stop">{error}</Notice>}
            <Field id="email" label="Email address">
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field id="password" label="Password">
              <input
                id="password"
                className="input"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <button className="btn btn-block" disabled={busy || !email || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <div className="signin-alt">
            <p>First time here, or forgot your password?</p>
            <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={emailCode}>
              Email me a sign-in code
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={verifyCode} noValidate>
          <h1>Check your email</h1>
          <p className="lede">
            If <strong>{email}</strong> has a CampCount account, a 6-digit code is on its way. It expires in 10 minutes. Check your junk
            folder too.
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
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setStep('password');
                setCode('');
                setError(null);
              }}
            >
              Back
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
      await afterSignIn(refresh, navigate);
    } catch (err) {
      setError(message(err));
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
