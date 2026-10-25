import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { Field, Loading, Notice, SkeletonList } from '../components/ui';
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

export function Meals() {
  const { event, can } = useEvent();
  const { data, error, loading, reload } = useApi<{ meals: Meal[] }>(`/events/${event.id}/meals`);
  const days = eventDays(event.startsOn, event.endsOn);
  const tz = event.timezone;
  const [day, setDay] = useState(days[0] ?? event.startsOn);
  const [kind, setKind] = useState<string>('Dinner');
  const [custom, setCustom] = useState('');
  const [time, setTime] = useState('18:00');
  const [failure, setFailure] = useState<string | null>(null);
  const manage = can('meals.manage') && (event.status === 'draft' || event.status === 'open');

  const name = kind === 'Other' ? custom.trim() : `${weekdayName(day)} ${kind.toLowerCase()}`;

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/events/${event.id}/meals`, { body: { name, startsAt: zonedIso(day, time, tz) } });
      setCustom('');
      setFailure(null);
      await reload();
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err.message : 'Something went wrong.');
    }
  }

  async function patch(id: string, body: object) {
    try {
      await api(`/events/${event.id}/meals/${id}`, { method: 'PATCH', body });
      setFailure(null);
      await reload();
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err.message : 'Something went wrong.');
    }
  }

  if (loading && !data)
    return (
      <Loading label="Loading meals">
        <SkeletonList rows={3} aside="button" heading />
        <SkeletonList rows={3} aside="button" heading />
      </Loading>
    );
  if (error) return <Notice tone="stop">{error.message}</Notice>;
  const meals = data?.meals ?? [];
  const mealDay = (m: Meal) => (m.startsAt ? dayInZone(m.startsAt, tz) : inferDay(m.name, days));
  const groups = [...days, null]
    .map((d) => ({ day: d, meals: meals.filter((m) => mealDay(m) === d || (d === null && !days.includes(mealDay(m) ?? ''))) }))
    .filter((g) => g.meals.length > 0);

  return (
    <>
      {!event.features.meals && <Notice tone="warn">Meal scanning is switched off for this event. Turn it on from Overview.</Notice>}
      {failure && <Notice tone="stop">{failure}</Notice>}
      {meals.length === 0 ? (
        <div className="empty">
          <p>
            <strong>No meals yet.</strong>
          </p>
          <p className="lede">Add each meal you want to count. Scanners pick them by day.</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.day ?? 'none'} className="list-section">
            <h2 className="list-heading">{g.day ? dayLabel(g.day, 'long') : 'No day set'}</h2>
            <ul className="list">
              {g.meals.map((m) => (
                <li key={m.id} className={m.status === 'cancelled' ? 'list-row is-muted' : 'list-row'}>
                  <span className="list-main">
                    <strong>{m.name}</strong>
                    <span>
                      {m.status === 'cancelled' ? 'Cancelled' : m.startsAt ? timeInZone(m.startsAt, tz) : mealDay(m) ? 'No time set' : 'Pick a day so scanners can find it'}
                    </span>
                  </span>
                  {manage && (
                    <span className="list-side">
                      <select
                        className="input input-compact"
                        aria-label={`Day for ${m.name}`}
                        value={mealDay(m) ?? ''}
                        onChange={(e) => void patch(m.id, { startsAt: zonedIso(e.target.value, m.startsAt ? clockInZone(m.startsAt, tz) : '12:00', tz) })}
                      >
                        {!mealDay(m) && <option value="">Day…</option>}
                        {days.map((d) => (
                          <option key={d} value={d}>
                            {dayLabel(d)}
                          </option>
                        ))}
                      </select>
                      <button className="btn-link" onClick={() => void patch(m.id, { status: m.status === 'active' ? 'cancelled' : 'active' })}>
                        {m.status === 'active' ? 'Cancel' : 'Restore'}
                        <span className="visually-hidden"> {m.name}</span>
                      </button>
                      <button
                        className="btn-link text-stop"
                        onClick={async () => {
                          try {
                            if (await deleteContext(event.id, 'meals', m.id, m.name)) await reload();
                          } catch (err) {
                            setFailure(err instanceof ApiFailure ? err.message : 'Something went wrong.');
                          }
                        }}
                      >
                        Delete<span className="visually-hidden"> {m.name}</span>
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {manage && (
        <form onSubmit={add} className="narrow section-gap" noValidate>
          <h2>Add a meal</h2>
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
          <button className="btn" disabled={!name}>
            Add {name || 'meal'}
          </button>
        </form>
      )}
    </>
  );
}
