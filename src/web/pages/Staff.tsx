import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { ActionButton, Field, Loading, LoadError, Notice, PageHeader, SkeletonList } from '../components/ui';
import { useToast } from '../components/Toast';
import { useTitle } from '../useTitle';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import { matchesSearch, searchRank } from '../../shared/search';
import type { Activity } from './Activities';

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

/** Settings › Staff: who works on the event and what they can do. */
export function Staff() {
  useTitle('Staff');
  const { event } = useEvent();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const staff = useApi<{ staff: StaffRow[] }>(`/events/${event.id}/staff`);
  const roles = useApi<{ roles: Role[] }>('/me/roles');
  const activities = useApi<{ activities: Activity[] }>(`/events/${event.id}/activities`);
  const people = useApi<{ people: Person[] }>(`/events/${event.id}/staff/people`);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Person | null>(null);
  const [form, setForm] = useState({ email: '', displayName: '', roleKey: 'scanner', activityId: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'stop'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedRole = roles.data?.roles.find((r) => r.key === form.roleKey);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setErrors({});
    const who = mode === 'existing' ? picked?.displayName : form.displayName || form.email;
    try {
      const res = await api<{ created: boolean; emailed: boolean }>(`/events/${event.id}/staff`, {
        body: {
          ...(mode === 'existing' && picked ? { userId: picked.id } : { email: form.email }),
          roleKey: form.roleKey,
          ...(mode === 'new' && form.displayName ? { displayName: form.displayName } : {}),
          ...(selectedRole?.scope === 'activity' && form.activityId ? { activityId: form.activityId } : {}),
        },
      });
      const role = selectedRole?.name ?? form.roleKey;
      if (res.created && !res.emailed)
        setMessage({ tone: 'warn', text: `Added ${who} as ${role}, but the invite email couldn't be sent. Try "Resend invite" later, or ask an admin for a set-up link.` });
      else toast(res.created ? `Added ${who} as ${role}. We've emailed them a link to set their password.` : `Added ${who} as ${role}.`);
      setAdding(false);
      setForm({ ...form, email: '', displayName: '' });
      setPicked(null);
      setQuery('');
      await Promise.all([staff.reload(), people.reload()]);
    } catch (err) {
      if (err instanceof ApiFailure) {
        setErrors(err.fieldErrors());
        setMessage({ tone: 'stop', text: err.message });
      }
    } finally {
      setBusy(false);
    }
  }

  const roleOptions = (roles.data?.roles ?? []).flatMap((r) =>
    r.scope === 'activity'
      ? [
          { value: `${r.key}|`, label: `${r.name}: all activities` },
          ...(activities.data?.activities ?? []).map((a) => ({ value: `${r.key}|${a.id}`, label: `${r.name}: ${a.name}` })),
        ]
      : [{ value: `${r.key}|`, label: r.name }],
  );

  async function changeRole(row: StaffRow, value: string) {
    const [roleKey, activityId] = value.split('|');
    try {
      await api(`/events/${event.id}/staff/${row.assignmentId}`, {
        method: 'PATCH',
        body: { roleKey, activityId: activityId || null },
      });
      setMessage(null);
      toast(`${row.user.displayName} is now ${roleOptions.find((o) => o.value === value)?.label ?? roleKey}.`);
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    }
    await staff.reload();
  }

  async function resend(row: StaffRow) {
    try {
      await api(`/events/${event.id}/staff/${row.assignmentId}/invite`, { body: {} });
      toast(`Sent ${row.user.displayName} a new link to set their password.`);
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    }
  }

  async function remove(row: StaffRow) {
    if (!window.confirm(`Remove ${row.user.displayName} as ${row.role.name}? They lose access straight away.`)) return;
    try {
      await api(`/events/${event.id}/staff/${row.assignmentId}`, { method: 'DELETE' });
      setMessage(null);
      toast(`Removed ${row.user.displayName} as ${row.role.name}.`);
      await staff.reload();
    } catch (err) {
      setMessage({ tone: 'stop', text: err instanceof ApiFailure ? err.message : 'Something went wrong.' });
    }
  }

  return (
    <>
      <PageHeader
        title={<span className="visually-hidden">Staff</span>}
        sub={staff.data && staff.data.staff.length > 0 && `${staff.data.staff.length} on this event`}
        actions={
          !adding && (
            <button className="btn" onClick={() => setAdding(true)}>
              Add staff
            </button>
          )
        }
      />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {staff.loading && !staff.data && (
        <Loading label="Loading staff">
          <SkeletonList rows={3} aside="button" />
        </Loading>
      )}
      {staff.error && <LoadError error={staff.error} onRetry={staff.reload} />}
      {staff.data && staff.data.staff.length === 0 && (
        <div className="empty">
          <p>
            <strong>No one is assigned yet.</strong>
          </p>
          <p className="lede">Add an event manager first. They can bring in the rest of the crew.</p>
          {!adding && (
            <button className="btn" onClick={() => setAdding(true)}>
              Add staff
            </button>
          )}
        </div>
      )}
      {staff.data && staff.data.staff.length > 0 && (
        <div className="sheet-wrap">
          <table className="sheet sheet-stack">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {staff.data.staff.map((row) => (
                <tr key={row.assignmentId}>
                  <td>
                    <strong>{row.user.displayName}</strong>
                    <div className="field-hint">{row.user.email}</div>
                    {!row.user.hasPassword && (
                      <div className="field-hint">
                        Hasn't set a password yet.{' '}
                        <ActionButton className="btn-link" busyLabel="Sending…" onAction={() => resend(row)}>
                          Resend invite
                        </ActionButton>
                      </div>
                    )}
                  </td>
                  <td data-label="Role">
                    <label className="visually-hidden" htmlFor={`role-${row.assignmentId}`}>
                      Role for {row.user.displayName}
                    </label>
                    <select
                      id={`role-${row.assignmentId}`}
                      className="input input-compact"
                      value={`${row.role.key}|${row.activity?.id ?? ''}`}
                      onChange={(e) => void changeRole(row, e.target.value)}
                    >
                      {roleOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <ActionButton className="btn-link text-stop" busyLabel="Removing…" onAction={() => remove(row)}>
                      Remove<span className="visually-hidden"> {row.user.displayName}</span>
                    </ActionButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
      <form onSubmit={add} noValidate className="narrow panel">
        <h2>Add staff</h2>
        <div className="segmented section-gap-sm" role="group" aria-label="Who are you adding?">
          <button type="button" aria-pressed={mode === 'existing'} onClick={() => setMode('existing')}>
            Has an account
          </button>
          <button type="button" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>
            Someone new
          </button>
        </div>
        {mode === 'existing' ? (
          <div className="field section-gap-sm">
            {picked ? (
              <div className="picked">
                <span className="list-main">
                  <strong>{picked.displayName}</strong>
                  <span>{picked.email}</span>
                </span>
                <button type="button" className="btn-link" onClick={() => setPicked(null)}>
                  Choose someone else
                </button>
              </div>
            ) : (
              <>
                <label htmlFor="staff-search">Find a person</label>
                <input
                  id="staff-search"
                  className="input"
                  type="search"
                  autoComplete="off"
                  placeholder="Name or email, even one letter"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {people.data ? (
                  <PersonResults people={people.data.people} query={query} onPick={setPicked} />
                ) : (
                  <Loading label="Loading accounts">
                    <SkeletonList rows={3} aside="tag" />
                  </Loading>
                )}
                <span className="field-hint">
                  Not listed?{' '}
                  <button type="button" className="btn-link" onClick={() => setMode('new')}>
                    Add someone new
                  </button>
                  .
                </span>
              </>
            )}
          </div>
        ) : (
          <div className="section-gap-sm">
            <Field id="staff-name" label="Name" error={errors.displayName}>
              <input id="staff-name" className="input" autoComplete="off" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </Field>
            <Field
              id="staff-email"
              label="Email address"
              hint="We'll email them a link to set their password. If they already have an account, they're just added."
              error={errors.email}
            >
              <input id="staff-email" className="input" type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          </div>
        )}
        <fieldset className="fieldset-plain">
          <legend className="field-legend">What will they do?</legend>
          <div className="role-pick">
            {roles.data?.roles.map((r) => (
              <label key={r.key} className={form.roleKey === r.key ? 'role-option is-on' : 'role-option'}>
                <input type="radio" name="staff-role" value={r.key} checked={form.roleKey === r.key} onChange={() => setForm({ ...form, roleKey: r.key })} />
                <strong>{r.name}</strong>
                <span>{r.description}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {selectedRole?.scope === 'activity' && (
          <Field id="staff-activity" label="Activity" hint="Leaders only see and scan the activity you choose.">
            <select
              id="staff-activity"
              className="input"
              value={form.activityId}
              onChange={(e) => setForm({ ...form, activityId: e.target.value })}
            >
              <option value="">All activities</option>
              {activities.data?.activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="actions">
          <button className="btn" disabled={busy || (mode === 'existing' ? !picked : !form.email || !form.displayName)}>
            {busy ? 'Adding…' : 'Add staff'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      </form>
      )}
    </>
  );
}

function PersonResults({ people, query, onPick }: { people: Person[]; query: string; onPick: (p: Person) => void }) {
  const q = query.trim();
  const matches = (q ? people.filter((p) => matchesSearch(q, p.displayName, p.email)) : [...people])
    .sort((a, b) => (q ? searchRank(q, a.displayName) - searchRank(q, b.displayName) : 0) || a.displayName.localeCompare(b.displayName))
    .slice(0, 8);
  if (people.length === 0) return <p className="field-hint">Everyone with an account is already on this event.</p>;
  if (matches.length === 0) return <p className="field-hint">No one matches "{q}".</p>;
  return (
    <ul className="list section-gap-sm">
      {matches.map((p) => (
        <li key={p.id}>
          <button type="button" className="list-row list-button" onClick={() => onPick(p)}>
            <span className="list-main">
              <strong>{p.displayName}</strong>
              <span>{p.email}</span>
            </span>
            <span className="list-add">Choose</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
