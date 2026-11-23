import { useState } from 'react';
import type { MealItem } from '../../shared/mealItems';
import { mealSummary } from '../../shared/mealItems';
import { MealItemsPanel } from './MealItemsPanel';
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
  FilterChips,
  Icon,
  InfoTip,
  LoadError,
  Loading,
  Menu,
  PageHeader,
  Segmented,
  Sheet,
  SkeletonHeader,
  SkeletonRows,
  Toolbar,
  useConfirm,
  useRemembered,
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
  const [day, setDay] = useRemembered<string | null>(`meals-day:${event.id}`, null);
  const [sheet, setSheet] = useState<'day' | 'one' | null>(null);
  const [editing, setEditing] = useState<Meal | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [duplicating, setDuplicating] = useState<Meal | null>(null);
  const [importing, setImporting] = useState(false);
  const itemsApi = useApi<{ items: MealItem[] }>(`/events/${event.id}/meal-items`);
  const allItems = itemsApi.data?.items ?? [];
  const refresh = async () => {
    await Promise.all([reload(), itemsApi.reload()]);
  };
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
  const tabs = [
    ...days.map((d) => ({ value: d, label: d === today ? `Today, ${dayLabel(d)}` : dayLabel(d), count: meals.filter((m) => mealDay(m) === d).length })),
    ...(noDay.length ? [{ value: 'none', label: 'No day set', count: noDay.length }] : []),
  ];
  const shownDay = day && tabs.some((t) => t.value === day) ? day : days.includes(today) ? today : (usedDays[0] ?? days[0] ?? 'none');
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
        help="Scanners pick meals by day. Open a meal to list what's served, with allergens and dietary alternatives."
        primary={
          manage && (
            <Button kind="primary" onClick={() => setSheet('day')}>
              <Icon name="plus" />
              Add a day of meals
            </Button>
          )
        }
        menu={
          manage
            ? [
                { label: 'Add a single meal', onSelect: () => setSheet('one') },
                { label: 'Import meals (JSON)', onSelect: () => setImporting(true) },
              ]
            : undefined
        }
      />
      <div className="sections pg-sections">
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
            Add each meal you want to count.
          </EmptyState>
        ) : (
          <>
            <Toolbar sticky label="Meals by day">
              {tabs.length > 1 && <FilterChips label="Day" value={shownDay} onChange={setDay} options={tabs} />}
              {shown.length > 0 && (
                <div className="toolbar-end">
                  <Button small kind="ghost" onClick={() => setExpanded(new Set(shown.map((m) => m.id)))}>
                    Expand all
                  </Button>
                  <Button small kind="ghost" onClick={() => setExpanded(new Set())}>
                    Collapse all
                  </Button>
                </div>
              )}
            </Toolbar>
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
              <ul className="list meal-cards">
                {shown.map((m) => {
                  const s = served(m);
                  const items = allItems.filter((i) => i.mealId === m.id);
                  const sum = mealSummary(items);
                  const isOpen = expanded.has(m.id);
                  const toggle = () =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(m.id)) next.delete(m.id);
                      else next.add(m.id);
                      return next;
                    });
                  return (
                    <li key={m.id} className={m.status === 'cancelled' ? 'meal-card is-muted' : 'meal-card'}>
                      <div className="row meal-card-head">
                        <button type="button" className="meal-chevron" aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} what’s in ${m.name}`} onClick={toggle}>
                          <Icon name="chevron" size={18} />
                        </button>
                        <span className="meal-time num">{m.startsAt ? timeInZone(m.startsAt, tz) : 'No time'}</span>
                        <span className="row-main">
                          <button type="button" className="row-title meal-name" onClick={toggle}>
                            {m.name}
                          </button>
                          <span className="row-meta">
                            {[m.location || null, s && s.expected ? `${s.people} of ${s.expected} served` : s ? `${s.people} served` : null].filter(Boolean).join(' · ')}
                          </span>
                          {!m.startsAt && !mealDay(m) && (
                            <span>
                              <Badge tone="warning">No day: scanners can't find it</Badge>
                            </span>
                          )}
                          {m.menu && <span className="meal-menu-text">{m.menu}</span>}
                          <span className="meal-summary">
                            {sum.items === 0
                              ? manage && m.status === 'active'
                                ? 'No items yet'
                                : ''
                              : [`${sum.items} ${sum.items === 1 ? 'item' : 'items'}`, sum.alternatives ? `${sum.alternatives} ${sum.alternatives === 1 ? 'alternative' : 'alternatives'}` : null, sum.contains.length ? `Contains: ${sum.contains.slice(0, 6).join(', ')}${sum.contains.length > 6 ? '…' : ''}` : null]
                                  .filter(Boolean)
                                  .join(' · ')}
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
                                { label: 'Duplicate to another day…', onSelect: () => setDuplicating(m) },
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
                                        await refresh();
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
                      </div>
                      {isOpen && <MealItemsPanel eventId={event.id} meal={m} items={items} meals={meals} allItems={allItems} manage={manage} onChanged={refresh} />}
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
      <Sheet open={duplicating !== null} title={duplicating ? `Duplicate ${duplicating.name}` : 'Duplicate meal'} onClose={() => setDuplicating(null)}>
        {duplicating && (
          <DuplicateMeal
            meal={duplicating}
            onCancel={() => setDuplicating(null)}
            onDone={async (newDay) => {
              setDuplicating(null);
              setDay(newDay);
              await refresh();
              toast('Meal duplicated, with its items');
            }}
          />
        )}
      </Sheet>
      <Sheet open={importing} title="Import meals (JSON)" onClose={() => setImporting(false)}>
        {importing && (
          <ImportMeals
            onCancel={() => setImporting(false)}
            onDone={async (n) => {
              setImporting(false);
              await refresh();
              toast(`Imported ${n} ${n === 1 ? 'meal' : 'meals'}`);
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
        {todo.length === 0 ? 'This day already has breakfast, lunch and dinner.' : `Adds ${todo.map((k) => `${k.kind} (${k.start})`).join(', ')}. Change times later.`}
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
  onSubmit: (body: { name: string; location: string; startsAt: string; endsAt: string | null; menu: string; ingredients: string }) => Promise<void>;
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
  const [menu, setMenu] = useState(meal?.menu ?? '');
  const [ingredients, setIngredients] = useState(meal?.ingredients ?? '');
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
      await onSubmit({ name: name.trim(), location: location.trim(), startsAt: zonedIso(day, start, tz), endsAt: end ? zonedIso(day, end, tz) : null, menu: menu.trim(), ingredients: ingredients.trim() });
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
      <Field id="meal-name" label="Name" hint="Like Saturday lunch or Morning tea" error={errors.name}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      <div className="pg-when">
        <Field id="meal-day" label="Day">
          <select className="select" value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => (
              <option key={d} value={d}>
                {dayLabel(d, 'long')}
              </option>
            ))}
          </select>
        </Field>
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
      <Field id="meal-menu" label="Menu" optional hint="Like Spaghetti bolognese, garden salad, fruit" error={errors.menu}>
        <textarea className="textarea" rows={2} maxLength={1000} value={menu} onChange={(e) => setMenu(e.target.value)} />
      </Field>
      <Field
        id="meal-ingredients"
        label="Additional notes"
        optional
        hint="Anything the meal's items don't cover."
        error={errors.ingredients}
      >
        <textarea className="textarea" rows={4} maxLength={10000} value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
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

/** The same meal on another day, with all its items (and their alternatives). */
function DuplicateMeal({ meal, onDone, onCancel }: { meal: Meal; onDone: (day: string) => Promise<void>; onCancel: () => void }) {
  const { event } = useEvent();
  const days = eventDays(event.startsOn, event.endsOn);
  const current = meal.startsAt ? dayInZone(meal.startsAt, event.timezone) : null;
  const [day, setDay] = useState(days.find((d) => d !== current) ?? days[0] ?? '');
  const [name, setName] = useState(meal.name.replace(new RegExp(`^${current ? weekdayName(current) : '\\b'}\\s*`, 'i'), ''));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const suggested = (d: string) => {
    const base = current ? meal.name.replace(new RegExp(`^${weekdayName(current)}\\s*`, 'i'), '') : meal.name;
    return base === meal.name && current ? meal.name : `${weekdayName(d)} ${base}`.trim();
  };
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setProblem(null);
        try {
          await api(`/events/${event.id}/meals/${meal.id}/duplicate`, { body: { day, name: name.trim() || meal.name } });
          await onDone(day);
        } catch (err) {
          setProblem(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');
          setBusy(false);
        }
      }}
    >
      {problem && (
        <p className="field-error" role="alert">
          <Icon name="error" size={16} />
          {problem}
        </p>
      )}
      <Field id="dup-day" label="Day">
        <select
          className="select"
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            setName(suggested(e.target.value));
          }}
        >
          {days.map((d) => (
            <option key={d} value={d}>
              {dayLabel(d, 'long')}
            </option>
          ))}
        </select>
      </Field>
      <Field id="dup-name" label="Name">
        <input className="input" value={name || suggested(day)} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      <p className="meta">Copies times, place, menu, notes and items. Not scans.</p>
      <div className="btn-row">
        <Button type="submit" kind="primary" busy={busy} busyLabel="Duplicating…">
          Duplicate
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

interface ImportPlan {
  ok: boolean;
  errors: string[];
  meals: { name: string; day: string; items: number; alternatives: number; action: 'create' | 'replace' }[];
}

/** Paste or choose a JSON file of meals and items, check it, then import. */
function ImportMeals({ onDone, onCancel }: { onDone: (meals: number) => Promise<void>; onCancel: () => void }) {
  const { event } = useEvent();
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'replace' | 'add'>('replace');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const parsed = () => {
    try {
      return { value: JSON.parse(text) as unknown };
    } catch (err) {
      return { error: `That isn’t valid JSON: ${err instanceof Error ? err.message : ''}` };
    }
  };
  async function run(preview: boolean) {
    const p = parsed();
    if ('error' in p) return setProblem(p.error ?? 'That isn’t valid JSON.');
    setProblem(null);
    setBusy(preview ? 'preview' : 'import');
    try {
      const res = await api<ImportPlan>(`/events/${event.id}/meals/import`, { body: { meals: p.value, mode, preview } });
      if (preview) setPlan(res);
      else await onDone(res.meals.length);
    } catch (err) {
      setProblem(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="form meal-import">
      <p className="meta pg-inline-help">
        A JSON list of meals with their items.
        <InfoTip label="JSON fields">
          Meals: name, day (YYYY-MM-DD), start and end (HH:MM), place, menu, notes, items. Items: name, category, ingredients, contains, may_contain, dietary,
          is_alternative, replaces (another item’s name in the same meal), alternative_for, status, internal_notes.
        </InfoTip>
      </p>
      <Field id="import-file" label="Choose a file" optional>
        <input
          type="file"
          accept=".json,application/json,text/plain"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              setText(await f.text());
              setPlan(null);
            }
          }}
        />
      </Field>
      <Field id="import-json" label="Or paste the JSON">
        <textarea
          className="textarea meal-import-text"
          rows={12}
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPlan(null);
          }}
        />
      </Field>
      <div className="field">
        <span className="field-label">
          Same name and day as a meal here
          <InfoTip label="About replacing">Replace keeps the scans so far, and replaces the meal's details and items.</InfoTip>
        </span>
        <Segmented
          label="Same name and day as a meal here"
          value={mode}
          onChange={(v) => {
            setMode(v);
            setPlan(null);
          }}
          options={[
            { value: 'replace', label: 'Replace details and items' },
            { value: 'add', label: 'Add as new' },
          ]}
        />
      </div>
      {problem && (
        <p className="field-error" role="alert">
          <Icon name="error" size={16} />
          {problem}
        </p>
      )}
      {plan && (
        <div className="meal-import-plan">
          {plan.errors.length > 0 && (
            <div className="notice notice-error" role="alert">
              <p>
                <strong>Fix these, then check again:</strong>
              </p>
              <ul>
                {plan.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          {plan.meals.length > 0 && (
            <ul className="list scroll-list pg-plan-list">
              {plan.meals.map((m, i) => (
                <li key={i} className="row">
                  <span className="row-main">
                    <span className="row-title">{m.name}</span>
                    <span className="row-meta">
                      {dayLabel(m.day, 'long')} · {m.items} {m.items === 1 ? 'item' : 'items'}
                      {m.alternatives ? ` · ${m.alternatives} ${m.alternatives === 1 ? 'alternative' : 'alternatives'}` : ''}
                    </span>
                  </span>
                  <Badge tone={m.action === 'replace' ? 'warning' : 'success'}>{m.action === 'replace' ? 'Replaces existing' : 'New'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="btn-row">
        <Button kind={plan?.ok ? 'secondary' : 'primary'} busy={busy === 'preview'} busyLabel="Checking…" disabled={!text.trim() || busy !== null} onClick={() => void run(true)}>
          Check
        </Button>
        {plan?.ok && (
          <Button kind="primary" busy={busy === 'import'} busyLabel="Importing…" disabled={busy !== null} onClick={() => void run(false)}>
            Import {plan.meals.length} {plan.meals.length === 1 ? 'meal' : 'meals'}
          </Button>
        )}
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
