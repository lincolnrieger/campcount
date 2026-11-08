import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { matchesSearch, searchRank } from '../../shared/search';
import { clockInZone, dayInZone, dayLabel, eventDays, timeRange, zonedIso } from '../../shared/time';
import { ApiFailure, api } from '../api';
import type { TeamEvent } from '../model';
import { useApi } from '../useApi';
import {
  Badge,
  Button,
  Choice,
  EmptyState,
  ErrorSummary,
  Field,
  Icon,
  LoadError,
  Loading,
  Menu,
  Notice,
  PageHeader,
  SearchField,
  Section,
  Sheet,
  SkeletonRows,
  plural,
  useConfirm,
  useToast,
} from '../ui';
import { useEvent } from './EventLayout';

const fail = (err: unknown) => (err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');

/** "Teams of 5 to 11", "Teams of 5 or more", "Any size". */
export function sizeRule(te: Pick<TeamEvent, 'minSize' | 'maxSize'>): string {
  if (te.maxSize !== null && te.maxSize === te.minSize) return `Teams of ${te.minSize}`;
  if (te.maxSize !== null) return `Teams of ${te.minSize} to ${te.maxSize}`;
  return te.minSize > 1 ? `Teams of ${te.minSize} or more` : 'Any team size';
}

/** How a team stands against the event's limits. */
function teamState(size: number, te: Pick<TeamEvent, 'minSize' | 'maxSize'>) {
  if (size < te.minSize) return { tone: 'warning' as const, text: `Needs ${te.minSize - size} more` };
  if (te.maxSize !== null && size >= te.maxSize) return { tone: 'neutral' as const, text: 'Full' };
  return { tone: 'success' as const, text: 'Ready' };
}

function when(te: TeamEvent, tz: string): string {
  return te.startsAt ? `${dayLabel(dayInZone(te.startsAt, tz))}, ${timeRange(te.startsAt, te.endsAt, tz)}` : 'No set time';
}

/** Teams tab: the team events (Soccer, Basketball…) and how full each is. */
export function TeamEvents() {
  const { event, can } = useEvent();
  const { data, error, loading, reload } = useApi<{ teamEvents: TeamEvent[]; canManage: boolean }>(`/events/${event.id}/team-events`);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const editable = can('activities.manage') && (event.status === 'draft' || event.status === 'open');
  const add = editable && (
    <Button kind="primary" onClick={() => setAdding(true)}>
      Add team event
    </Button>
  );
  const header = <PageHeader title="Teams" summary="Events people enter as a team, like soccer or basketball. Participants make and join teams from their lanyard link or the sign-up kiosk." primary={add} />;

  let body;
  if (loading && !data)
    body = (
      <Loading what="team events">
        <SkeletonRows rows={4} />
      </Loading>
    );
  else if (error) body = <LoadError error={error} onRetry={reload} what="team events" />;
  else if (!data || data.teamEvents.length === 0)
    body = (
      <EmptyState title="No team events yet" actions={add}>
        Add one for each sport or game. Set how many people a team needs, then open registration when you're ready.
      </EmptyState>
    );
  else
    body = (
      <ul className="list">
        {data.teamEvents.map((te) => {
          const people = te.teams.reduce((n, t) => n + t.members.length, 0);
          const short = te.teams.filter((t) => t.members.length < te.minSize).length;
          return (
            <li key={te.id} className="row row-large row-link">
              <span className="row-main">
                <span className="row-title">
                  <Link to={te.id}>{te.name}</Link>
                </span>
                <span className="row-meta">
                  {[when(te, event.timezone), te.location, sizeRule(te)].filter(Boolean).join(' · ')}
                </span>
                <span className="row-meta">
                  {plural(te.teams.length, 'team')}
                  {te.maxTeams !== null ? ` of ${te.maxTeams}` : ''} · {plural(people, 'person', 'people')}
                  {short > 0 ? ` · ${short} short of players` : ''}
                </span>
              </span>
              {te.status === 'cancelled' ? <Badge>Cancelled</Badge> : <Badge tone={te.registrationOpen ? 'success' : 'neutral'}>{te.registrationOpen ? 'Registration open' : 'Registration closed'}</Badge>}
              <span className="row-chevron">
                <Icon name="chevron" />
              </span>
            </li>
          );
        })}
      </ul>
    );

  return (
    <>
      {header}
      {body}
      <Sheet open={adding} title="Add team event" onClose={() => setAdding(false)}>
        {adding && (
          <TeamEventForm
            submitLabel="Add team event"
            onCancel={() => setAdding(false)}
            onSave={async (body) => {
              const { id } = await api<{ id: string }>(`/events/${event.id}/team-events`, { body });
              navigate(id);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

interface FormState {
  name: string;
  location: string;
  description: string;
  day: string;
  start: string;
  end: string;
  minSize: string;
  maxSize: string;
  maxTeams: string;
  registrationOpen: boolean;
}

type TeamEventBody = {
  name: string;
  location: string;
  description: string;
  startsAt: string | null;
  endsAt: string | null;
  minSize: number;
  maxSize: number | null;
  maxTeams: number | null;
  registrationOpen: boolean;
};

/** Name, time and place, team sizes, and whether registration is open. */
function TeamEventForm({ initial, submitLabel, onSave, onCancel }: { initial?: TeamEvent; submitLabel: string; onSave: (body: TeamEventBody) => Promise<void>; onCancel: () => void }) {
  const { event } = useEvent();
  const tz = event.timezone;
  const days = eventDays(event.startsOn, event.endsOn);
  const [form, setForm] = useState<FormState>({
    name: initial?.name ?? '',
    location: initial?.location ?? '',
    description: initial?.description ?? '',
    day: initial?.startsAt ? dayInZone(initial.startsAt, tz) : '',
    start: initial?.startsAt ? clockInZone(initial.startsAt, tz) : '14:00',
    end: initial?.endsAt ? clockInZone(initial.endsAt, tz) : '16:00',
    minSize: String(initial?.minSize ?? 1),
    maxSize: initial?.maxSize ? String(initial.maxSize) : '',
    maxTeams: initial?.maxTeams ? String(initial.maxTeams) : '',
    registrationOpen: initial?.registrationOpen ?? false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 3);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    const min = Number(form.minSize || '1');
    const max = form.maxSize ? Number(form.maxSize) : null;
    if (!form.name.trim()) local['te-name'] = 'Enter a name, like Soccer';
    if (min < 1) local['te-min'] = 'A team needs at least 1 person';
    if (max !== null && max < min) local['te-max'] = 'Must be at least the fewest per team';
    if (form.maxTeams && Number(form.maxTeams) < 1) local['te-teams'] = 'Leave blank for no limit';
    if (form.day && form.end && form.end <= form.start) local['te-end'] = 'The end must be after the start';
    setErrors(local);
    setFailure(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await onSave({
        name: form.name.trim(),
        location: form.location.trim(),
        description: form.description.trim(),
        startsAt: form.day ? zonedIso(form.day, form.start, tz) : null,
        endsAt: form.day && form.end ? zonedIso(form.day, form.end, tz) : null,
        minSize: min,
        maxSize: max,
        maxTeams: form.maxTeams ? Number(form.maxTeams) : null,
        registrationOpen: form.registrationOpen,
      });
    } catch (err) {
      setFailure(fail(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <ErrorSummary errors={Object.entries(errors).map(([id, message]) => ({ id, message }))} />
      {failure && (
        <Notice tone="error">
          <p>{failure}</p>
        </Notice>
      )}
      <Field id="te-name" label="Name" error={errors['te-name']}>
        <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="off" />
      </Field>
      <Field id="te-day" label="Day">
        <select className="select" value={form.day} onChange={(e) => set('day', e.target.value)}>
          <option value="">No set time</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {dayLabel(d, 'long')}
            </option>
          ))}
        </select>
      </Field>
      {form.day && (
        <div className="field-pair">
          <Field id="te-start" label="Start">
            <input className="input" type="time" value={form.start} onChange={(e) => set('start', e.target.value)} />
          </Field>
          <Field id="te-end" label="End" optional error={errors['te-end']}>
            <input className="input" type="time" value={form.end} onChange={(e) => set('end', e.target.value)} />
          </Field>
        </div>
      )}
      <Field id="te-place" label="Place" optional>
        <input className="input" value={form.location} onChange={(e) => set('location', e.target.value)} autoComplete="off" />
      </Field>
      <div className="field-pair">
        <Field id="te-min" label="Fewest per team" hint="Teams under this show as short." error={errors['te-min']}>
          <input className="input" inputMode="numeric" value={form.minSize} onChange={(e) => set('minSize', digits(e.target.value))} />
        </Field>
        <Field id="te-max" label="Most per team" optional hint="Blank for no limit." error={errors['te-max']}>
          <input className="input" inputMode="numeric" value={form.maxSize} onChange={(e) => set('maxSize', digits(e.target.value))} />
        </Field>
      </div>
      <Field id="te-teams" label="Most teams" optional hint="Blank for no limit." error={errors['te-teams']}>
        <input className="input activity-capacity" inputMode="numeric" value={form.maxTeams} onChange={(e) => set('maxTeams', digits(e.target.value))} />
      </Field>
      <Field id="te-notes" label="Notes for participants" optional>
        <textarea className="textarea" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <fieldset className="choices">
        <legend className="visually-hidden">Registration</legend>
        <Choice
          label="Registration open"
          description="Participants can make a team or join one from their lanyard link and the sign-up kiosk. Close it to lock the teams."
          checked={form.registrationOpen}
          onChange={(e) => set('registrationOpen', e.target.checked)}
        />
      </fieldset>
      <div className="btn-row">
        <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…">
          {submitLabel}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

type Panel = { kind: 'edit' } | { kind: 'team'; teamId: string | null; name: string } | { kind: 'add'; teamId: string } | null;

/** One team event: its teams and who's on them. Event managers and its own leaders can change the teams. */
export function TeamEventPage() {
  const { event, can, base } = useEvent();
  const { teamEventId } = useParams() as { teamEventId: string };
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<{ teamEvents: TeamEvent[]; canManage: boolean }>(`/events/${event.id}/team-events`);
  const roster = useApi<{ everyone: { id: string; name: string; groupName: string }[] }>(`/events/${event.id}/activities/${teamEventId}/attendance`);
  const [panel, setPanel] = useState<Panel>(null);
  const manager = can('activities.manage');
  const editable = event.status === 'draft' || event.status === 'open';
  const back = manager ? { to: `${base}/teams`, label: 'Teams' } : { to: `${base}/activities/${teamEventId}`, label: 'Check-ins' };
  const te = data?.teamEvents.find((t) => t.id === teamEventId);

  if (loading && !data)
    return (
      <>
        <PageHeader title="Team event" back={back} />
        <Loading what="teams">
          <SkeletonRows rows={5} />
        </Loading>
      </>
    );
  if (error)
    return (
      <>
        <PageHeader title="Team event" back={back} />
        <LoadError error={error} onRetry={reload} what="teams" />
      </>
    );
  if (!te)
    return (
      <>
        <PageHeader title="Team event" back={back} />
        <Notice tone="error">
          <p>This team event has been deleted.</p>
        </Notice>
      </>
    );

  const path = `/events/${event.id}`;
  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      toast(done);
      await reload();
    } catch (err) {
      toast(fail(err), { tone: 'error' });
    }
  };
  const onTeam = new Set(te.teams.flatMap((t) => t.members.map((m) => m.registrationId)));
  const people = te.teams.reduce((n, t) => n + t.members.length, 0);
  const full = te.maxTeams !== null && te.teams.length >= te.maxTeams;

  return (
    <>
      <PageHeader
        title={te.name}
        back={back}
        summary={[when(te, event.timezone), te.location, sizeRule(te), te.maxTeams !== null ? `up to ${plural(te.maxTeams, 'team')}` : null].filter(Boolean).join(' · ')}
        primary={
          editable && (
            <Button kind="primary" disabled={full} onClick={() => setPanel({ kind: 'team', teamId: null, name: '' })}>
              <Icon name="plus" />
              Add team
            </Button>
          )
        }
        menu={[
          { label: 'Check-ins', to: `${base}/activities/${te.id}` },
          manager && editable && { label: 'Edit settings', onSelect: () => setPanel({ kind: 'edit' }) },
          manager &&
            editable && {
              label: 'Delete team event…',
              danger: true,
              onSelect: async () => {
                const ok = await confirm({
                  title: `Delete ${te.name}?`,
                  body: <p>Its {plural(te.teams.length, 'team')} and any check-ins go with it. This can't be undone.</p>,
                  confirm: 'Delete team event',
                  danger: true,
                });
                if (!ok) return;
                try {
                  await api(`${path}/activities/${te.id}`, { method: 'DELETE' });
                  toast(`${te.name} deleted`);
                  navigate(`${base}/teams`);
                } catch (err) {
                  toast(fail(err), { tone: 'error' });
                }
              },
            },
        ]}
        menuLabel={`More actions for ${te.name}`}
      />
      <div className="sections">
        <div className={te.registrationOpen ? 'team-rego is-open' : 'team-rego'}>
          <p>
            <strong>Registration {te.registrationOpen ? 'open' : 'closed'}.</strong>{' '}
            {te.registrationOpen ? 'Participants can make and join teams.' : 'Only the event team can change teams.'} {plural(te.teams.length, 'team')}, {plural(people, 'person', 'people')}.
          </p>
          {manager && editable && (
            <Button
              small
              busyLabel="Saving…"
              onAction={() => act(() => api(`${path}/team-events/${te.id}`, { method: 'PATCH', body: { registrationOpen: !te.registrationOpen } }), te.registrationOpen ? 'Registration closed' : 'Registration open')}
            >
              {te.registrationOpen ? 'Close registration' : 'Open registration'}
            </Button>
          )}
        </div>

        {te.teams.length === 0 ? (
          <EmptyState title="No teams yet">{te.registrationOpen ? 'Teams appear here as participants make them. You can add teams too.' : 'Add teams here, or open registration so participants can make their own.'}</EmptyState>
        ) : (
          <div className="team-grid">
            {te.teams.map((t) => {
              const st = teamState(t.members.length, te);
              return (
                <Section
                  key={t.id}
                  id={`team-${t.id}`}
                  level={2}
                  title={
                    <>
                      {t.name} <span className="team-count num">{te.maxSize !== null ? `${t.members.length}/${te.maxSize}` : t.members.length}</span>
                    </>
                  }
                  actions={
                    <span className="team-actions">
                      <Badge tone={st.tone}>{st.text}</Badge>
                      {editable && (
                        <Menu
                          label={`More actions for ${t.name}`}
                          items={[
                            !(te.maxSize !== null && t.members.length >= te.maxSize) && { label: 'Add person', onSelect: () => setPanel({ kind: 'add', teamId: t.id }) },
                            { label: 'Rename team', onSelect: () => setPanel({ kind: 'team', teamId: t.id, name: t.name }) },
                            {
                              label: 'Delete team…',
                              danger: true,
                              onSelect: async () => {
                                const ok = await confirm({
                                  title: `Delete ${t.name}?`,
                                  body: <p>{t.members.length ? `Its ${plural(t.members.length, 'person', 'people')} come off the team and off ${te.name}'s bookings.` : 'It has nobody on it.'}</p>,
                                  confirm: 'Delete team',
                                  danger: true,
                                });
                                if (ok) await act(() => api(`${path}/teams/${t.id}`, { method: 'DELETE' }), `${t.name} deleted`);
                              },
                            },
                          ]}
                        />
                      )}
                    </span>
                  }
                >
                  {t.members.length === 0 ? (
                    <p className="meta">Nobody yet.</p>
                  ) : (
                    <ul className="list">
                      {t.members.map((m) => (
                        <li key={m.registrationId} className="row">
                          <span className="row-main">
                            <span className="row-title">{m.name}</span>
                            <span className="row-meta">{[m.section, m.groupName].filter(Boolean).join(' · ')}</span>
                          </span>
                          {editable && (
                            <span className="row-side">
                              <Button
                                small
                                kind="ghost"
                                aria-label={`Take ${m.name} off ${t.name}`}
                                busyLabel="Removing…"
                                onAction={() => act(() => api(`${path}/teams/${t.id}/members/${m.registrationId}`, { method: 'DELETE' }), `${m.name} taken off ${t.name}`)}
                              >
                                Remove
                              </Button>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {editable && !(te.maxSize !== null && t.members.length >= te.maxSize) && (
                    <div>
                      <Button small kind="ghost" onClick={() => setPanel({ kind: 'add', teamId: t.id })}>
                        <Icon name="plus" />
                        Add person
                      </Button>
                    </div>
                  )}
                </Section>
              );
            })}
          </div>
        )}
      </div>

      <Sheet open={panel?.kind === 'edit'} title="Edit settings" onClose={() => setPanel(null)}>
        {panel?.kind === 'edit' && (
          <TeamEventForm
            initial={te}
            submitLabel="Save changes"
            onCancel={() => setPanel(null)}
            onSave={async (body) => {
              await api(`${path}/team-events/${te.id}`, { method: 'PATCH', body });
              toast('Changes saved');
              setPanel(null);
              await reload();
            }}
          />
        )}
      </Sheet>
      <Sheet open={panel?.kind === 'team'} title={panel?.kind === 'team' && panel.teamId ? 'Rename team' : 'Add team'} onClose={() => setPanel(null)}>
        {panel?.kind === 'team' && (
          <TeamNameForm
            initial={panel.name}
            submitLabel={panel.teamId ? 'Save' : 'Add team'}
            onCancel={() => setPanel(null)}
            onSave={async (name) => {
              if (panel.teamId) await api(`${path}/teams/${panel.teamId}`, { method: 'PATCH', body: { name } });
              else await api(`${path}/team-events/${te.id}/teams`, { body: { name } });
              toast(panel.teamId ? 'Team renamed' : `${name} added`);
              setPanel(null);
              await reload();
            }}
          />
        )}
      </Sheet>
      <Sheet open={panel?.kind === 'add'} title={`Add to ${te.teams.find((t) => panel?.kind === 'add' && t.id === panel.teamId)?.name ?? 'team'}`} onClose={() => setPanel(null)}>
        {panel?.kind === 'add' && (
          <PersonPicker
            everyone={roster.data?.everyone ?? null}
            onTeam={onTeam}
            onPick={async (p) => {
              const team = te.teams.find((t) => t.id === panel.teamId)!;
              const from = te.teams.find((t) => t.members.some((m) => m.registrationId === p.id));
              if (from && !(await confirm({ title: `Move ${p.name}?`, body: <p>They're on {from.name}. They'll move to {team.name}.</p>, confirm: 'Move' }))) return;
              setPanel(null);
              await act(() => api(`${path}/teams/${team.id}/members`, { body: { registrationId: p.id } }), `${p.name} added to ${team.name}`);
            }}
          />
        )}
      </Sheet>
    </>
  );
}

function TeamNameForm({ initial, submitLabel, onSave, onCancel }: { initial: string; submitLabel: string; onSave: (name: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return setError('Enter a team name');
        setBusy(true);
        setError(undefined);
        try {
          await onSave(name.trim());
        } catch (err) {
          setError(fail(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field id="team-name" label="Team name" error={error}>
        <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      <div className="btn-row">
        <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…">
          {submitLabel}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/** Search the event roster for someone to put on a team. */
function PersonPicker({ everyone, onTeam, onPick }: { everyone: { id: string; name: string; groupName: string }[] | null; onTeam: Set<string>; onPick: (p: { id: string; name: string }) => void }) {
  const [q, setQ] = useState('');
  if (!everyone) return <Loading what="people" rows={4} />;
  const matches = q.trim()
    ? everyone
        .filter((p) => matchesSearch(q, p.name))
        .sort((a, b) => searchRank(q, a.name) - searchRank(q, b.name) || a.name.localeCompare(b.name))
        .slice(0, 30)
    : [];
  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the sheet opens because they tapped Add person */}
      <SearchField id="team-person-q" label="Name" value={q} onChange={setQ} autoFocus />
      {q.trim() === '' ? (
        <p className="meta">Start typing a name.</p>
      ) : matches.length === 0 ? (
        <p className="meta">No one matches "{q}".</p>
      ) : (
        <ul className="list">
          {matches.map((p) => (
            <li key={p.id}>
              <button type="button" className="row row-button" onClick={() => onPick(p)}>
                <span className="row-main">
                  <span className="row-title">{p.name}</span>
                  <span className="row-meta">{p.groupName}</span>
                </span>
                {onTeam.has(p.id) && <Badge>On a team</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
