import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { Field, Loading, LoadError, Notice, PageHeader, SkeletonList } from '../components/ui';
import { Menu } from '../components/Menu';
import { useToast } from '../components/Toast';
import { useTitle } from '../useTitle';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import { deleteContext } from '../confirmDelete';
import { clockInZone, dayInZone, dayLabel, eventDays, inferDay, timeInZone, weekdayName, zonedIso } from '../../shared/time';

export interface Meal {
  id: string;
  name: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  status: 'active' | 'cancelled';
}

const KINDS = [
  { label: 'Breakfast', time: '07:30' },
  { label: 'Lunch', time: '12:30' },
  { label: 'Dinner', time: '18:00' },
] as const;

/** Breakfast, lunch, dinner, then anything else, for meals without a time. */
const mealOrder = (name: string) => {
  const i = KINDS.findIndex((k) => name.toLowerCase().includes(k.label.toLowerCase()));
  return i < 0 ? KINDS.length : i;
};

/** Meals: each meal to count, by day. */
export function Meals() {
  useTitle('Meals');
  const { event, can } = useEvent();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ meals: Meal[] }>(`/events/${event.id}/meals`);
  const days = eventDays(event.startsOn, event.endsOn);
  const tz = event.timezone;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const manage = can('meals.manage') && (event.status === 'draft' || event.status === 'open');

  async function patch(id: string, body: object) {
    try {
      await api(`/events/${event.id}/meals/${id}`, { method: 'PATCH', body });
      setFailure(null);
      await reload();
      return true;
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err.message : 'Something went wrong. Check your signal and try again.');
      return false;
    }
  }

  if (loading && !data)
    return (
      <Loading label="Loading meals">
        <SkeletonList rows={3} aside="chevron" heading />
        <SkeletonList rows={3} aside="chevron" heading />
      </Loading>
    );
  if (error) return <LoadError error={error} onRetry={reload} />;
  const meals = data?.meals ?? [];
  const mealDay = (m: Meal) => (m.startsAt ? dayInZone(m.startsAt, tz) : inferDay(m.name, days));
  const groups = [...days, null]
    .map((d) => ({
      day: d,
      meals: meals
        .filter((m) => mealDay(m) === d || (d === null && !days.includes(mealDay(m) ?? '')))
        .sort((x, y) => (x.startsAt ?? '').localeCompare(y.startsAt ?? '') || mealOrder(x.name) - mealOrder(y.name)),
    }))
    .filter((g) => g.meals.length > 0);

  return (
    <>
      <PageHeader
        title={<span className="visually-hidden">Meals</span>}
        sub={meals.length > 0 && `${meals.filter((m) => m.status === 'active').length} meals`}
        actions={
          manage &&
          !adding && (
            <button className="btn" onClick={() => setAdding(true)}>
              Add meal
            </button>
          )
        }
      />
      {failure && <Notice tone="stop">{failure}</Notice>}
      {adding && (
        <AddMeal
          onDone={async (name) => {
            setAdding(false);
            if (name) {
              toast(`Added ${name}.`);
              await reload();
            }
          }}
        />
      )}
      {meals.length === 0 && !adding ? (
        <div className="empty">
          <p>
            <strong>No meals yet.</strong>
          </p>
          <p className="lede">Add each meal you want to count. Scanners pick them by day.</p>
          {manage && (
            <button className="btn" onClick={() => setAdding(true)}>
              Add meal
            </button>
          )}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.day ?? 'none'} className="list-section">
            <h2 className="list-heading">{g.day ? dayLabel(g.day, 'long') : 'No day set'}</h2>
            <ul className="list">
              {g.meals.map((m) =>
                editing === m.id ? (
                  <li key={m.id}>
                    <EditMeal
                      meal={m}
                      day={mealDay(m)}
                      onCancel={() => setEditing(null)}
                      onSave={async (body) => {
                        if (await patch(m.id, body)) {
                          setEditing(null);
                          toast('Changes saved.');
                        }
                      }}
                    />
                  </li>
                ) : (
                  <li key={m.id} className={m.status === 'cancelled' ? 'list-row is-muted' : 'list-row'}>
                    <span className="list-main">
                      <strong>{m.name}</strong>
                      <span>{m.startsAt ? timeInZone(m.startsAt, tz) : mealDay(m) ? 'No time set' : 'Pick a day so scanners can find it'}</span>
                    </span>
                    {m.status === 'cancelled' && <span className="tag">Cancelled</span>}
                    {manage && (
                      <Menu
                        label={`More actions for ${m.name}`}
                        items={[
                          { label: 'Edit meal', onSelect: () => setEditing(m.id) },
                          m.status === 'active'
                            ? {
                                label: 'Cancel meal',
                                onSelect: async () => {
                                  if (await patch(m.id, { status: 'cancelled' }))
                                    toast(`${m.name} cancelled. Scanners no longer show it.`, { undo: () => patch(m.id, { status: 'active' }) });
                                },
                              }
                            : { label: 'Restore meal', onSelect: async () => void ((await patch(m.id, { status: 'active' })) && toast(`${m.name} restored.`)) },
                          {
                            label: 'Delete meal…',
                            danger: true,
                            onSelect: async () => {
                              try {
                                if (await deleteContext(event.id, 'meals', m.id, m.name)) {
                                  toast(`Deleted ${m.name}.`);
                                  await reload();
                                }
                              } catch (err) {
                                setFailure(err instanceof ApiFailure ? err.message : 'Something went wrong.');
                              }
                            },
                          },
                        ]}
                      />
                    )}
                  </li>
                ),
              )}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

/** Change a meal's name, day and time. */
function EditMeal({ meal, day: initialDay, onSave, onCancel }: { meal: Meal; day: string | null; onSave: (body: object) => Promise<void>; onCancel: () => void }) {
  const { event } = useEvent();
  const tz = event.timezone;
  const days = eventDays(event.startsOn, event.endsOn);
  const [name, setName] = useState(meal.name);
  const [day, setDay] = useState(initialDay ?? days[0] ?? event.startsOn);
  const [time, setTime] = useState(meal.startsAt ? clockInZone(meal.startsAt, tz) : '12:00');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="list-pad-inline"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSave({ name: name.trim(), startsAt: zonedIso(day, time, tz) });
        setBusy(false);
      }}
    >
      <Field id={`meal-${meal.id}-name`} label="Name">
        <input id={`meal-${meal.id}-name`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="row">
        <Field id={`meal-${meal.id}-day`} label="Day">
          <select id={`meal-${meal.id}-day`} className="input" value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => (
              <option key={d} value={d}>
                {dayLabel(d)}
              </option>
            ))}
          </select>
        </Field>
        <Field id={`meal-${meal.id}-time`} label="Time">
          <input id={`meal-${meal.id}-time`} className="input input-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <div className="actions flush-top">
        <button className="btn btn-small" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="btn btn-secondary btn-small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The add-a-meal form: pick a day, a meal and a time. */
function AddMeal({ onDone }: { onDone: (added: string | null) => Promise<void> }) {
  const { event } = useEvent();
  const days = eventDays(event.startsOn, event.endsOn);
  const tz = event.timezone;
  const [day, setDay] = useState(days[0] ?? event.startsOn);
  const [kind, setKind] = useState<string>('Dinner');
  const [custom, setCustom] = useState('');
  const [time, setTime] = useState('18:00');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = kind === 'Other' ? custom.trim() : `${weekdayName(day)} ${kind.toLowerCase()}`;

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/events/${event.id}/meals`, { body: { name, startsAt: zonedIso(day, time, tz) } });
      await onDone(name);
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err.message : 'Something went wrong. Check your signal and try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="narrow panel" noValidate>
      <h2>Add meal</h2>
      {failure && <Notice tone="stop">{failure}</Notice>}
      <div className="field">
        <span className="field-legend" id="meal-day-label">
          Day
        </span>
        <div className="chip-row" role="group" aria-labelledby="meal-day-label">
          {days.map((d) => (
            <button key={d} type="button" aria-pressed={day === d} className="chip-toggle" onClick={() => setDay(d)}>
              {dayLabel(d)}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-legend" id="meal-kind-label">
          Meal
        </span>
        <div className="chip-row" role="group" aria-labelledby="meal-kind-label">
          {[...KINDS, { label: 'Other', time }].map((k) => (
            <button
              key={k.label}
              type="button"
              aria-pressed={kind === k.label}
              className="chip-toggle"
              onClick={() => {
                setKind(k.label);
                if (k.label !== 'Other') setTime(k.time);
              }}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>
      {kind === 'Other' && (
        <Field id="meal-name" label="Name" hint="For example, Morning tea">
          <input id="meal-name" className="input" value={custom} onChange={(e) => setCustom(e.target.value)} />
        </Field>
      )}
      <Field id="meal-time" label="Time">
        <input id="meal-time" className="input input-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
      </Field>
      <div className="actions">
        <button className="btn" disabled={!name || busy}>
          {busy ? 'Adding…' : `Add ${name || 'meal'}`}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void onDone(null)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
