import { useState } from 'react';
import type { FormEvent } from 'react';
import { matchesSearch, searchRank } from '../../shared/search';
import { clockInZone, dayInZone, dayLabel, eventDays, timeRange, zonedIso } from '../../shared/time';
import { ApiFailure, api } from '../api';
import { useApi } from '../useApi';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  ErrorSummary,
  Field,
  FilterChips,
  Icon,
  LoadError,
  Loading,
  Menu,
  PageHeader,
  SearchField,
  Section,
  Segmented,
  Sheet,
  SkeletonRows,
  Toolbar,
  plural,
  useConfirm,
  useRemembered,
  useToast,
} from '../ui';
import { useEvent } from './EventLayout';

interface Duty {
  id: string;
  title: string;
  location: string;
  notes: string;
  startsAt: string;
  endsAt: string | null;
  people: { registrationId: string; name: string }[];
}
interface Rosterable {
  id: string;
  name: string;
  leader: boolean;
}

const fail = (err: unknown) => (err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');
const startMs = (d: Pick<Duty, 'startsAt'>) => Date.parse(d.startsAt);
const endMs = (d: Pick<Duty, 'startsAt' | 'endsAt'>) => (d.endsAt ? Date.parse(d.endsAt) : startMs(d) + 60 * 60_000);
const overlaps = (a: Duty, b: Duty) => a.id !== b.id && startMs(a) < endMs(b) && startMs(b) < endMs(a);

/** Each leader on a duty, with their duties and whether any overlap. */
function leadersOnDuty(duties: Duty[]) {
  const people = new Map<string, { id: string; name: string; duties: Duty[] }>();
  for (const d of duties)
    for (const p of d.people) {
      const e = people.get(p.registrationId) ?? { id: p.registrationId, name: p.name, duties: [] };
      e.duties.push(d);
      people.set(p.registrationId, e);
    }
  return [...people.values()].map((p) => ({ ...p, clash: p.duties.some((a) => p.duties.some((b) => overlaps(a, b))) })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Leader roster: duties (gate, kitchen, first aid…) and who is on each.
 * Each leader sees their own duties on the page their lanyard opens.
 */
export function LeaderRoster() {
  const { event, can } = useEvent();
  const tz = event.timezone;
  const path = `/events/${event.id}`;
  const { data, error, loading, reload } = useApi<{ duties: Duty[]; people: Rosterable[] }>(`${path}/duties`);
  const [panel, setPanel] = useState<{ kind: 'duty'; duty?: Duty } | { kind: 'add'; duty: Duty } | null>(null);
  const [view, setView] = useRemembered<'duties' | 'leaders'>(`duties:${event.id}:view`, 'duties');
  const [day, setDay] = useRemembered<string>(`duties:${event.id}:day`, 'all');
  const [query, setQuery] = useState('');
  const toast = useToast();
  const confirm = useConfirm();
  const editable = can('roster.edit') && (event.status === 'draft' || event.status === 'open');

  const act = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work();
      toast(done);
      await reload();
    } catch (err) {
      toast(fail(err), { tone: 'error' });
    }
  };

  const add = editable && (
    <Button kind="primary" onClick={() => setPanel({ kind: 'duty' })}>
      Add duty
    </Button>
  );
  const duties = data?.duties ?? [];
  const leaders = leadersOnDuty(duties);
  const clashes = leaders.filter((l) => l.clash);
  const empty = duties.filter((d) => d.people.length === 0).length;
  const header = (
    <PageHeader
      title="Leader roster"
      summary={
        duties.length > 0 && (
          <span>
            {plural(duties.length, 'duty', 'duties')} · {plural(leaders.length, 'leader')} rostered
            {empty > 0 && ` · ${empty} with nobody on`}
          </span>
        )
      }
      help="Duties like gate, kitchen or first aid, and who is on each. Leaders see their own duties, with the time and place, when they open their lanyard link."
      primary={add}
    />
  );

  let body;
  if (loading && !data)
    body = (
      <Loading what="the roster">
        <SkeletonRows rows={4} />
      </Loading>
    );
  else if (error) body = <LoadError error={error} onRetry={reload} what="the roster" />;
  else if (!data || data.duties.length === 0)
    body = (
      <EmptyState title="No duties yet" actions={add}>
        Add one for each job and time, like “Gate, Saturday 8 to 10 am”.
      </EmptyState>
    );
  else {
    const days = [...new Set(data.duties.map((d) => dayInZone(d.startsAt, tz)))];
    const dayShown = day === 'all' || days.includes(day) ? day : 'all';
    const matches = (d: Duty) => !query.trim() || matchesSearch(query, d.title, d.location, ...d.people.map((p) => p.name));
    const shownDuties = data.duties.filter((d) => (dayShown === 'all' || dayInZone(d.startsAt, tz) === dayShown) && matches(d));
    const byDuty =
      shownDuties.length === 0 ? (
        <EmptyState
          title="No duties match"
          actions={
            <Button
              onClick={() => {
                setQuery('');
                setDay('all');
              }}
            >
              Show all duties
            </Button>
          }
        />
      ) : (
        <div className="sections duty-days">
          {days
            .filter((dd) => shownDuties.some((d) => dayInZone(d.startsAt, tz) === dd))
            .map((dd) => (
              <Section key={dd} id={`day-${dd}`} title={dayLabel(dd, 'long')}>
                <div className="duty-grid">
                  {shownDuties
                    .filter((d) => dayInZone(d.startsAt, tz) === dd)
                    .map((d) => (
                      <article key={d.id} className={d.people.length ? 'duty-card' : 'duty-card is-empty'} aria-labelledby={`duty-${d.id}-heading`}>
                        <div className="duty-card-head">
                          <div className="duty-card-title">
                            <h3 id={`duty-${d.id}-heading`}>{d.title}</h3>
                            <p className="meta">{[timeRange(d.startsAt, d.endsAt, tz), d.location].filter(Boolean).join(' · ')}</p>
                          </div>
                          {editable && (
                            <Menu
                              label={`More actions for ${d.title}`}
                              items={[
                                { label: 'Add leader', onSelect: () => setPanel({ kind: 'add', duty: d }) },
                                { label: 'Edit duty', onSelect: () => setPanel({ kind: 'duty', duty: d }) },
                                {
                                  label: 'Delete duty…',
                                  danger: true,
                                  onSelect: async () => {
                                    const ok = await confirm({
                                      title: `Delete ${d.title}?`,
                                      body: <p>{d.people.length ? `It comes off the roster of ${plural(d.people.length, 'person', 'people')}.` : 'Nobody is on it.'}</p>,
                                      confirm: 'Delete duty',
                                      danger: true,
                                    });
                                    if (ok) await act(() => api(`${path}/duties/${d.id}`, { method: 'DELETE' }), `${d.title} deleted`);
                                  },
                                },
                              ]}
                            />
                          )}
                        </div>
                        {d.notes && <p className="duty-notes">{d.notes}</p>}
                        {d.people.length === 0 ? (
                          <p className="meta duty-nobody">Nobody on it yet</p>
                        ) : (
                          <ul className="duty-people">
                            {d.people.map((m) => (
                              <li key={m.registrationId}>
                                <span>{m.name}</span>
                                {clashes.some((c) => c.id === m.registrationId && c.duties.some((o) => overlaps(o, d))) && <Badge tone="warning">Clash</Badge>}
                                {editable && (
                                  <Button
                                    small
                                    kind="ghost"
                                    className="duty-remove"
                                    aria-label={`Take ${m.name} off ${d.title}`}
                                    title="Remove"
                                    busyLabel="…"
                                    onAction={() => act(() => api(`${path}/duties/${d.id}/people/${m.registrationId}`, { method: 'DELETE' }), `${m.name} taken off ${d.title}`)}
                                  >
                                    <Icon name="close" size={16} />
                                  </Button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {editable && (
                          <div>
                            <Button small kind="ghost" onClick={() => setPanel({ kind: 'add', duty: d })}>
                              <Icon name="plus" />
                              Add leader
                            </Button>
                          </div>
                        )}
                      </article>
                    ))}
                </div>
              </Section>
            ))}
        </div>
      );
    body = (
      <div className="section duty-section">
        {clashes.length > 0 && (
          <Banner
            tone="warning"
            action={
              view !== 'leaders' && (
                <Button small onClick={() => setView('leaders')}>
                  Show
                </Button>
              )
            }
          >
            {clashes.length === 1 ? `${clashes[0]!.name} is on two duties at once` : `${clashes.length} leaders are on two duties at once`}
          </Banner>
        )}
        <Toolbar sticky label="Roster view">
          <Segmented
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { value: 'duties', label: 'By duty' },
              { value: 'leaders', label: `By leader (${leaders.length})` },
            ]}
          />
          {view === 'duties' && <SearchField id="duty-q" label="Search duties, places or leaders" placeholder="Search duties or leaders" value={query} onChange={setQuery} slash />}
          {view === 'duties' && days.length > 1 && (
            <FilterChips
              label="Day"
              value={dayShown}
              onChange={setDay}
              options={[
                { value: 'all', label: 'All days', count: data.duties.length },
                ...days.map((dd) => ({ value: dd, label: dayLabel(dd), count: data.duties.filter((d) => dayInZone(d.startsAt, tz) === dd).length })),
              ]}
            />
          )}
        </Toolbar>
        {view === 'duties' ? byDuty : <ByLeader leaders={leaders} tz={tz} />}
      </div>
    );
  }

  const addTo = panel?.kind === 'add' ? panel.duty : null;
  return (
    <>
      {header}
      {body}
      <Sheet open={panel?.kind === 'duty'} title={panel?.kind === 'duty' && panel.duty ? 'Edit duty' : 'Add duty'} onClose={() => setPanel(null)}>
        {panel?.kind === 'duty' && (
          <DutyForm
            initial={panel.duty}
            submitLabel={panel.duty ? 'Save' : 'Add duty'}
            onCancel={() => setPanel(null)}
            onSave={async (body) => {
              if (panel.duty) await api(`${path}/duties/${panel.duty.id}`, { method: 'PATCH', body });
              else await api(`${path}/duties`, { body });
              toast(panel.duty ? 'Duty saved' : `${body.title} added`);
              setPanel(null);
              await reload();
            }}
          />
        )}
      </Sheet>
      <Sheet open={!!addTo} title={addTo ? `Add to ${addTo.title}` : 'Add leader'} onClose={() => setPanel(null)}>
        {addTo && data && (
          <LeaderPicker
            people={data.people}
            onDuty={new Set(addTo.people.map((p) => p.registrationId))}
            busy={new Set(data.duties.filter((d) => overlaps(d, addTo)).flatMap((d) => d.people.map((p) => p.registrationId)))}
            onPick={async (p) => {
              // Stay open, so several leaders can be added in a row.
              await act(() => api(`${path}/duties/${addTo.id}/people`, { body: { registrationId: p.id } }), `${p.name} added to ${addTo.title}`);
              setPanel((cur) => (cur?.kind === 'add' ? { kind: 'add', duty: { ...cur.duty, people: [...cur.duty.people, { registrationId: p.id, name: p.name }] } } : cur));
            }}
          />
        )}
      </Sheet>
    </>
  );
}

/** Each leader and their duties, for checking nobody is double-booked or left out. */
function ByLeader({ leaders, tz }: { leaders: ReturnType<typeof leadersOnDuty>; tz: string }) {
  if (leaders.length === 0) return <p className="meta">Nobody is on a duty yet.</p>;
  const sorted = [...leaders].sort((a, b) => Number(b.clash) - Number(a.clash) || a.name.localeCompare(b.name));
  return (
    <ul className="list duty-leaders">
      {sorted.map((p) => (
        <li key={p.id} className={p.clash ? 'row is-clash' : 'row'}>
          <span className="row-main">
            <span className="row-title">
              {p.name} <span className="meta">· {plural(p.duties.length, 'duty', 'duties')}</span>
            </span>
            {p.duties.map((d) => (
              <span key={d.id} className="row-meta">
                {dayLabel(dayInZone(d.startsAt, tz))}, {timeRange(d.startsAt, d.endsAt, tz)}: {d.title}
                {d.location ? ` · ${d.location}` : ''}
              </span>
            ))}
          </span>
          {p.clash && <Badge tone="warning">Clash</Badge>}
        </li>
      ))}
    </ul>
  );
}

type DutyBody = { title: string; location: string; notes: string; startsAt: string; endsAt: string | null };

function DutyForm({ initial, submitLabel, onSave, onCancel }: { initial?: Duty; submitLabel: string; onSave: (body: DutyBody) => Promise<void>; onCancel: () => void }) {
  const { event } = useEvent();
  const tz = event.timezone;
  const days = eventDays(event.startsOn, event.endsOn);
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    location: initial?.location ?? '',
    notes: initial?.notes ?? '',
    day: initial ? dayInZone(initial.startsAt, tz) : (days[0] ?? ''),
    start: initial ? clockInZone(initial.startsAt, tz) : '08:00',
    end: initial?.endsAt ? clockInZone(initial.endsAt, tz) : '10:00',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!form.title.trim()) local['duty-title'] = 'Enter what the duty is, like Gate';
    if (!form.day) local['duty-day'] = 'Choose a day';
    if (!form.start) local['duty-start'] = 'Enter a start time';
    if (form.end && form.end <= form.start) local['duty-end'] = 'The end must be after the start';
    setErrors(local);
    setFailure(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await onSave({
        title: form.title.trim(),
        location: form.location.trim(),
        notes: form.notes.trim(),
        startsAt: zonedIso(form.day, form.start, tz),
        endsAt: form.end ? zonedIso(form.day, form.end, tz) : null,
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
      {failure && <Banner tone="error">{failure}</Banner>}
      <Field id="duty-title" label="Duty" hint="Gate, Kitchen, First aid…" error={errors['duty-title']}>
        <input className="input" value={form.title} maxLength={80} onChange={(e) => set('title', e.target.value)} autoComplete="off" />
      </Field>
      <Field id="duty-day" label="Day" error={errors['duty-day']}>
        <select className="select" value={form.day} onChange={(e) => set('day', e.target.value)}>
          {days.map((d) => (
            <option key={d} value={d}>
              {dayLabel(d, 'long')}
            </option>
          ))}
        </select>
      </Field>
      <div className="field-pair">
        <Field id="duty-start" label="Start" error={errors['duty-start']}>
          <input className="input" type="time" value={form.start} onChange={(e) => set('start', e.target.value)} />
        </Field>
        <Field id="duty-end" label="End" optional error={errors['duty-end']}>
          <input className="input" type="time" value={form.end} onChange={(e) => set('end', e.target.value)} />
        </Field>
      </div>
      <Field id="duty-place" label="Where" optional>
        <input className="input" value={form.location} maxLength={120} onChange={(e) => set('location', e.target.value)} autoComplete="off" />
      </Field>
      <Field id="duty-notes" label="Notes for the leaders" optional hint="What to bring, who to report to">
        <textarea className="textarea" rows={2} maxLength={500} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
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

/** Leaders first; type to find anyone else. Shows who is already on it, or busy at that time. */
function LeaderPicker({ people, onDuty, busy, onPick }: { people: Rosterable[]; onDuty: Set<string>; busy: Set<string>; onPick: (p: Rosterable) => Promise<void> }) {
  const [q, setQ] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const list = q.trim()
    ? people
        .filter((p) => matchesSearch(q, p.name))
        .sort((a, b) => searchRank(q, a.name) - searchRank(q, b.name) || a.name.localeCompare(b.name))
        .slice(0, 40)
    : people.filter((p) => p.leader);
  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the sheet opens because they tapped Add leader */}
      <SearchField id="duty-person-q" label="Name" value={q} onChange={setQ} autoFocus />
      {list.length === 0 ? (
        <p className="meta">{q.trim() ? `No one matches "${q}".` : 'No leaders yet. Type a name to find anyone at camp.'}</p>
      ) : (
        <ul className="list">
          {list.map((p) => {
            const on = onDuty.has(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="row row-button"
                  disabled={on || working !== null}
                  onClick={async () => {
                    setWorking(p.id);
                    try {
                      await onPick(p);
                    } finally {
                      setWorking(null);
                    }
                  }}
                >
                  <span className="row-main">
                    <span className="row-title">{p.name}</span>
                  </span>
                  {on ? <Badge tone="success">On this duty</Badge> : busy.has(p.id) ? <Badge tone="warning">Busy then</Badge> : working === p.id ? <Badge>Adding…</Badge> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
