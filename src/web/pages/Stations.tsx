import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { QrCode } from '../components/QrCode';
import { Field, Loading, Notice } from '../components/ui';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import type { Activity } from './Activities';
import type { Meal } from './Meals';
import { formatShortCode } from '../../shared/credentials';

interface Station {
  id: string;
  name: string;
  contextType: string;
  contextName: string;
  state: 'waiting' | 'active' | 'expired' | 'revoked' | 'pairing_expired';
  expiresAt: string;
}

const STATE_LABEL: Record<Station['state'], string> = {
  waiting: 'Waiting to pair',
  active: 'Active',
  expired: 'Expired',
  revoked: 'Stopped',
  pairing_expired: 'Pairing code expired',
};

export function Stations() {
  const { event } = useEvent();
  const stations = useApi<{ stations: Station[] }>(`/events/${event.id}/stations`);
  const activities = useApi<{ activities: Activity[] }>(`/events/${event.id}/activities`);
  const meals = useApi<{ meals: Meal[] }>(event.features.meals ? `/events/${event.id}/meals` : null);
  const [form, setForm] = useState({ name: '', context: '', hours: '12' });
  const [pairing, setPairing] = useState<{ name: string; code: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const options = [
    ...(event.features.site ? [{ value: 'site:', label: 'On site (arrivals and departures)' }] : []),
    ...(meals.data?.meals ?? []).filter((m) => m.status === 'active').map((m) => ({ value: `meal:${m.id}`, label: `Meal: ${m.name}` })),
    ...(activities.data?.activities ?? []).filter((a) => a.status === 'active').map((a) => ({ value: `activity:${a.id}`, label: `Activity: ${a.name}` })),
  ];

  async function create(e: FormEvent) {
    e.preventDefault();
    const [contextType, contextId] = form.context.split(':');
    try {
      const res = await api<{ pairingCode: string }>(`/events/${event.id}/stations`, {
        body: { name: form.name, contextType, contextId: contextId || null, hours: Number(form.hours) },
      });
      setPairing({ name: form.name, code: res.pairingCode });
      setFailure(null);
      await stations.reload();
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err.message : 'Something went wrong.');
    }
  }

  if (event.status !== 'open') {
    return <Notice title="Stations are set up once the event is open">A station is a shared phone or tablet that can only scan one thing.</Notice>;
  }

  return (
    <>
      <p className="narrow">
        A station is a shared phone or tablet, such as the meal-hall tablet, that can scan for one activity, meal or the site gate
        and nothing else. It needs no account. Stop it at any time and it is signed out straight away.
      </p>
      {pairing && (
        <div className="pairing">
          <h2>Pair "{pairing.name}"</h2>
          <p>
            On the station device, open <strong>{location.host}/pair</strong> and scan this code or type it in. It works once, for 15
            minutes.
          </p>
          <QrCode value={`${location.origin}/pair#${pairing.code}`} size="12rem" label="Pairing code" />
          <p className="pairing-code">{formatShortCode(pairing.code)}</p>
          <button className="btn btn-secondary" onClick={() => setPairing(null)}>
            Done
          </button>
        </div>
      )}
      {stations.loading && !stations.data && <Loading />}
      {stations.data && stations.data.stations.length > 0 && (
        <div className="sheet-wrap">
          <table className="sheet sheet-stack">
            <thead>
              <tr>
                <th scope="col">Station</th>
                <th scope="col">Scans</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {stations.data.stations.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td data-label="Scans">{s.contextName}</td>
                  <td data-label="Status">{STATE_LABEL[s.state]}</td>
                  <td className="num">
                    {(s.state === 'active' || s.state === 'waiting') && (
                      <button
                        className="btn-link"
                        onClick={async () => {
                          if (!window.confirm(`Stop "${s.name}"? It will be signed out immediately.`)) return;
                          await api(`/events/${event.id}/stations/${s.id}`, { method: 'DELETE' });
                          await stations.reload();
                        }}
                      >
                        Stop<span className="visually-hidden"> {s.name}</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form onSubmit={create} className="narrow section-gap" noValidate>
        <h2>Set up a station</h2>
        {failure && <Notice tone="stop">{failure}</Notice>}
        <Field id="st-name" label="Name" hint="So you can tell devices apart, for example Meal hall tablet">
          <input id="st-name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field id="st-ctx" label="What it scans">
          <select id="st-ctx" className="input" value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })}>
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="st-hours" label="Works for" hint="It stops automatically after this.">
          <select id="st-hours" className="input" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })}>
            {[4, 12, 24, 48, 72].map((h) => (
              <option key={h} value={h}>
                {h} hours
              </option>
            ))}
          </select>
        </Field>
        <button className="btn" disabled={!form.name.trim() || !form.context}>
          Create pairing code
        </button>
      </form>
    </>
  );
}
