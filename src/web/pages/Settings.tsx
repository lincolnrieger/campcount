import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { ApiFailure, api } from '../api';
import { ActionButton, Field, Notice } from '../components/ui';
import { useToast } from '../components/Toast';
import type { EventFeatures, EventStatus } from '../../shared/schemas';
import { EVENT_TRANSITIONS } from '../../shared/lifecycle';
import { FeatureChecklist } from './Events';
import { useEvent } from './EventLayout';
import { useTitle } from '../useTitle';

/** Settings: the event itself, its staff and its stations, each shown only to roles that can change it. */
export function SettingsLayout() {
  const { event, can } = useEvent();
  const { pathname } = useLocation();
  const tabs = [
    { to: '', label: 'Event', show: can('event.configure') },
    { to: 'staff', label: 'Staff', show: can('staff.manage') },
    { to: 'stations', label: 'Stations', show: can('stations.manage') },
  ].filter((t) => t.show);
  const atIndex = /\/settings\/?$/.test(pathname);
  if (tabs.length === 0) return <Navigate to={`/events/${event.id}`} replace />;
  if (atIndex && !can('event.configure')) return <Navigate to={tabs[0]!.to} replace />;
  return (
    <>
      {tabs.length > 1 && (
        <nav className="pillnav" aria-label="Settings">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end>
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
      <Outlet />
    </>
  );
}

const TRANSITION_COPY: Partial<Record<EventStatus, { label: string; confirm: string; tone: string; done: string }>> = {
  open: { label: 'Open event', confirm: 'Open this event? Assigned staff will be able to scan.', tone: 'btn', done: 'Event opened. Staff can scan now.' },
  completed: {
    label: 'Close event',
    confirm: 'Close this event? Scanning stops and settings are locked. You can reopen it for corrections.',
    tone: 'btn btn-secondary',
    done: 'Event closed.',
  },
  cancelled: { label: 'Cancel event', confirm: 'Cancel this event? Nobody will be able to scan.', tone: 'btn btn-danger', done: 'Event cancelled.' },
  draft: { label: 'Return to draft', confirm: 'Move this cancelled event back to draft?', tone: 'btn btn-secondary', done: 'Event is a draft again.' },
};

/** The status buttons for an event (Open, Close, Cancel…), each confirmed first. Also used on Overview's setup checklist. */
export function StatusActions({ only }: { only?: EventStatus[] }) {
  const { event, can, reload } = useEvent();
  const toast = useToast();
  const [failure, setFailure] = useState<string | null>(null);
  const transitions = EVENT_TRANSITIONS[event.status].filter((to) => {
    if (to === 'archived') return false; // platform admins archive from the admin area
    if (only && !only.includes(to)) return false;
    if (event.status === 'draft' && to === 'open') return can('event.configure');
    return can('event.close');
  });
  if (transitions.length === 0) return null;
  // Safe changes first, the destructive one last.
  transitions.sort((a, b) => Number(a === 'cancelled') - Number(b === 'cancelled'));
  return (
    <>
      {failure && <Notice tone="stop">{failure}</Notice>}
      <div className="actions">
        {transitions.map((to) => {
          const base = TRANSITION_COPY[to]!;
          const copy =
            event.status === 'completed' && to === 'open'
              ? { ...base, label: 'Reopen event', confirm: 'Reopen this event for corrections? Scanning starts again.', tone: 'btn btn-secondary', done: 'Event reopened.' }
              : base;
          return (
            <ActionButton
              key={to}
              className={`${copy.tone}${to === 'cancelled' ? ' push-end' : ''}`}
              busyLabel="Working…"
              onAction={async () => {
                if (!window.confirm(copy.confirm)) return;
                try {
                  await api(`/events/${event.id}/transition`, { body: { to } });
                  setFailure(null);
                  await reload();
                  toast(copy.done);
                } catch (err) {
                  setFailure(err instanceof ApiFailure ? err.message : 'Something went wrong. Check your signal and try again.');
                }
              }}
            >
              {copy.label}
            </ActionButton>
          );
        })}
      </div>
    </>
  );
}

/** Settings › Event: details, features and status. */
export function EventSettings() {
  useTitle('Event settings');
  const { event, can, reload } = useEvent();
  const toast = useToast();
  const editable = can('event.configure') && (event.status === 'draft' || event.status === 'open');
  const initial = { name: event.name, location: event.location, startsOn: event.startsOn, endsOn: event.endsOn, description: event.description };
  const [form, setForm] = useState(initial);
  const [features, setFeatures] = useState<EventFeatures>(event.features);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || JSON.stringify(features) !== JSON.stringify(event.features);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    setErrors({});
    try {
      await api(`/events/${event.id}`, { method: 'PATCH', body: { ...form, features } });
      await reload();
      toast('Changes saved.');
    } catch (err) {
      if (err instanceof ApiFailure) {
        setErrors(err.fieldErrors());
        setFailure(err.message);
      } else setFailure('Something went wrong. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narrow">
      {!editable && <Notice title={`This event is ${event.status}`}>Settings are locked. Reopen the event to change them.</Notice>}
      <form onSubmit={save} noValidate>
        <h2 className="visually-hidden">Event details</h2>
        {failure && <Notice tone="stop">{failure}</Notice>}
        <fieldset className="fieldset-plain" disabled={!editable || busy}>
          <Field id="ev-name" label="Event name" error={errors.name}>
            <input id="ev-name" className="input" value={form.name} onChange={set('name')} />
          </Field>
          <Field id="ev-location" label="Location" error={errors.location}>
            <input id="ev-location" className="input" value={form.location} onChange={set('location')} />
          </Field>
          <div className="row">
            <Field id="ev-start" label="First day" error={errors.startsOn}>
              <input id="ev-start" className="input" type="date" value={form.startsOn} onChange={set('startsOn')} />
            </Field>
            <Field id="ev-end" label="Last day" error={errors.endsOn}>
              <input id="ev-end" className="input" type="date" value={form.endsOn} onChange={set('endsOn')} />
            </Field>
          </div>
          <Field id="ev-notes" label="Notes for staff" hint="Shown on the event's Overview to everyone assigned." error={errors.description}>
            <textarea id="ev-notes" className="input" rows={3} value={form.description} onChange={set('description')} />
          </Field>
          <FeatureChecklist value={features} onChange={setFeatures} />
        </fieldset>
        {editable && (
          <div className="actions">
            <button className="btn" disabled={!dirty || busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            {dirty && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => {
                  setForm(initial);
                  setFeatures(event.features);
                  setErrors({});
                }}
              >
                Discard changes
              </button>
            )}
          </div>
        )}
      </form>

      {(can('event.configure') || can('event.close')) && EVENT_TRANSITIONS[event.status].some((s) => s !== 'archived') && (
        <section aria-labelledby="status-heading" className="section-gap danger-zone">
          <h2 id="status-heading">Event status</h2>
          <p className="field-hint">
            {event.status === 'draft'
              ? 'Nobody can scan until the event is open.'
              : event.status === 'open'
                ? 'Closing stops scanning and locks settings. Check Reports first.'
                : event.status === 'completed'
                  ? 'Reopen the event to make late corrections.'
                  : 'A cancelled event can go back to draft.'}
          </p>
          <StatusActions />
        </section>
      )}
    </div>
  );
}
