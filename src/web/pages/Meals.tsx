import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { Field, Loading, Notice } from '../components/ui';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';

export interface Meal {
  id: string;
  name: string;
  location: string;
  status: 'active' | 'cancelled';
}

export function Meals() {
  const { event, can } = useEvent();
  const { data, error, loading, reload } = useApi<{ meals: Meal[] }>(`/events/${event.id}/meals`);
  const [name, setName] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const manage = can('meals.manage') && (event.status === 'draft' || event.status === 'open');

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/events/${event.id}/meals`, { body: { name } });
      setName('');
      setFailure(null);
      await reload();
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err.message : 'Something went wrong.');
    }
  }

  if (loading && !data) return <Loading />;
  if (error) return <Notice tone="stop">{error.message}</Notice>;
  const meals = data?.meals ?? [];

  return (
    <>
      {!event.features.meals && <Notice tone="warn">Meal scanning is switched off for this event. Turn it on from Overview.</Notice>}
      {meals.length === 0 ? (
        <div className="empty">
          <p>
            <strong>No meals yet.</strong>
          </p>
          <p className="lede">Add each meal you want to count, in order: Friday dinner, Saturday breakfast, and so on.</p>
        </div>
      ) : (
        <ul className="launch">
          {meals.map((m) => (
            <li key={m.id} className={m.status === 'cancelled' ? 'is-muted' : undefined}>
              <span className="meal-row">
                <strong>{m.name}</strong>
                {manage && (
                  <button
                    className="btn-link"
                    onClick={async () => {
                      await api(`/events/${event.id}/meals/${m.id}`, { method: 'PATCH', body: { status: m.status === 'active' ? 'cancelled' : 'active' } });
                      await reload();
                    }}
                  >
                    {m.status === 'active' ? 'Cancel' : 'Restore'}
                    <span className="visually-hidden"> {m.name}</span>
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {manage && (
        <form onSubmit={add} className="narrow section-gap" noValidate>
          <h2>Add a meal</h2>
          {failure && <Notice tone="stop">{failure}</Notice>}
          <Field id="meal-name" label="Meal name" hint="For example, Saturday lunch">
            <input id="meal-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <button className="btn" disabled={!name.trim()}>
            Add meal
          </button>
        </form>
      )}
    </>
  );
}
