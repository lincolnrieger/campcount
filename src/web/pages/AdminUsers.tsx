import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import { ApiFailure, api } from '../api';
import { matchesSearch } from '../../shared/search';
import { minutesAgo } from '../model';
import { useSession } from '../session';
import { useApi } from '../useApi';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  Field,
  FilterChips,
  Icon,
  InfoTip,
  LoadError,
  Loading,
  Menu,
  PageHeader,
  SearchField,
  Sheet,
  SkeletonRows,
  SortHeader,
  Toggle,
  Toolbar,
  sortRows,
  useConfirm,
  useRemembered,
  useSort,
  useToast,
  useWide,
  plural,
} from '../ui';
import type { MenuItem } from '../ui';

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

type Filter = 'all' | 'admins' | 'no-password' | 'disabled' | 'demo';
interface Shared {
  userId: string;
  link: string;
  expiresAt: string;
  label: string;
}

/** A one-time password link to hand over: copy it, share it, or email it instead. */
function LinkBox({ shared, onEmail, emailBusy }: { shared: Shared; onEmail?: () => Promise<unknown>; emailBusy?: boolean }) {
  const toast = useToast();
  const expires = new Date(shared.expiresAt).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Adelaide' });
  const canShare = typeof navigator.share === 'function';
  return (
    <div className="stack">
      <Field id="share-link" label={shared.label} hint={
          <>
            Works once · expires {expires}{' '}
            <InfoTip label="About password links">Send it only to them: anyone with the link can set the password.</InfoTip>
          </>
        }>
        <input className="input" readOnly value={shared.link} onFocus={(e) => e.target.select()} />
      </Field>
      <div className="btn-row">
        <Button
          kind="primary"
          onClick={() => {
            navigator.clipboard
              ?.writeText(shared.link)
              .then(() => toast('Link copied'))
              .catch(() => toast("Couldn't copy. Select the link and copy it yourself.", { tone: 'error' }));
          }}
        >
          <Icon name="copy" />
          Copy link
        </Button>
        {canShare && <Button onClick={() => void navigator.share({ title: 'CampCount', url: shared.link }).catch(() => undefined)}>Share…</Button>}
        {onEmail && (
          <Button onAction={onEmail} busy={emailBusy} busyLabel="Emailing…">
            Email them instead
          </Button>
        )}
      </div>
    </div>
  );
}

/** Admin › Accounts: everyone who can sign in to CampCount. */
export function AdminUsers() {
  const { me } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const wide = useWide();
  const users = useApi<{ users: UserRow[] }>('/admin/users');
  const [query, setQuery] = useRemembered('accounts:q', '');
  const [filter, setFilter] = useRemembered<Filter>('accounts:filter', 'all');
  const { sort, toggle } = useSort<'name' | 'email' | 'events' | 'lastSeen'>('name');
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<UserRow | null>(null);
  const [shared, setShared] = useState<Shared | null>(null);
  const myId = me?.kind === 'user' ? me.user.id : null;

  const fail = (err: unknown) => toast(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.', { tone: 'error' });

  async function act(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      if (success) toast(success);
      await users.reload();
    } catch (err) {
      fail(err);
    }
  }

  async function passwordLink(u: UserRow, sendEmail: boolean) {
    try {
      const res = await api<{ link: string; expiresAt: string; purpose: 'setup' | 'reset'; emailed: boolean }>(`/admin/users/${u.id}/password-link`, { body: { sendEmail } });
      if (sendEmail) {
        if (!res.emailed) {
          toast("The email couldn't be sent. Copy the link and send it to them yourself.", { tone: 'error' });
          return;
        }
        setShared(null);
        toast(`Emailed ${u.displayName} a link to ${res.purpose === 'reset' ? 'reset' : 'set'} their password`);
        return;
      }
      setShared({ userId: u.id, link: res.link, expiresAt: res.expiresAt, label: `${res.purpose === 'reset' ? 'Password reset' : 'Set-up'} link for ${u.displayName}` });
    } catch (err) {
      fail(err);
    }
  }

  const all = users.data?.users ?? [];
  const noPassword = (u: UserRow) => !u.hasPassword && !u.isDemo && u.status === 'active';
  const inFilter = (u: UserRow, f: Filter) =>
    f === 'all' || (f === 'admins' && u.platformAdmin) || (f === 'no-password' && noPassword(u)) || (f === 'disabled' && u.status === 'disabled') || (f === 'demo' && u.isDemo);
  const count = (f: Filter) => all.filter((u) => inFilter(u, f)).length;
  const list = sortRows(
    all.filter((u) => matchesSearch(query, u.displayName, u.email) && inFilter(u, filter)),
    (u) => (sort.key === 'name' ? u.displayName : sort.key === 'email' ? u.email : sort.key === 'events' ? u.events : (u.lastSeen ?? '')),
    sort.dir,
  );
  const sharedFor = all.find((u) => u.id === shared?.userId);

  const badges = (u: UserRow) => (
    <span className="badges">
      {u.platformAdmin && <Badge tone="brand">Admin</Badge>}
      {u.isDemo && <Badge tone="info">Demo</Badge>}
      {!u.hasPassword && !u.isDemo && u.status === 'active' && <Badge tone="warning">No password</Badge>}
      {u.hasPassword && !u.verified && !u.isDemo && <Badge>Not confirmed</Badge>}
      {u.status === 'disabled' && <Badge tone="error">Disabled</Badge>}
    </span>
  );

  const menu = (u: UserRow) => {
    const isMe = u.id === myId;
    const items: (MenuItem | false)[] = [
      { label: 'Rename', onSelect: () => setRenaming(u) },
      !u.isDemo && u.status === 'active' && { label: u.hasPassword ? 'Copy password reset link' : 'Copy set-up link', onSelect: () => void passwordLink(u, false) },
      !isMe && {
        label: u.platformAdmin ? 'Remove admin' : 'Make admin',
        onSelect: () =>
          void act(
            () => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { platformAdmin: !u.platformAdmin } }),
            u.platformAdmin ? `${u.displayName} is no longer an admin` : `${u.displayName} is now an admin`,
          ),
      },
      !isMe && {
        label: u.status === 'active' ? 'Disable account' : 'Enable account',
        onSelect: async () => {
          if (u.status === 'active') {
            const ok = await confirm({
              title: `Disable ${u.displayName}'s account?`,
              body: <p>They're signed out straight away and can't sign in until you enable it again.</p>,
              confirm: 'Disable account',
            });
            if (!ok) return;
          }
          await act(
            () => api(`/admin/users/${u.id}/status`, { body: { status: u.status === 'active' ? 'disabled' : 'active' } }),
            u.status === 'active' ? `Disabled ${u.displayName}` : `Enabled ${u.displayName}`,
          );
        },
      },
      !isMe && {
        label: 'Delete account…',
        danger: true,
        onSelect: async () => {
          const ok = await confirm({
            title: `Delete ${u.displayName}'s account?`,
            body: (
              <p>
                The account is removed completely: their name, email, password and access to every camp. Camps they created pass to you. To stop them signing in
                but keep the account, disable it instead. This can't be undone.
              </p>
            ),
            confirm: 'Delete account',
            danger: true,
          });
          if (!ok) return;
          try {
            const res = await api<{ result: string }>(`/admin/users/${u.id}`, { method: 'DELETE' });
            toast(res.result === 'anonymised' ? `Deleted ${u.displayName}. Scans they recorded are kept without their name.` : `Deleted ${u.displayName}`);
            await users.reload();
          } catch (err) {
            fail(err);
          }
        },
      },
    ];
    return <Menu label={`Actions for ${u.displayName}`} items={items} />;
  };

  const lastSeen = (u: UserRow) => (u.lastSeen ? minutesAgo(u.lastSeen) : 'Never');
  /** The one-tap fix for an account that can't sign in yet. */
  const quick = (u: UserRow) =>
    noPassword(u) && (
      <Button small onAction={() => passwordLink(u, false)} busyLabel="Making…" aria-label={`Set-up link for ${u.displayName}`}>
        <Icon name="copy" size={16} />
        Set-up link
      </Button>
    );
  const missing = count('no-password');

  return (
    <>
      <PageHeader
        title="Accounts"
        back={{ to: '/admin', label: 'Admin' }}
        summary={users.data && `${all.length} accounts · ${plural(all.filter((u) => u.platformAdmin).length, 'admin')}`}
        help={
          <>
            Everyone who can sign in. To put someone on a camp's staff, open the camp from <Link to="/">Camps</Link>.
          </>
        }
        primary={
          <Button kind="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            Add account
          </Button>
        }
      />
      <div className="pf-stack">
        {users.data && missing > 0 && filter !== 'no-password' && (
          <Banner
            tone="warning"
            action={
              <Button small onClick={() => setFilter('no-password')}>
                Show them
              </Button>
            }
          >
            {plural(missing, 'account')} can't sign in with a password yet
          </Banner>
        )}
        <Toolbar sticky label="Find accounts">
          <SearchField id="accounts-q" label="Search name or email" placeholder="Search name or email" value={query} onChange={setQuery} slash />
          {users.data && (
            <FilterChips
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All', count: all.length },
                { value: 'admins', label: 'Admins', count: count('admins') },
                { value: 'no-password', label: 'No password', count: missing },
                { value: 'disabled', label: 'Disabled', count: count('disabled') },
                { value: 'demo', label: 'Demo', count: count('demo') },
              ]}
            />
          )}
          {users.data && (
            <div className="toolbar-end">
              <p className="toolbar-count" aria-live="polite">
                {list.length} of {all.length}
              </p>
            </div>
          )}
        </Toolbar>

        {users.loading && !users.data ? (
          <Loading what="accounts">
            <SkeletonRows rows={8} />
          </Loading>
        ) : users.error ? (
          <LoadError error={users.error} onRetry={users.reload} what="accounts" />
        ) : list.length === 0 ? (
          <EmptyState
            title={all.length ? 'No accounts match' : 'No accounts yet'}
            actions={
              all.length > 0 && (
                <Button
                  onClick={() => {
                    setQuery('');
                    setFilter('all');
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        ) : wide ? (
          <div className="table-wrap scroll-list">
            <table className="table pf-table">
              <thead>
                <tr>
                  <th scope="col" aria-sort={sort.key === 'name' || sort.key === 'email' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <span className="pf-sort-pair">
                      <button type="button" className="sort-btn" onClick={() => toggle('name')}>
                        Name
                        <Icon name={sort.key === 'name' ? (sort.dir === 'asc' ? 'sortAsc' : 'sortDesc') : 'sort'} size={16} />
                      </button>
                      <button type="button" className="sort-btn" onClick={() => toggle('email')}>
                        Email
                        <Icon name={sort.key === 'email' ? (sort.dir === 'asc' ? 'sortAsc' : 'sortDesc') : 'sort'} size={16} />
                      </button>
                    </span>
                  </th>
                  <th scope="col">Status</th>
                  <SortHeader label="Events" column="events" sort={sort} onSort={toggle} className="cell-num" />
                  <SortHeader label="Last active" column="lastSeen" sort={sort} onSort={toggle} />
                  <th scope="col" className="cell-action">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.map((u) => (
                  <tr key={u.id} className={u.status === 'disabled' ? 'is-muted' : undefined}>
                    <td>
                      <span className="pf-person">
                        <strong>
                          {u.displayName}
                          {u.id === myId && <span className="meta"> (you)</span>}
                        </strong>
                        <span className="meta">{u.email}</span>
                      </span>
                    </td>
                    <td>{badges(u)}</td>
                    <td className="cell-num">{u.events}</td>
                    <td className="meta pf-nowrap">{lastSeen(u)}</td>
                    <td className="cell-action">
                      <span className="pf-row-actions">
                        {quick(u)}
                        {menu(u)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="list">
            {list.map((u) => (
              <li key={u.id} className={u.status === 'disabled' ? 'row is-muted' : 'row'}>
                <span className="row-main">
                  <span className="row-title">
                    {u.displayName}
                    {u.id === myId && ' (you)'}
                  </span>
                  <span className="row-meta">
                    {u.email} · {u.events} {u.events === 1 ? 'event' : 'events'} · {u.lastSeen ? `active ${minutesAgo(u.lastSeen)}` : 'never signed in'}
                  </span>
                  {badges(u)}
                </span>
                <span className="row-side">
                  {quick(u)}
                  {menu(u)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>


      <Sheet open={adding} title="Add account" onClose={() => setAdding(false)}>
        {adding && (
          <AddAccount
            onDone={async (res) => {
              setAdding(false);
              await users.reload();
              if (res) setShared(res);
            }}
          />
        )}
      </Sheet>

      <Sheet open={renaming !== null} title="Rename account" onClose={() => setRenaming(null)}>
        {renaming && (
          <RenameForm
            user={renaming}
            onDone={async (name) => {
              const u = renaming;
              setRenaming(null);
              if (name) await act(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body: { displayName: name } }), `Renamed to ${name}`);
            }}
          />
        )}
      </Sheet>

      <Sheet open={shared !== null} title="Password link" onClose={() => setShared(null)}>
        {shared && <LinkBox shared={shared} onEmail={sharedFor ? () => passwordLink(sharedFor, true) : undefined} />}
      </Sheet>
    </>
  );
}

function AddAccount({ onDone }: { onDone: (shared: Shared | null) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ email: '', displayName: '', platformAdmin: false, sendEmail: true });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!form.displayName.trim()) found.displayName = 'Enter their name';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) found.email = 'Enter an email address like name@example.com';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const res = await api<{ id: string; link: string; expiresAt: string; emailed: boolean }>('/admin/users', { body: form });
      const name = form.displayName.trim();
      toast(res.emailed ? `Added ${name}. We've emailed them a set-up link.` : `Added ${name}. Send them the set-up link.`);
      onDone({ userId: res.id, link: res.link, expiresAt: res.expiresAt, label: `Set-up link for ${name}` });
    } catch (err) {
      if (err instanceof ApiFailure) {
        const fields = err.fieldErrors();
        setErrors(Object.keys(fields).length ? fields : { email: err.message });
      } else setErrors({ email: 'No connection. Check your signal and try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <Field id="u-name" label="Name" error={errors.displayName}>
        <input className="input" value={form.displayName} autoComplete="off" onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
      </Field>
      <Field id="u-email" label="Email address" error={errors.email}>
        <input className="input" type="email" value={form.email} autoComplete="off" onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </Field>
      <div className="pf-toggles">
        <Toggle label="Admin" hint="Camps, accounts, View as, activity log" checked={form.platformAdmin} onChange={(v) => setForm({ ...form, platformAdmin: v })} />
        <Toggle label="Email them a set-up link" hint="You also get the link to copy" checked={form.sendEmail} onChange={(v) => setForm({ ...form, sendEmail: v })} />
      </div>
      <div className="btn-row">
        <Button type="submit" kind="primary" busy={busy} busyLabel="Adding…">
          Add account
        </Button>
        <Button onClick={() => onDone(null)}>Cancel</Button>
      </div>
    </form>
  );
}

function RenameForm({ user, onDone }: { user: UserRow; onDone: (name: string | null) => Promise<void> }) {
  const [name, setName] = useState(user.displayName);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const next = name.trim();
        if (!next) return setError('Enter a name');
        setBusy(true);
        await onDone(next === user.displayName ? null : next);
        setBusy(false);
      }}
    >
      <Field id="rename" label="Name" error={error}>
        <input className="input" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="btn-row">
        <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…">
          Save changes
        </Button>
        <Button onClick={() => void onDone(null)}>Cancel</Button>
      </div>
    </form>
  );
}
