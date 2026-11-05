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
  Button,
  Choice,
  EmptyState,
  Field,
  Icon,
  LoadError,
  Loading,
  Menu,
  PageHeader,
  SearchField,
  Sheet,
  SkeletonRows,
  SortHeader,
  sortRows,
  useConfirm,
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
      <Field id="share-link" label={shared.label} hint={`Works once. Expires ${expires}. Send it only to them: anyone with it can set the password.`}>
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
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
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
  const list = sortRows(
    all.filter(
      (u) =>
        matchesSearch(query, u.displayName, u.email) &&
        (filter === 'all' ||
          (filter === 'admins' && u.platformAdmin) ||
          (filter === 'no-password' && !u.hasPassword && !u.isDemo && u.status === 'active') ||
          (filter === 'disabled' && u.status === 'disabled') ||
          (filter === 'demo' && u.isDemo)),
    ),
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
            body: <p>They lose access to every event. This can't be undone.</p>,
            confirm: 'Delete account',
            danger: true,
          });
          if (!ok) return;
          try {
            const res = await api<{ result: string }>(`/admin/users/${u.id}`, { method: 'DELETE' });
            toast(res.result === 'anonymised' ? `Deleted ${u.displayName}. Their name was wiped from past records.` : `Deleted ${u.displayName}`);
            await users.reload();
          } catch (err) {
            fail(err);
          }
        },
      },
    ];
    return <Menu label={`Actions for ${u.displayName}`} items={items} />;
  };

  return (
    <>
      <PageHeader
        title="Accounts"
        back={{ to: '/admin', label: 'Admin' }}
        summary={users.data && `${all.length} accounts · ${plural(all.filter((u) => u.platformAdmin).length, 'admin')}`}
        primary={
          <Button kind="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            Add account
          </Button>
        }
      />
      <div className="sections">
        <div className="toolbar">
          <SearchField id="accounts-q" label="Search name or email" value={query} onChange={setQuery} />
          <select className="select" aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">All accounts</option>
            <option value="admins">Admins</option>
            <option value="no-password">No password yet</option>
            <option value="disabled">Disabled</option>
            <option value="demo">Demo accounts</option>
          </select>
          {users.data && (
            <p className="toolbar-count" aria-live="polite">
              {list.length} of {all.length}
            </p>
          )}
        </div>

        {users.loading && !users.data ? (
          <Loading what="accounts">
            <SkeletonRows rows={8} />
          </Loading>
        ) : users.error ? (
          <LoadError error={users.error} onRetry={users.reload} what="accounts" />
        ) : list.length === 0 ? (
          <EmptyState title={all.length ? 'No accounts match' : 'No accounts yet'}>{all.length ? 'Try another search or filter.' : undefined}</EmptyState>
        ) : wide ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Name" column="name" sort={sort} onSort={toggle} />
                  <SortHeader label="Email" column="email" sort={sort} onSort={toggle} />
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
                      <strong>
                        {u.displayName}
                        {u.id === myId && ' (you)'}
                      </strong>
                    </td>
                    <td>{u.email}</td>
                    <td>{badges(u)}</td>
                    <td className="cell-num">{u.events}</td>
                    <td className="meta">{u.lastSeen ? minutesAgo(u.lastSeen) : 'Never'}</td>
                    <td className="cell-action">{menu(u)}</td>
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
                <span className="row-side">{menu(u)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="meta">
          To put someone on a camp's staff, open the camp from <Link to="/">Camps</Link>.
        </p>
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
      <div className="choices">
        <Choice
          label="Admin"
          description="Can create camps, manage everyone's accounts, use View as and read the activity log."
          checked={form.platformAdmin}
          onChange={(e) => setForm({ ...form, platformAdmin: e.target.checked })}
        />
        <Choice
          label="Email them a set-up link"
          description="They choose their own password from the link. You'll get the link to copy too."
          checked={form.sendEmail}
          onChange={(e) => setForm({ ...form, sendEmail: e.target.checked })}
        />
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
