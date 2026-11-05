import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import type { Activity } from '../model';
import { useApi } from '../useApi';
import { matchesSearch, searchRank } from '../../shared/search';
import {
  Badge,
  Button,
  ButtonLink,
  Choice,
  EmptyState,
  Field,
  Icon,
  LoadError,
  Loading,
  Menu,
  PageHeader,
  SearchField,
  Segmented,
  Sheet,
  SkeletonHeader,
  SkeletonRows,
  plural,
  useConfirm,
  useToast,
} from '../ui';
import { useEvent } from './EventLayout';

interface StaffRow {
  assignmentId: string;
  user: { id: string; email: string; displayName: string; status: string; hasPassword: boolean };
  role: { key: string; name: string };
  activity: { id: string; name: string } | null;
}
interface Person {
  id: string;
  displayName: string;
  email: string;
}
interface Role {
  key: string;
  name: string;
  description: string;
  scope: 'event' | 'activity';
}

const fail = (err: unknown) => (err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');

/** The role picker: one radio per role, with what each can do; plus the activity for activity leaders. */
function RolePicker({
  roles,
  activities,
  roleKey,
  activityId,
  onChange,
  name,
}: {
  roles: Role[];
  activities: Activity[];
  roleKey: string;
  activityId: string;
  onChange: (roleKey: string, activityId: string) => void;
  name: string;
}) {
  const role = roles.find((r) => r.key === roleKey);
  return (
    <>
      <fieldset className="field">
        <legend className="field-label">Role</legend>
        <div className="choices">
          {roles.map((r) => (
            <Choice key={r.key} type="radio" name={name} label={<strong>{r.name}</strong>} description={r.description} checked={roleKey === r.key} onChange={() => onChange(r.key, activityId)} />
          ))}
        </div>
      </fieldset>
      {role?.scope === 'activity' && (
        <Field id={`${name}-activity`} label="Activity" hint="Leaders only see and scan the activity you choose.">
          <select className="select" value={activityId} onChange={(e) => onChange(roleKey, e.target.value)}>
            <option value="">All activities</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}

/** Settings › Staff: who works on the event and what they can do. */
export function Staff() {
  const { event, can } = useEvent();
  const { base: eventBase } = useEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const staff = useApi<{ staff: StaffRow[] }>(`/events/${event.id}/staff`);
  const roles = useApi<{ roles: Role[] }>('/me/roles');
  const activities = useApi<{ activities: Activity[] }>(event.features.activities ? `/events/${event.id}/activities` : null);
  const [changing, setChanging] = useState<{ row: StaffRow; roleKey: string; activityId: string } | null>(null);
  const back = { to: `${eventBase}/settings`, label: 'Settings' };

  if (!can('staff.manage')) return <Navigate to={back.to} replace />;
  const primary = (
    <ButtonLink to="add" kind="primary">
      Add staff
    </ButtonLink>
  );

  async function remove(row: StaffRow) {
    const ok = await confirm({
      title: `Remove ${row.user.displayName}?`,
      body: <p>They stop being {row.role.name} on this event and lose access straight away. Their account stays.</p>,
      confirm: 'Remove from event',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/events/${event.id}/staff/${row.assignmentId}`, { method: 'DELETE' });
      toast(`Removed ${row.user.displayName}`);
      await staff.reload();
    } catch (err) {
      toast(fail(err), { tone: 'error' });
    }
  }

  async function resend(row: StaffRow) {
    try {
      await api(`/events/${event.id}/staff/${row.assignmentId}/invite`, { body: {} });
      toast(`Emailed ${row.user.displayName} a new link to set their password`);
    } catch (err) {
      toast(fail(err), { tone: 'error' });
    }
  }

  return (
    <>
      <PageHeader title="Staff" back={back} summary={staff.data && staff.data.staff.length > 0 ? `${plural(staff.data.staff.length, 'person', 'people')} on this event` : undefined} primary={primary} />
      {staff.loading && !staff.data ? (
        <Loading what="staff">
          <SkeletonRows rows={4} action />
        </Loading>
      ) : staff.error ? (
        <LoadError error={staff.error} onRetry={staff.reload} what="staff" />
      ) : staff.data && staff.data.staff.length === 0 ? (
        <EmptyState title="No staff yet" actions={primary}>
          Add an event manager first. They can bring in the rest of the crew.
        </EmptyState>
      ) : (
        staff.data && (
          <ul className="list">
            {staff.data.staff.map((row) => (
              <li key={row.assignmentId} className="row">
                <span className="row-main">
                  <span className="row-title">{row.user.displayName}</span>
                  <span className="row-meta">{row.user.email}</span>
                  <span className="staff-badges">
                    <Badge tone="brand">
                      {row.role.name}
                      {row.activity ? `: ${row.activity.name}` : ''}
                    </Badge>
                    {!row.user.hasPassword && <Badge tone="warning">Hasn't set a password</Badge>}
                  </span>
                </span>
                <span className="row-side">
                  <Menu
                    label={`Options for ${row.user.displayName}`}
                    items={[
                      { label: 'Change role', onSelect: () => setChanging({ row, roleKey: row.role.key, activityId: row.activity?.id ?? '' }) },
                      !row.user.hasPassword && { label: 'Resend invite email', onSelect: () => void resend(row) },
                      { label: 'Remove from event', danger: true, onSelect: () => void remove(row) },
                    ]}
                  />
                </span>
              </li>
            ))}
          </ul>
        )
      )}

      <Sheet open={changing !== null} title={changing ? `Change role: ${changing.row.user.displayName}` : 'Change role'} onClose={() => setChanging(null)}>
        {changing && (
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            {roles.data ? (
              <RolePicker
                name="change-role"
                roles={roles.data.roles}
                activities={activities.data?.activities ?? []}
                roleKey={changing.roleKey}
                activityId={changing.activityId}
                onChange={(roleKey, activityId) => setChanging({ ...changing, roleKey, activityId })}
              />
            ) : (
              <Loading what="roles" rows={4} />
            )}
            <div className="btn-row">
              <Button
                kind="primary"
                busyLabel="Saving…"
                onAction={async () => {
                  const role = roles.data?.roles.find((r) => r.key === changing.roleKey);
                  try {
                    await api(`/events/${event.id}/staff/${changing.row.assignmentId}`, {
                      method: 'PATCH',
                      body: { roleKey: changing.roleKey, activityId: role?.scope === 'activity' && changing.activityId ? changing.activityId : null },
                    });
                    toast(`${changing.row.user.displayName} is now ${role?.name ?? changing.roleKey}`);
                    setChanging(null);
                    await staff.reload();
                  } catch (err) {
                    toast(fail(err), { tone: 'error' });
                  }
                }}
              >
                Save changes
              </Button>
              <Button onClick={() => setChanging(null)}>Cancel</Button>
            </div>
          </form>
        )}
      </Sheet>
    </>
  );
}

/** Settings › Staff › Add staff: who, then what they'll do. */
export function AddStaff() {
  const { event, can } = useEvent();
  const { base: eventBase } = useEvent();
  const navigate = useNavigate();
  const toast = useToast();
  const roles = useApi<{ roles: Role[] }>('/me/roles');
  const activities = useApi<{ activities: Activity[] }>(event.features.activities ? `/events/${event.id}/activities` : null);
  const people = useApi<{ people: Person[] }>(`/events/${event.id}/staff/people`);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Person | null>(null);
  const [form, setForm] = useState({ email: '', displayName: '', roleKey: 'scanner', activityId: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = { to: `${eventBase}/settings/staff`, label: 'Staff' };

  if (!can('staff.manage')) return <Navigate to={back.to} replace />;
  if (roles.loading && !roles.data)
    return (
      <Loading what="roles">
        <SkeletonHeader />
        <SkeletonRows rows={4} />
      </Loading>
    );
  if (roles.error)
    return (
      <>
        <PageHeader title="Add staff" back={back} />
        <LoadError error={roles.error} onRetry={roles.reload} what="roles" />
      </>
    );
  const roleList = roles.data?.roles ?? [];
  const selectedRole = roleList.find((r) => r.key === form.roleKey);

  async function add(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (mode === 'existing' && !picked) local['staff-search'] = 'Choose who you are adding';
    if (mode === 'new') {
      if (!form.displayName.trim()) local.displayName = 'Enter their name';
      if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) local.email = 'Enter an email address, like name@example.com';
    }
    setErrors(local);
    setFailure(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    const who = mode === 'existing' ? picked!.displayName : form.displayName || form.email;
    try {
      const res = await api<{ created: boolean; emailed: boolean }>(`/events/${event.id}/staff`, {
        body: {
          ...(mode === 'existing' && picked ? { userId: picked.id } : { email: form.email.trim() }),
          roleKey: form.roleKey,
          ...(mode === 'new' && form.displayName ? { displayName: form.displayName.trim() } : {}),
          ...(selectedRole?.scope === 'activity' && form.activityId ? { activityId: form.activityId } : {}),
        },
      });
      const role = selectedRole?.name ?? form.roleKey;
      if (res.created && !res.emailed) toast(`Added ${who} as ${role}, but the invite email couldn't be sent. Use "Resend invite email" later.`, { tone: 'error' });
      else toast(res.created ? `Added ${who} as ${role}. We've emailed them a link to set their password.` : `Added ${who} as ${role}`);
      navigate(back.to);
    } catch (err) {
      if (err instanceof ApiFailure) {
        setErrors(err.fieldErrors());
        setFailure(err.message);
      } else setFailure(fail(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Add staff" back={back} />
      <form className="form" onSubmit={add} noValidate>
        {failure && (
          <p className="field-error" role="alert">
            <Icon name="error" size={16} />
            {failure}
          </p>
        )}
        <fieldset className="field">
          <legend className="field-label">Who are you adding?</legend>
          <Segmented
            label="Who are you adding?"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setErrors({});
            }}
            options={[
              { value: 'existing', label: 'Has an account' },
              { value: 'new', label: 'Someone new' },
            ]}
          />
        </fieldset>
        {mode === 'existing' ? (
          picked ? (
            <ul className="list">
              <li className="row">
                <span className="row-main">
                  <span className="row-title">{picked.displayName}</span>
                  <span className="row-meta">{picked.email}</span>
                </span>
                <Button small kind="ghost" onClick={() => setPicked(null)}>
                  Choose someone else
                </Button>
              </li>
            </ul>
          ) : (
            <div className="field">
              <SearchField id="staff-search" label="Find a person by name or email" value={query} onChange={setQuery} placeholder="Name or email, even one letter" />
              {errors['staff-search'] && (
                <span className="field-error" id="staff-search-error">
                  <Icon name="error" size={16} />
                  {errors['staff-search']}
                </span>
              )}
              {people.error ? (
                <LoadError error={people.error} onRetry={people.reload} what="accounts" />
              ) : people.data ? (
                <PersonResults people={people.data.people} query={query} onPick={setPicked} />
              ) : (
                <Loading what="accounts" rows={3} />
              )}
              <p className="meta">
                Not listed?{' '}
                <button type="button" className="link-button" onClick={() => setMode('new')}>
                  Add someone new
                </button>
              </p>
            </div>
          )
        ) : (
          <>
            <Field id="displayName" label="Name" error={errors.displayName}>
              <input className="input" autoComplete="off" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </Field>
            <Field id="email" label="Email address" hint="We'll email them a link to set their password. If they already have an account, they're just added." error={errors.email}>
              <input className="input" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          </>
        )}
        <RolePicker
          name="add-role"
          roles={roleList}
          activities={activities.data?.activities ?? []}
          roleKey={form.roleKey}
          activityId={form.activityId}
          onChange={(roleKey, activityId) => setForm({ ...form, roleKey, activityId })}
        />
        <div className="btn-row">
          <Button type="submit" kind="primary" busy={busy} busyLabel="Adding…">
            Add staff
          </Button>
          <Link to={back.to} className="btn btn-secondary">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}

function PersonResults({ people, query, onPick }: { people: Person[]; query: string; onPick: (p: Person) => void }) {
  const q = query.trim();
  const matches = (q ? people.filter((p) => matchesSearch(q, p.displayName, p.email)) : [...people])
    .sort((a, b) => (q ? searchRank(q, a.displayName) - searchRank(q, b.displayName) : 0) || a.displayName.localeCompare(b.displayName))
    .slice(0, 8);
  if (people.length === 0) return <p className="meta">Everyone with an account is already on this event.</p>;
  if (matches.length === 0) return <p className="meta">No one matches "{q}".</p>;
  return (
    <ul className="list">
      {matches.map((p) => (
        <li key={p.id}>
          <button type="button" className="row row-button" onClick={() => onPick(p)}>
            <span className="row-main">
              <span className="row-title">{p.displayName}</span>
              <span className="row-meta">{p.email}</span>
            </span>
            <span className="staff-choose">Choose</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
