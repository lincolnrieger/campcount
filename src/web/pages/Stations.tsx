import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { QrCode } from '../components/QrCode';
import type { Activity, Meal } from '../model';
import { useApi } from '../useApi';
import { formatShortCode } from '../../shared/credentials';
import { Badge, Button, EmptyState, Field, Icon, LoadError, Loading, Menu, Notice, PageHeader, Sheet, SkeletonRows, useConfirm, useToast } from '../ui';
import type { Tone } from '../ui';
import { useEvent } from './EventLayout';

interface Station {
  id: string;
  name: string;
  contextType: string;
  contextId: string | null;
  contextName: string;
  state: 'waiting' | 'active' | 'expired' | 'revoked' | 'pairing_expired';
  expiresAt: string;
}

const STATE: Record<Station['state'], { label: string; tone: Tone }> = {
  waiting: { label: 'Waiting to pair', tone: 'warning' },
  active: { label: 'Paired', tone: 'success' },
  expired: { label: 'Expired', tone: 'neutral' },
  revoked: { label: 'Stopped', tone: 'neutral' },
  pairing_expired: { label: 'Pairing code expired', tone: 'warning' },
};

const HOURS = [4, 12, 24, 48, 72];
const fail = (err: unknown) => (err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');

type Panel = { kind: 'add' } | { kind: 'edit'; station: Station } | { kind: 'reopen'; station: Station } | { kind: 'code'; name: string; code: string } | null;

/** Settings › Scanning stations: shared tablets locked to one job. */
export function Stations() {
  const { event, base } = useEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const stations = useApi<{ stations: Station[] }>(`/events/${event.id}/stations`);
  const activities = useApi<{ activities: Activity[] }>(event.features.activities ? `/events/${event.id}/activities` : null);
  const meals = useApi<{ meals: Meal[] }>(event.features.meals ? `/events/${event.id}/meals` : null);
  const [panel, setPanel] = useState<Panel>(null);
  const back = { to: `${base}/settings`, label: 'Settings' };

  const options = [
    ...(event.features.site ? [{ value: 'site:', label: 'Gate (arrivals and departures)' }] : []),
    ...(meals.data?.meals ?? []).filter((m) => m.status === 'active').map((m) => ({ value: `meal:${m.id}`, label: `Meal: ${m.name}` })),
    ...(activities.data?.activities ?? []).filter((a) => a.status === 'active').map((a) => ({ value: `activity:${a.id}`, label: `Activity: ${a.name}` })),
  ];

  if (event.status !== 'open') {
    return (
      <>
        <PageHeader title="Scanning stations" back={back} />
        <Notice title="Stations are set up once the event is open">
          <p>A station is a shared phone or tablet that scans one thing, such as the meal hall.</p>
        </Notice>
      </>
    );
  }

  const list = stations.data?.stations ?? [];
  const finished = list.filter((s) => s.state !== 'active' && s.state !== 'waiting');

  /** Delete stations from the list. Their scans stay in the reports. */
  async function remove(targets: Station[]) {
    const one = targets.length === 1 ? targets[0]! : null;
    const live = targets.some((s) => s.state === 'active' || s.state === 'waiting');
    const ok = await confirm({
      title: one ? `Delete ${one.name}?` : `Delete ${targets.length} finished stations?`,
      body: (
        <p>
          {live ? 'It is signed out straight away. ' : ''}
          {one ? 'It' : 'They'} won't show here any more. Scans already made stay in the reports.
        </p>
      ),
      confirm: one ? 'Delete station' : 'Delete stations',
      danger: true,
    });
    if (!ok) return;
    try {
      for (const s of targets) await api(`/events/${event.id}/stations/${s.id}/remove`, { body: {} });
      toast(one ? `${one.name} deleted` : `${targets.length} stations deleted`);
    } catch (err) {
      toast(fail(err), { tone: 'error' });
    }
    await stations.reload();
  }
  const add = (
    <Button kind="primary" onClick={() => setPanel({ kind: 'add' })}>
      Set up station
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Scanning stations"
        back={back}
        summary="A shared phone or tablet that scans one thing and nothing else. Staff scan from their own phones on the Scan tab."
        primary={list.length > 0 && add}
      />
      {stations.loading && !stations.data ? (
        <Loading what="stations">
          <SkeletonRows rows={2} />
        </Loading>
      ) : stations.error ? (
        <LoadError error={stations.error} onRetry={stations.reload} what="stations" />
      ) : list.length === 0 ? (
        <EmptyState title="No stations yet" actions={add}>
          Most camps only need one, for the meal hall.
        </EmptyState>
      ) : (
        <>
        {finished.length > 1 && (
          <div className="toolbar">
            <p>
              <strong>{finished.length}</strong> finished stations
            </p>
            <Button small kind="ghost" onClick={() => void remove(finished)}>
              Delete finished stations
            </Button>
          </div>
        )}
        <ul className="list">
          {list.map((s) => {
            const live = s.state === 'active' || s.state === 'waiting';
            return (
              <li key={s.id} className="row">
                <span className="row-main">
                  <span className="row-title">{s.name}</span>
                  <span className="row-meta">Scans {s.contextType === 'site' ? 'the gate' : s.contextName}</span>
                </span>
                <Badge tone={STATE[s.state].tone}>{STATE[s.state].label}</Badge>
                <span className="row-side">
                  <Menu
                    label={`More actions for ${s.name}`}
                    items={[
                      { label: 'Edit station', onSelect: () => setPanel({ kind: 'edit', station: s }) },
                      !live && { label: 'Reopen station', onSelect: () => setPanel({ kind: 'reopen', station: s }) },
                      live && {
                        label: 'Stop station…',
                        danger: true,
                        onSelect: async () => {
                          const ok = await confirm({
                            title: `Stop ${s.name}?`,
                            body: <p>It's signed out straight away. You can reopen it later.</p>,
                            confirm: 'Stop station',
                            danger: true,
                          });
                          if (!ok) return;
                          try {
                            await api(`/events/${event.id}/stations/${s.id}`, { method: 'DELETE' });
                            toast(`${s.name} stopped`);
                            await stations.reload();
                          } catch (err) {
                            toast(fail(err), { tone: 'error' });
                          }
                        },
                      },
                      { label: 'Delete station…', danger: true, onSelect: () => void remove([s]) },
                    ]}
                  />
                </span>
              </li>
            );
          })}
        </ul>
        </>
      )}

      <Sheet open={panel?.kind === 'add'} title="Set up station" onClose={() => setPanel(null)}>
        {panel?.kind === 'add' && (
          <StationForm
            options={options}
            submitLabel="Set up station"
            onSubmit={async ({ name, context, hours }) => {
              const [contextType, contextId] = context.split(':');
              const res = await api<{ pairingCode: string }>(`/events/${event.id}/stations`, {
                body: { name, contextType, contextId: contextId || null, hours },
              });
              await stations.reload();
              setPanel({ kind: 'code', name, code: res.pairingCode });
            }}
            onCancel={() => setPanel(null)}
          />
        )}
      </Sheet>

      <Sheet open={panel?.kind === 'edit'} title="Edit station" onClose={() => setPanel(null)}>
        {panel?.kind === 'edit' && (
          <StationForm
            station={panel.station}
            options={options}
            submitLabel="Save changes"
            onSubmit={async ({ name, context }) => {
              const s = panel.station;
              const current = `${s.contextType}:${s.contextId ?? ''}`;
              const [contextType, contextId] = context.split(':');
              await api(`/events/${event.id}/stations/${s.id}`, {
                method: 'PATCH',
                body: { name, ...(context !== current ? { contextType, contextId: contextId || null } : {}) },
              });
              toast('Changes saved');
              setPanel(null);
              await stations.reload();
            }}
            onCancel={() => setPanel(null)}
          />
        )}
      </Sheet>

      <Sheet open={panel?.kind === 'reopen'} title="Reopen station" onClose={() => setPanel(null)}>
        {panel?.kind === 'reopen' && (
          <ReopenForm
            station={panel.station}
            onSubmit={async (hours) => {
              const res = await api<{ pairingCode: string }>(`/events/${event.id}/stations/${panel.station.id}/reopen`, { body: { hours } });
              await stations.reload();
              setPanel({ kind: 'code', name: panel.station.name, code: res.pairingCode });
            }}
            onCancel={() => setPanel(null)}
          />
        )}
      </Sheet>

      <Sheet open={panel?.kind === 'code'} title={panel?.kind === 'code' ? `Pair ${panel.name}` : 'Pairing code'} onClose={() => setPanel(null)}>
        {panel?.kind === 'code' && (
          <div className="pairing">
            <p>
              On the station, open <strong>{location.host}/pair</strong> and scan this code, or type it in. It works once, for 15 minutes.
            </p>
            <QrCode value={`${location.origin}/pair#${panel.code}`} size="12rem" label="Pairing QR code" />
            <p className="code-big">{formatShortCode(panel.code)}</p>
            <div>
              <Button kind="primary" onClick={() => setPanel(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}

function StationForm({
  station,
  options,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  station?: Station;
  options: { value: string; label: string }[];
  submitLabel: string;
  onSubmit: (v: { name: string; context: string; hours: number }) => Promise<void>;
  onCancel: () => void;
}) {
  const current = station ? `${station.contextType}:${station.contextId ?? ''}` : '';
  const [name, setName] = useState(station?.name ?? '');
  const [context, setContext] = useState(current);
  const [hours, setHours] = useState('12');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!name.trim()) found.name = 'Enter a name';
    if (!context) found.context = 'Choose what it scans';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    setFailure(null);
    try {
      await onSubmit({ name: name.trim(), context, hours: Number(hours) });
    } catch (err) {
      setFailure(fail(err));
    } finally {
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
      <Field id="st-name" label="Name" hint="For example, Meal hall tablet" error={errors.name}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </Field>
      <Field id="st-ctx" label="What it scans" hint={station ? 'A paired station switches over the next time it opens CampCount.' : undefined} error={errors.context}>
        <select className="select" value={context} onChange={(e) => setContext(e.target.value)}>
          {!station && <option value="">Choose…</option>}
          {station && !options.some((o) => o.value === current) && <option value={current}>{station.contextName}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      {!station && (
        <Field id="st-hours" label="Works for">
          <select className="select" value={hours} onChange={(e) => setHours(e.target.value)}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h} hours
              </option>
            ))}
          </select>
        </Field>
      )}
      <div className="btn-row">
        <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…">
          {submitLabel}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function ReopenForm({ station, onSubmit, onCancel }: { station: Station; onSubmit: (hours: number) => Promise<void>; onCancel: () => void }) {
  const [hours, setHours] = useState('12');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setFailure(null);
        try {
          await onSubmit(Number(hours));
        } catch (err) {
          setFailure(fail(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {failure && (
        <p className="field-error" role="alert">
          <Icon name="error" size={16} />
          {failure}
        </p>
      )}
      <p>{station.name} gets a new pairing code.</p>
      <Field id="reopen-hours" label="Works for">
        <select className="select" value={hours} onChange={(e) => setHours(e.target.value)}>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h} hours
            </option>
          ))}
        </select>
      </Field>
      <div className="btn-row">
        <Button type="submit" kind="primary" busy={busy} busyLabel="Reopening…">
          Reopen station
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
