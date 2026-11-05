import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { deleteContext } from '../confirmDelete';
import type { Meal } from '../model';
import { useApi } from '../useApi';
import { clockInZone, dayInZone, dayLabel, eventDays, inferDay, timeInZone, todayInZone, weekdayName, zonedIso } from '../../shared/time';
import {
  Badge,
  Button,
  EmptyState,
  Field,
  FilterTabs,
  Icon,
  LoadError,
  Loading,
  Menu,
  PageHeader,
  Sheet,
  SkeletonHeader,
  SkeletonRows,
  useConfirm,
  useToast,
} from '../ui';
import { useEvent } from './EventLayout';

/** The standard meals of a camp day, with their usual times. */
const DAY_MEALS = [
  { kind: 'breakfast', start: '07:30', end: '08:30' },
  { kind: 'lunch', start: '12:00', end: '13:00' },
  { kind: 'dinner', start: '17:30', end: '18:30' },
] as const;

/** Breakfast, lunch, dinner, then anything else, for meals without a time. */
const mealOrder = (name: string) => {
  const i = DAY_MEALS.findIndex((k) => name.toLowerCase().includes(k.kind));
  return i < 0 ? DAY_MEALS.length : i;
};

interface LiveContext {
  key: string;
  people: number;
  expected: number | null;
}

/** Meals: each meal to count, by day, with how many have been served. */
export function Meals() {
  const { event, can } = useEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi<{ meals: Meal[] }>(`/events/${event.id}/meals`);
  const live = useApi<{ contexts: LiveContext[] }>(can('reports.view') && event.status !== 'draft' ? `/events/${event.id}/live` : null);
  const days = eventDays(event.startsOn, event.endsOn);
  const tz = event.timezone;
  const today = todayInZone(tz);
  const [day, setDay] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'day' | 'one' | null>(null);
  const [editing, setEditing] = useState<Meal | null>(null);
  const manage = can('meals.manage') && (event.status === 'draft' || event.status === 'open');

  const fail = (err: unknown) => toast(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.', { tone: 'error' });

  async function patch(id: string, body: object): Promise<boolean> {
    try {
      await api(`/events/${event.id}/meals/${id}`, { method: 'PATCH', body });
      await reload();
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  }

  if (loading && !data)
    return (
      <Loading what="meals">
        <SkeletonHeader />
        <SkeletonRows rows={6} />
      </Loading>
    );
  if (error)
    return (
      <>
        <PageHeader title="Meals" />
        <LoadError error={error} onRetry={reload} what="meals" />
      </>
    );
  const meals = data?.meals ?? [];
  const mealDay = (m: Meal) => (m.startsAt ? dayInZone(m.startsAt, tz) : inferDay(m.name, days));
  const noDay = meals.filter((m) => !days.includes(mealDay(m) ?? ''));
  const usedDays = days.filter((d) => meals.some((m) => mealDay(m) === d));
  const tabs = [...days.map((d) => ({ value: d, label: d === today ? `Today, ${dayLabel(d)}` : dayLabel(d) })), ...(noDay.length ? [{ value: 'none', label: 'No day set' }] : [])];
  const shownDay = day ?? (days.includes(today) ? today : (usedDays[0] ?? days[0] ?? 'none'));
  const shown = (shownDay === 'none' ? noDay : meals.filter((m) => mealDay(m) === shownDay)).sort(
    (x, y) => (x.startsAt ?? '').localeCompare(y.startsAt ?? '') || mealOrder(x.name) - mealOrder(y.name),
  );
  const served = (m: Meal) => live.data?.contexts.find((c) => c.key === `meal:${m.id}`);
  const active = meals.filter((m) => m.status === 'active').length;

  return (
    <>
      <PageHeader
        title="Meals"
        summary={meals.length > 0 ? `${active} ${active === 1 ? 'meal' : 'meals'}` : undefined}
        primary={
          manage && (
            <Button kind="primary" onClick={() => setSheet('day')}>
              <Icon name="plus" />
              Add a day of meals
            </Button>
          )
        }
        menu={manage ? [{ label: 'Add a single meal', onSelect: () => setSheet('one') }] : undefined}
      />
      <div className="sections">
        {meals.length === 0 ? (
          <EmptyState
            title="No meals yet"
            actions={
              manage && (
                <Button kind="primary" onClick={() => setSheet('day')}>
                  Add a day of meals
                </Button>
              )
            }
          >
            Add each meal you want to count. Scanners pick them by day.
          </EmptyState>
        ) : (
          <>
            {tabs.length > 1 && <FilterTabs label="Day" value={shownDay} onChange={setDay} options={tabs} />}
            {shown.length === 0 ? (
              <EmptyState
                title={`No meals on ${shownDay === 'none' ? 'no day' : dayLabel(shownDay, 'long')}`}
                actions={
                  manage && (
                    <Button
                      onClick={() => {
                        setSheet('day');
                      }}
                    >
                      Add a day of meals
                    </Button>
                  )
                }
              />
            ) : (
              <ul className="list">
                {shown.map((m) => {
                  const s = served(m);
                  return (
                    <li key={m.id} className={m.status === 'cancelled' ? 'row is-muted' : 'row'}>
                      <span className="meal-time num">{m.startsAt ? timeInZone(m.startsAt, tz) : 'No time'}</span>
                      <span className="row-main">
                        <span className="row-title">{m.name}</span>
                        <span className="row-meta">
                          {[m.location || null, s && s.expected ? `${s.people} of ${s.expected} served` : s ? `${s.people} served` : null].filter(Boolean).join(' · ') ||
                            (!m.startsAt && !mealDay(m) ? 'Give it a day so scanners can find it' : '')}
                        </span>
                        {m.status === 'cancelled' && (
                          <span>
                            <Badge>Cancelled</Badge>
                          </span>
                        )}
                      </span>
                      {manage && (
                        <span className="row-side">
                          <Menu
                            label={`More actions for ${m.name}`}
                            items={[
                              { label: 'Edit meal', onSelect: () => setEditing(m) },
                              m.status === 'active'
                                ? {
                                    label: 'Cancel meal',
                                    onSelect: async () => {
                                      if (await patch(m.id, { status: 'cancelled' })) toast(`${m.name} cancelled`, { undo: () => patch(m.id, { status: 'active' }) });
                                    },
                                  }
                                : {
                                    label: 'Restore meal',
                                    onSelect: async () => {
                                      if (await patch(m.id, { status: 'active' })) toast(`${m.name} restored`);
                                    },
                                  },
                              {
                                label: 'Delete meal…',
                                danger: true,
                                onSelect: async () => {
                                  try {
                                    if (await deleteContext(confirm, event.id, 'meals', m.id, m.name)) {
                                      toast(`Deleted ${m.name}`);
                                      await reload();
                                    }
                                  } catch (err) {
                                    fail(err);
                                  }
                                },
                              },
                            ]}
                          />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      <Sheet open={sheet === 'day'} title="Add a day of meals" onClose={() => setSheet(null)}>
        {sheet === 'day' && (
          <AddDay
            meals={meals}
            mealDay={mealDay}
            initialDay={shownDay !== 'none' ? shownDay : (days[0] ?? event.startsOn)}
            onDone={async (added, onDay) => {
              setSheet(null);
              if (added > 0) {
                setDay(onDay);
                await reload();
                toast(`Added ${added} ${added === 1 ? 'meal' : 'meals'}`);
              } else toast('That day already has breakfast, lunch and dinner');
            }}
          />
        )}
      </Sheet>
      <Sheet open={sheet === 'one'} title="Add a meal" onClose={() => setSheet(null)}>
        {sheet === 'one' && (
          <MealForm
            initialDay={shownDay !== 'none' ? shownDay : (days[0] ?? event.startsOn)}
            submitLabel="Add meal"
            onCancel={() => setSheet(null)}
            onSubmit={async (body) => {
              await api(`/events/${event.id}/meals`, { body });
              setSheet(null);
              await reload();
              toast(`Added ${body.name}`);
            }}
          />
        )}
      </Sheet>
      <Sheet open={editing !== null} title="Edit meal" onClose={() => setEditing(null)}>
        {editing && (
          <MealForm
            meal={editing}
            initialDay={mealDay(editing) ?? days[0] ?? event.startsOn}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            onSubmit={async (body) => {
              await api(`/events/${event.id}/meals/${editing.id}`, { method: 'PATCH', body });
              setEditing(null);
              await reload();
              toast('Changes saved');
            }}
          />
        )}
      </Sheet>
    </>
  );
}

/** Pick a day: breakfast, lunch and dinner are added in one go (any already there are skipped). */
function AddDay({
  meals,
  mealDay,
  initialDay,
  onDone,
}: {
  meals: Meal[];
  mealDay: (m: Meal) => string | null;
  initialDay: string;
  onDone: (added: number, day: string) => Promise<void>;
}) {
  const { event } = useEvent();
  const tz = event.timezone;
  const days = eventDays(event.startsOn, event.endsOn);
  const [day, setDay] = useState(initialDay);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const existing = meals.filter((m) => mealDay(m) === day && m.status === 'active').map((m) => m.name.toLowerCase());
  const todo = DAY_MEALS.filter((k) => !existing.some((n) => n.includes(k.kind)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    let added = 0;
    try {
      for (const k of todo) {
        await api(`/events/${event.id}/meals`, {
          body: { name: `${weekdayName(day)} ${k.kind}`, startsAt: zonedIso(day, k.start, tz), endsAt: zonedIso(day, k.end, tz) },
        });
        added++;
      }
      await onDone(added, day);
    } catch (err) {
      setFailure(`${err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.'}${added ? ` ${added} were added before this.` : ''}`);
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {failure && (
        <p className="field-error" role="alert">
          <Icon name="error" size={16} />
          {failure}
        </p>
      )}
      <Field id="day-meals-day" label="Day">
        <select className="select" value={day} onChange={(e) => setDay(e.target.value)}>
          {days.map((d) => (
            <option key={d} value={d}>
              {dayLabel(d, 'long')}
            </option>
          ))}
        </select>
      </Field>
      <p className="meta">
        {todo.length === 0
          ? 'This day already has breakfast, lunch and dinner.'
          : `Adds ${todo.map((k) => `${k.kind} (${k.start})`).join(', ')}. You can change the times afterwards.`}
      </p>
      <div className="btn-row">
        <Button type="submit" kind="primary" disabled={todo.length === 0} busy={busy} busyLabel="Adding…">
          Add {todo.length || ''} {todo.length === 1 ? 'meal' : 'meals'}
        </Button>
      </div>
    </form>
  );
}

/** Name, day and time for one meal: adding one, or editing one. */
function MealForm({
  meal,
  initialDay,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  meal?: Meal;
  initialDay: string;
  submitLabel: string;
  onSubmit: (body: { name: string; location: string; startsAt: string; endsAt: string | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const { event } = useEvent();
  const tz = event.timezone;
  const days = eventDays(event.startsOn, event.endsOn);
  const [name, setName] = useState(meal?.name ?? '');
  const [day, setDay] = useState(initialDay);
  const [start, setStart] = useState(meal?.startsAt ? clockInZone(meal.startsAt, tz) : '12:00');
  const [end, setEnd] = useState(meal?.endsAt ? clockInZone(meal.endsAt, tz) : '');
  const [location, setLocation] = useState(meal?.location ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = 'Enter a name, like Saturday lunch';
    if (!start) found.start = 'Choose a start time';
    if (end && start && end <= start) found.end = 'The end must be after the start';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailure(null);
    try {
      await onSubmit({ name: name.trim(), location: location.trim(), startsAt: zonedIso(day, start, tz), endsAt: end ? zonedIso(day, end, tz) : null });
    } catch (err) {
      if (err instanceof ApiFailure) {
        setErrors(err.fieldErrors());
        setFailure(err.message);
      } else setFailure('No connection. Check your signal and try again.');
      setBusy(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {failure && (
        <p className="field-error" role="alert">
          <Icon name="error" size={16} />
          {failure}
        </p>
      )}
      <Field id="meal-name" label="Name" hint="For example, Saturday lunch or Morning tea" error={errors.name}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="meal-day" label="Day">
        <select className="select" value={day} onChange={(e) => setDay(e.target.value)}>
          {days.map((d) => (
            <option key={d} value={d}>
              {dayLabel(d, 'long')}
            </option>
          ))}
        </select>
      </Field>
      <div className="field-pair">
        <Field id="meal-start" label="Starts" error={errors.start}>
          <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field id="meal-end" label="Ends" optional error={errors.end ?? errors.endsAt}>
          <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      <Field id="meal-location" label="Place" optional>
        <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} autoComplete="off" />
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
