import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { QrCode } from '../components/QrCode';
import { Field, Loading, LoadError, Notice, PageHeader, SkeletonList } from '../components/ui';
import { Menu } from '../components/Menu';
import { useToast } from '../components/Toast';
import { useTitle } from '../useTitle';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import type { Activity } from './Activities';
import type { Meal } from './Meals';
import { formatShortCode } from '../../shared/credentials';

interface Station {
  id: string;
  name: string;
  contextType: string;
  contextId: string | null;
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

/** Settings › Stations: shared devices that scan one thing. */
export function Stations() {
  useTitle('Stations');
  const { event } = useEvent();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [reopening, setReopening] = useState<string | null>(null);
  const stations = useApi<{ stations: Station[] }>(`/events/${event.id}/stations`);
  const activities = useApi<{ activities: Activity[] }>(`/events/${event.id}/activities`);
  const meals = useApi<{ meals: Meal[] }>(event.features.meals ? `/events/${event.id}/meals` : null);
  const [form, setForm] = useState({ name: '', context: '', hours: '12' });
  const [pairing, setPairing] = useState<{ name: string; code: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [reopenHours, setReopenHours] = useState('12');

  async function act(action: () => Promise<unknown>, done?: string) {
    try {
      await action();
      setFailure(null);
      if (done) toast(done);
      await stations.reload();
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err.message : 'Something went wrong.');
    }
  }

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
      setAdding(false);
      setForm({ name: '', context: '', hours: '12' });
      window.scrollTo(0, 0);
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
      <PageHeader
        title={<span className="visually-hidden">Stations</span>}
        sub="A shared phone or tablet that scans one activity, meal or the gate, and nothing else. Leaders scan from the Scan tab on their own phones."
        actions={
          !adding && (
            <button className="btn" onClick={() => setAdding(true)}>
              Set up station
            </button>
          )
        }
      />
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
            Close pairing code
          </button>
        </div>
      )}
      {stations.loading && !stations.data && (
        <Loading label="Loading stations">
          <SkeletonList rows={2} aside="tag" heading />
        </Loading>
      )}
      {stations.error && <LoadError error={stations.error} onRetry={stations.reload} />}
      {failure && !pairing && <Notice tone="stop">{failure}</Notice>}
      {stations.data && stations.data.stations.length > 0 && (
        <section className="list-section">
          <h2 className="list-heading">Stations</h2>
          <ul className="list">
            {stations.data.stations.map((s) => {
              const live = s.state === 'active' || s.state === 'waiting';
              return (
                <li key={s.id}>
                  {editing === s.id ? (
                    <StationEdit
                      station={s}
                      options={options}
                      onCancel={() => setEditing(null)}
                      onSave={(body) =>
                        void act(async () => {
                          await api(`/events/${event.id}/stations/${s.id}`, { method: 'PATCH', body });
                          setEditing(null);
                        }, 'Changes saved.')
                      }
                    />
                  ) : reopening === s.id ? (
                    <form
                      className="list-pad-inline"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act(async () => {
                          const res = await api<{ pairingCode: string }>(`/events/${event.id}/stations/${s.id}/reopen`, { body: { hours: Number(reopenHours) } });
                          setReopening(null);
                          setPairing({ name: s.name, code: res.pairingCode });
                          window.scrollTo(0, 0);
                        });
                      }}
                    >
                      <Field id={`reopen-${s.id}`} label={`Reopen ${s.name} for`}>
                        <select id={`reopen-${s.id}`} className="input" value={reopenHours} onChange={(e) => setReopenHours(e.target.value)}>
                          {[4, 12, 24, 48, 72].map((h) => (
                            <option key={h} value={h}>
                              {h} hours
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="actions flush-top">
                        <button className="btn btn-small">Reopen station</button>
                        <button type="button" className="btn btn-secondary btn-small" onClick={() => setReopening(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="list-row station-row">
                      <span className="list-main">
                        <strong>{s.name}</strong>
                        <span>Scans {s.contextName}</span>
                      </span>
                      <span className={`tag ${s.state === 'active' ? 'tag-now' : s.state === 'waiting' ? 'tag-warn' : ''}`}>{STATE_LABEL[s.state]}</span>
                      <Menu
                        label={`More actions for ${s.name}`}
                        items={[
                          { label: 'Edit station', onSelect: () => setEditing(s.id) },
                          live
                            ? {
                                label: 'Stop station',
                                onSelect: () => {
                                  if (window.confirm(`Stop "${s.name}"? It's signed out straight away. You can reopen it later.`))
                                    void act(() => api(`/events/${event.id}/stations/${s.id}`, { method: 'DELETE' }), `${s.name} stopped.`);
                                },
                              }
                            : { label: 'Reopen station…', onSelect: () => setReopening(s.id) },
                        ]}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {stations.data && stations.data.stations.length === 0 && !adding && (
        <div className="empty">
          <p>
            <strong>No stations yet.</strong>
          </p>
          <p className="lede">Most camps only need one, for the meal hall.</p>
          <button className="btn" onClick={() => setAdding(true)}>
            Set up station
          </button>
        </div>
      )}
      {adding && (
      <form onSubmit={create} className="narrow panel" noValidate>
        <h2>Set up station</h2>
        <Field id="st-name" label="Name" hint="For example, Meal hall tablet">
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
        <Field id="st-hours" label="Works for">
          <select id="st-hours" className="input" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })}>
            {[4, 12, 24, 48, 72].map((h) => (
              <option key={h} value={h}>
                {h} hours
              </option>
            ))}
          </select>
        </Field>
        <div className="actions">
          <button className="btn" disabled={!form.name.trim() || !form.context}>
            Set up station
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

function StationEdit({
  station,
  options,
  onSave,
  onCancel,
}: {
  station: Station;
  options: { value: string; label: string }[];
  onSave: (body: object) => void;
  onCancel: () => void;
}) {
  const current = `${station.contextType}:${station.contextId ?? ''}`;
  const [name, setName] = useState(station.name);
  const [context, setContext] = useState(current);
  return (
    <form
      className="list-pad-inline"
      onSubmit={(e) => {
        e.preventDefault();
        const [contextType, contextId] = context.split(':');
        onSave({ name, ...(context !== current ? { contextType, contextId: contextId || null } : {}) });
      }}
    >
      <Field id={`st-${station.id}-name`} label="Name">
        <input id={`st-${station.id}-name`} className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field id={`st-${station.id}-ctx`} label="What it scans" hint="A paired device switches over the next time it opens CampCount.">
        <select id={`st-${station.id}-ctx`} className="input" value={context} onChange={(e) => setContext(e.target.value)}>
          {!options.some((o) => o.value === current) && <option value={current}>{station.contextName}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="actions flush-top">
        <button className="btn btn-small" disabled={!name.trim()}>
          Save changes
        </button>
        <button type="button" className="btn btn-secondary btn-small" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
