import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import { Button, Choice, Field, Loading, Notice, Segmented, Skeleton } from '../ui';
import { BrandMark } from '../ui/AppShell';
import { useSession } from '../session';
import type { Me } from '../types';
import { useTitle } from '../shell';

/** The public card for sign-in pages: the CampCount mark and one task. */
export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <main className="public" id="main">
      <div className="public-card">
        <p className="public-brand">
          <BrandMark />
          CampCount
        </p>
        {children}
      </div>
    </main>
  );
}
const SignInFrame = PublicFrame;

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <Notice tone="error">
      <p>{children}</p>
    </Notice>
  );
}

/**
 * Phones often reload the page while you fetch the code from your mail app.
 * Remember (for this tab only, for 15 minutes) that a code is on its way, so
 * you come back to the code box instead of the start.
 */
const PENDING_KEY = 'cc-code-pending';
function savePending(email: string, reason: 'sign-in' | 'confirm') {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ email, reason, at: Date.now() }));
  } catch {
    // Not remembered; the emailed link still works.
  }
}
function loadPending(): { email: string; reason: 'sign-in' | 'confirm' } | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as { email: string; reason: 'sign-in' | 'confirm'; at: number } | null;
    return p && Date.now() - p.at < 15 * 60_000 ? p : null;
  } catch {
    return null;
  }
}
function clearPending() {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to clear.
  }
}

const message = (err: unknown) => (err instanceof ApiFailure ? err.message : 'Something went wrong. Please try again.');

/** After any sign-in: people without a password are asked to set one. */
async function afterSignIn(refresh: () => Promise<void>, navigate: ReturnType<typeof useNavigate>) {
  clearPending();
  await refresh();
  const me = await api<Me>('/me').catch(() => null);
  navigate(me?.kind === 'user' && !me.user.hasPassword ? '/account/password?first=1' : '/', { replace: true });
}

export function SignIn() {
  useTitle('Sign in');
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [pending] = useState(loadPending);
  const [step, setStep] = useState<'password' | 'signup' | 'code'>(() =>
    pending ? 'code' : window.location.pathname === '/sign-up' ? 'signup' : 'password',
  );
  const [reason, setReason] = useState<'sign-in' | 'confirm'>(pending?.reason ?? 'sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(pending?.email ?? '');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
      const res = await api<{ ok: true; verify?: boolean }>('/auth/password/sign-in', { body: { email, password } });
      if (res.verify) {
        // Right password, email not confirmed yet: a code is on its way.
        setReason('confirm');
        savePending(email, 'confirm');
        setStep('code');
        return;
      }
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
      setReason('sign-in');
      savePending(email, 'sign-in');
      setStep('code');
    });
  };

  const signUp = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/auth/signup', { body: { email, displayName: name, password: newPassword } });
      setReason('confirm');
      savePending(email, 'confirm');
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
      {step !== 'code' && (
        <Segmented
          block
          label="Sign in or create an account"
          value={step}
          onChange={(v) => {
            setStep(v);
            setError(null);
          }}
          options={[
            { value: 'password', label: 'Sign in' },
            { value: 'signup', label: 'Create account' },
          ]}
        />
      )}
      {step === 'signup' ? (
        <form className="form" onSubmit={signUp} noValidate>
          <div className="stack-tight">
            <h1>Create your account</h1>
            <p className="meta">We'll email you a code to confirm your address. Then an event manager can add you to their camp.</p>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          <Field id="name" label="Your name">
            <input id="name" className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field id="signup-email" label="Email address" hint="Your Scouts SA email is best.">
            <input
              id="signup-email"
              className="input"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field id="signup-password" label="Choose a password" hint="At least 10 characters. A short phrase is easy to remember.">
            <input
              id="signup-password"
              className="input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
          <Choice label="Show password" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
          <Button type="submit" kind="primary" block busy={busy} busyLabel="Creating…" disabled={name.trim().length < 2 || !email.includes('@') || newPassword.length < 10}>
            Create account
          </Button>
        </form>
      ) : step === 'password' ? (
        <>
          <form className="form" onSubmit={signInWithPassword} noValidate>
            <h1>Sign in</h1>
            {error && <ErrorText>{error}</ErrorText>}
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
            <Button type="submit" kind="primary" block busy={busy} busyLabel="Signing in…" disabled={!email || !password}>
              Sign in
            </Button>
          </form>
          <div className="signin-alt">
            <p className="meta">Forgot your password, or never set one?</p>
            <Button block disabled={busy} onClick={emailCode}>
              Email me a code
            </Button>
          </div>
        </>
      ) : (
        <form className="form" onSubmit={verifyCode} noValidate>
          <h1>{reason === 'confirm' ? 'Confirm your email' : 'Check your email'}</h1>
          <p>
            {reason === 'confirm' ? (
              <>
                We've sent a 6-digit code to <strong>{email}</strong>. Enter it here, or tap the link in the email. It expires in 10 minutes.
              </>
            ) : (
              <>
                If <strong>{email}</strong> has a CampCount account, a 6-digit code is on its way. It expires in 10 minutes.
              </>
            )}{' '}
            Check your junk folder too.
          </p>
          {error && <ErrorText>{error}</ErrorText>}
          <Field id="code" label={reason === 'confirm' ? 'Code' : 'Sign-in code'}>
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
          <Button type="submit" kind="primary" block busy={busy} busyLabel="Checking…" disabled={code.length !== 6}>
            {reason === 'confirm' ? 'Confirm and sign in' : 'Sign in'}
          </Button>
          <div>
            <Button
              kind="ghost"
              onClick={() => {
                clearPending();
                setStep('password');
                setCode('');
                setError(null);
              }}
            >
              Use a different email
            </Button>
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
  useTitle('Sign in');
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
      {error && <ErrorText>{error}</ErrorText>}
      {token ? (
        <Button kind="primary" block busy={busy} busyLabel="Signing in…" onClick={() => void confirm()}>
          Sign in
        </Button>
      ) : (
        <Notice tone="warning">
          <p>This link is incomplete. Copy the whole link from the email, or enter the code instead.</p>
        </Notice>
      )}
      <p>
        <a href="/sign-in">Enter a code instead</a>
      </p>
    </SignInFrame>
  );
}

/**
 * Landing page for set-up and reset links (from an admin, or an invite to an
 * event). The token stays in the URL fragment, so it never reaches a server
 * until the person chooses their password.
 */
export function PasswordLink() {
  useTitle('Set your password');
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('t'));
  const [target, setTarget] = useState<{ email: string; displayName: string; purpose: 'setup' | 'reset' } | null>(null);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(token ? null : 'This link is incomplete. Copy the whole link from the email or message.');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    api<{ email: string; displayName: string; purpose: 'setup' | 'reset' }>('/auth/link/check', { body: { token } })
      .then(setTarget)
      .catch((err) => setFatal(message(err)));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/link/use', { body: { token, password } });
      history.replaceState(null, '', window.location.pathname);
      clearPending();
      await refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  if (fatal) {
    return (
      <SignInFrame>
        <h1>Link not working</h1>
        <Notice tone="warning">
          <p>{fatal}</p>
        </Notice>
        <p>
          <a className="btn btn-primary" href="/sign-in">
            Go to sign in
          </a>
        </p>
      </SignInFrame>
    );
  }
  if (!target) {
    return (
      <SignInFrame>
        <Loading what="your link">
          <Skeleton className="skeleton-title" />
          <Skeleton width="100%" height="var(--control)" className="" />
        </Loading>
      </SignInFrame>
    );
  }
  const first = target.displayName.split(/\s+/)[0];
  return (
    <SignInFrame>
      <form className="form" onSubmit={submit} noValidate>
        <h1>{target.purpose === 'reset' ? 'Choose a new password' : `Welcome, ${first}`}</h1>
        <p className="meta">
          {target.purpose === 'reset'
            ? 'This signs you out on your other devices.'
            : 'Choose a password for your CampCount account. You will use it with your email to sign in.'}
        </p>
        {error && <ErrorText>{error}</ErrorText>}
        <Field id="link-email" label="Email address">
          <input id="link-email" className="input" type="email" autoComplete="username" value={target.email} readOnly />
        </Field>
        <Field id="link-password" label="Password" hint="At least 10 characters. A short phrase is easy to remember.">
          <input
            id="link-password"
            className="input"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Choice label="Show password" checked={show} onChange={(e) => setShow(e.target.checked)} />
        <Button type="submit" kind="primary" block busy={busy} busyLabel="Saving…" disabled={password.length < 10}>
          Save password and sign in
        </Button>
      </form>
    </SignInFrame>
  );
}
