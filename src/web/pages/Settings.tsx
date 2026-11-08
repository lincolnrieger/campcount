import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import type { EventFeatures, EventStatus } from '../../shared/schemas';
import { EVENT_TRANSITIONS } from '../../shared/lifecycle';
import { useSession } from '../session';
import { useApi } from '../useApi';
import { Badge, Button, Icon, Notice, PageHeader, Section, plural, useConfirm, useToast } from '../ui';
import { EventFields, FeatureChecklist, checkEventForm } from './Events';
import type { EventForm } from './Events';
import { useEvent } from './EventLayout';

const STATUS_WORD: Record<EventStatus, string> = { draft: 'Draft', open: 'Open', completed: 'Closed', archived: 'Archived', cancelled: 'Cancelled' };

/** Status changes offered here. Opening a draft is on Home; closing is on Reports. */
const CHANGES: Partial<Record<EventStatus, { label: string; title: string; body: string; done: string; danger?: boolean }>> = {
  cancelled: {
    label: 'Cancel event',
    title: 'Cancel this event?',
    body: 'Nobody will be able to scan. Its records are kept, and you can return it to draft later.',
    done: 'Event cancelled',
    danger: true,
  },
  draft: { label: 'Return to draft', title: 'Return this event to draft?', body: 'You can set it up again and open it when ready.', done: 'Event is a draft again' },
};

/** Settings: one row per section this person can change, then the event's status. */
export function SettingsIndex() {
  const { event, can, reload, base: eventBase, onSite } = useEvent();
  const { me } = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const staff = useApi<{ staff: unknown[] }>(can('staff.manage') ? `/events/${event.id}/staff` : null);
  const stations = useApi<{ stations: unknown[] }>(can('stations.manage') ? `/events/${event.id}/stations` : null);
  const canCopy = !onSite && me?.kind === 'user' && me.platformPermissions.includes('platform.events.create');

  const rows = [
    can('event.configure') && { to: 'event', title: 'Event details', meta: 'Name, dates, location, notes and features' },
    can('event.configure') && { to: 'lanyards', title: 'Lanyards', meta: 'Your card design, the blank template, and the no-photo marker' },
    can('staff.manage') && { to: 'staff', title: 'Staff', meta: staff.data ? `${plural(staff.data.staff.length, 'person', 'people')} · who works on this event` : 'Who works on this event and what they can do' },
    can('stations.manage') && {
      to: 'stations',
      title: 'Scanning stations',
      meta: stations.data ? `${plural(stations.data.stations.length, 'station')} · shared tablets locked to one job` : 'Shared tablets locked to one job',
    },
    canCopy && { to: 'copy', title: 'Copy event', meta: "Start next year's camp from this one" },
  ].filter((r): r is { to: string; title: string; meta: string } => Boolean(r));

  const changes = can('event.close') ? EVENT_TRANSITIONS[event.status].filter((to) => CHANGES[to]) : [];

  if (rows.length === 0 && changes.length === 0) return <Navigate to={eventBase || '/'} replace />;

  return (
    <>
      <PageHeader title="Settings" />
      <div className="sections">
        {rows.length > 0 && (
          <ul className="list">
            {rows.map((r) => (
              <li key={r.to} className="row row-large row-link">
                <span className="row-main">
                  <span className="row-title">
                    <Link to={r.to}>{r.title}</Link>
                  </span>
                  <span className="row-meta">{r.meta}</span>
                </span>
                <span className="row-chevron">
                  <Icon name="chevron" />
                </span>
              </li>
            ))}
          </ul>
        )}
        {changes.length > 0 && (
          <section className="danger-zone" aria-labelledby="status-heading">
            <h2 id="status-heading">Event status</h2>
            <p>
              This event is <Badge tone={event.status === 'draft' ? 'warning' : 'neutral'}>{STATUS_WORD[event.status]}</Badge>
            </p>
            <div className="btn-row">
              {changes.map((to) => {
                const c = CHANGES[to]!;
                return (
                  <Button
                    key={to}
                    kind={c.danger ? 'secondary' : 'secondary'}
                    className={c.danger ? 'settings-danger' : undefined}
                    busyLabel="Working…"
                    onAction={async () => {
                      const ok = await confirm({ title: c.title, body: <p>{c.body}</p>, confirm: c.label, danger: c.danger });
                      if (!ok) return;
                      try {
                        await api(`/events/${event.id}/transition`, { body: { to } });
                        toast(c.done);
                        await reload();
                      } catch (err) {
                        toast(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.', { tone: 'error' });
                      }
                    }}
                  >
                    {c.label}
                  </Button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

/** Settings › Event details: name, dates, location, notes and features. */
export function EventDetails() {
  const { event, can, reload } = useEvent();
  const { base: eventBase } = useEvent();
  const navigate = useNavigate();
  const toast = useToast();
  const editable = can('event.configure') && (event.status === 'draft' || event.status === 'open');
  const [form, setForm] = useState<EventForm>({ name: event.name, location: event.location, startsOn: event.startsOn, endsOn: event.endsOn, description: event.description });
  const [features, setFeatures] = useState<EventFeatures>(event.features);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof EventForm) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const back = { to: `${eventBase}/settings`, label: 'Settings' };

  if (!can('event.configure')) return <Navigate to={back.to} replace />;

  async function save(e: FormEvent) {
    e.preventDefault();
    const local = checkEventForm(form);
    setErrors(local);
    setFailure(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await api(`/events/${event.id}`, { method: 'PATCH', body: { ...form, features } });
      await reload();
      toast('Changes saved');
      navigate(back.to);
    } catch (err) {
      if (err instanceof ApiFailure) {
        setErrors(err.fieldErrors());
        setFailure(err.message);
      } else setFailure('No connection. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Event details" back={back} />
      <form className="form" onSubmit={save} noValidate>
        {!editable && (
          <Notice title={`This event is ${STATUS_WORD[event.status].toLowerCase()}`}>
            <p>Details are locked. Reopen the event to change them.</p>
          </Notice>
        )}
        {failure && (
          <p className="field-error" role="alert">
            <Icon name="error" size={16} />
            {failure}
          </p>
        )}
        <fieldset className="form" disabled={!editable || busy}>
          <EventFields form={form} set={set} errors={errors} />
          <FeatureChecklist value={features} onChange={setFeatures} />
        </fieldset>
        {editable && (
          <div className="btn-row">
            <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…">
              Save changes
            </Button>
            <Button onClick={() => navigate(back.to)}>Cancel</Button>
          </div>
        )}
      </form>
    </>
  );
}

export { Section };
