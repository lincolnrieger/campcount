import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ApiFailure, api } from '../api';
import { ViewAsForm } from '../components/ViewAs';
import { useSession } from '../session';
import { Badge, Button, Choice, Field, Icon, Notice, PageHeader, Section, useConfirm, useToast } from '../ui';

const failText = (err: unknown) => (err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');

/** Account: your name, password, View as (admins), sign out, delete. */
export function Account() {
  const { me, signOut, refresh } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState(me?.kind === 'user' ? me.user.displayName : '');
  const [nameError, setNameError] = useState<string | undefined>();
  const [password, setPassword] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  if (me?.kind !== 'user') return null;
  const user = me.user;
  const isAdmin = me.platformPermissions.includes('platform.users.manage');
  const canViewAs = isAdmin || me.preview !== null;

  async function saveName(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setNameError('Enter your name');
      return;
    }
    setNameError(undefined);
    try {
      await api('/me', { method: 'PATCH', body: { displayName: name.trim() } });
      await refresh();
      toast('Changes saved');
    } catch (err) {
      setNameError(failText(err));
    }
  }

  async function deleteAccount() {
    setDeleteError(null);
    const ok = await confirm({
      title: 'Delete your account?',
      body: <p>Your account and access are removed. Records of scans you made stay, but no longer show your name. This can't be undone.</p>,
      confirm: 'Delete my account',
      danger: true,
      typeToConfirm: 'DELETE',
    });
    if (!ok) return;
    try {
      await api('/me', { method: 'DELETE', body: password ? { password } : {} });
      await refresh();
      navigate('/sign-in', { replace: true });
    } catch (err) {
      setDeleteError(failText(err));
    }
  }

  return (
    <>
      <PageHeader title="Account" summary={user.email} />
      <div className="sections narrow-page">
        <Section title="Your details" id="details">
          <form className="form" onSubmit={saveName} noValidate>
            <Field id="account-name" label="Name" error={nameError}>
              <input className="input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field id="account-email" label="Email address">
              <input className="input" type="email" value={user.email} readOnly disabled />
            </Field>
            <div>
              <Button type="submit" kind="primary" disabled={name.trim() === user.displayName}>
                Save changes
              </Button>
            </div>
          </form>
        </Section>

        <Section title="Sign-in and access" id="access">
          <ul className="list">
            {!user.isDemo && (
              <li className="row row-link">
                <span className="row-main">
                  <span className="row-title">
                    <Link to="password">{user.hasPassword ? 'Change password' : 'Set a password'}</Link>
                  </span>
                  <span className="row-meta">{user.hasPassword ? 'Changing it signs you out on your other devices' : 'So you can sign in without waiting for an email'}</span>
                </span>
                {!user.hasPassword && <Badge tone="warning">Not set</Badge>}
                <span className="row-chevron">
                  <Icon name="chevron" />
                </span>
              </li>
            )}
            {canViewAs && (
              <li className="row row-link">
                <span className="row-main">
                  <span className="row-title">
                    <Link to="view-as">View as a role</Link>
                  </span>
                  <span className="row-meta">See an event the way a scanner, leader or the meal team sees it</span>
                </span>
                {me.preview && <Badge tone="brand">Viewing</Badge>}
                <span className="row-chevron">
                  <Icon name="chevron" />
                </span>
              </li>
            )}
          </ul>
          <div>
            <Button onClick={() => void signOut()}>Sign out</Button>
          </div>
        </Section>

        {!user.isDemo && (
          <section className="danger-zone" aria-labelledby="delete-heading">
            <h2 id="delete-heading">Delete my account</h2>
            <p className="meta">Your account and access are removed. This can't be undone.</p>
            {deleteError && (
              <Notice tone="error">
                <p>{deleteError}</p>
              </Notice>
            )}
            {user.hasPassword && (
              <Field id="delete-pw" label="Your password" hint="Needed to delete your account.">
                <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
            )}
            <div>
              <Button kind="danger" disabled={user.hasPassword && !password} onAction={deleteAccount} busyLabel="Deleting…">
                Delete my account
              </Button>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

/** Account › Password (also the first-sign-in "choose a password" step). */
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
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password', { body: current ? { password, currentPassword: current } : { password } });
      await refresh();
      toast('Password saved');
      navigate(first ? '/' : '/account', { replace: true });
    } catch (err) {
      setError(failText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={first ? 'Choose a password' : hasPassword ? 'Change password' : 'Set a password'}
        back={first ? undefined : { to: '/account', label: 'Account' }}
        summary={
          first ? "You're signed in. Choose a password so next time you can sign in without waiting for an email." : 'Changing your password signs you out on your other devices.'
        }
      />
      <form className="form" onSubmit={submit} noValidate>
        {error && (
          <Notice tone="error">
            <p>{error}</p>
          </Notice>
        )}
        <input type="email" autoComplete="username" value={me?.kind === 'user' ? me.user.email : ''} readOnly hidden />
        {hasPassword && !first && (
          <Field id="current" label="Current password" hint="Forgotten it? Sign out, then use Email me a code.">
            <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
        )}
        <Field id="new-password" label="New password" hint="At least 10 characters. A short phrase is easy to remember and hard to guess.">
          <input className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Choice label="Show password" checked={show} onChange={(e) => setShow(e.target.checked)} />
        <div className="btn-row">
          <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…" disabled={password.length < 10}>
            Save password
          </Button>
          {first ? (
            <Button onClick={() => navigate('/', { replace: true })}>Skip for now</Button>
          ) : (
            <Button onClick={() => navigate('/account')}>Cancel</Button>
          )}
        </div>
      </form>
    </>
  );
}

/** Account › View as a role (platform admins). */
export function ViewAsPage() {
  const { me } = useSession();
  const allowed = me?.kind === 'user' && (me.platformPermissions.includes('platform.users.manage') || me.preview !== null);
  return (
    <>
      <PageHeader title="View as a role" back={{ to: '/account', label: 'Account' }} summary="See an event as someone in that role. Nothing changes for anyone else." />
      {allowed ? (
        <div className="narrow-page">
          <ViewAsForm />
        </div>
      ) : (
        <Notice tone="info">
          <p>Only administrators can view the app as another role.</p>
        </Notice>
      )}
    </>
  );
}
