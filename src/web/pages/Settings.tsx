import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { ApiFailure, api } from '../api';
import type { EventFeatures, EventStatus } from '../../shared/schemas';
import { EVENT_TRANSITIONS } from '../../shared/lifecycle';
import { useSession } from '../session';
import { useApi } from '../useApi';
import { Badge, Banner, Button, Field, Icon, InfoTip, PageHeader, Section, Toggle, plural, useConfirm, useToast } from '../ui';
import type { IconName } from '../ui';
import { checkEventForm } from './Events';
import type { EventForm } from './Events';
import { FEATURE_COPY } from './featureCopy';
import { SaveBar } from '../ui/EventSaveBar';
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

/** Settings: one card per area this person can change, then the event's status. */
export function SettingsIndex() {
  const { event, can, reload, base: eventBase, onSite } = useEvent();
  const { me } = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const staff = useApi<{ staff: unknown[] }>(can('staff.manage') ? `/events/${event.id}/staff` : null);
  const stations = useApi<{ stations: unknown[] }>(can('stations.manage') ? `/events/${event.id}/stations` : null);
  const canCopy = !onSite && me?.kind === 'user' && me.platformPermissions.includes('platform.events.create');

  const rows = [
    can('event.configure') && { to: 'event', icon: 'events', title: 'Event details', meta: 'Name, dates, location, features' },
    can('event.configure') && { to: 'banner', icon: 'image', title: 'Participant page banner', meta: 'Top of each participant’s page' },
    can('event.configure') && { to: 'lanyards', icon: 'band', title: 'Lanyards', meta: 'Card design' },
    can('staff.manage') && {
      to: 'staff',
      icon: 'team',
      title: 'Staff',
      meta: staff.data ? `${plural(staff.data.staff.length, 'person', 'people')} · roles` : 'Who works here, and their roles',
    },
    can('stations.manage') && {
      to: 'stations',
      icon: 'scan',
      title: 'Scanning stations',
      meta: stations.data ? `${plural(stations.data.stations.length, 'station')} · shared tablets` : 'Shared tablets locked to one job',
    },
    canCopy && { to: 'copy', icon: 'copy', title: 'Copy event', meta: "Start next year's camp from it" },
  ].filter((r): r is { to: string; icon: IconName; title: string; meta: string } => Boolean(r));

  const changes = can('event.close') ? EVENT_TRANSITIONS[event.status].filter((to) => CHANGES[to]) : [];

  if (rows.length === 0 && changes.length === 0) return <Navigate to={eventBase || '/'} replace />;

  return (
    <>
      <PageHeader title="Settings" />
      <div className="sections">
        {rows.length > 0 && (
          <ul className="settings-grid">
            {rows.map((r) => (
              <li key={r.to} className="panel settings-card row-link">
                <span className="settings-card-icon" aria-hidden="true">
                  <Icon name={r.icon} />
                </span>
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
          <section className="panel settings-status" aria-labelledby="status-heading">
            <div className="settings-status-text">
              <h2 id="status-heading">Event status</h2>
              <Badge tone={event.status === 'draft' ? 'warning' : 'neutral'}>{STATUS_WORD[event.status]}</Badge>
              <InfoTip label="About event status">Open a draft from Home. Close an open event from Reports.</InfoTip>
            </div>
            <div className="btn-row">
              {changes.map((to) => {
                const c = CHANGES[to]!;
                return (
                  <Button
                    key={to}
                    kind="secondary"
                    small
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

/** One short line under each feature switch; the full explanation is behind its (i). */
const FEATURE_SHORT: Record<keyof EventFeatures, string> = {
  site: 'Scan on and off site',
  activities: 'Scan in and out of activities',
  meals: 'Count who has eaten',
  selfSignup: 'People book sessions themselves',
  sideQuest: 'A secret lanyard-collecting game',
};
const FEATURE_GROUPS: { title: string; keys: (keyof EventFeatures)[] }[] = [
  { title: 'Scanning', keys: ['site', 'activities', 'meals'] },
  { title: 'Extras', keys: ['selfSignup', 'sideQuest'] },
];

/** Settings › Event details: name, dates, location, notes and features. */
export function EventDetails() {
  const { event, can, reload } = useEvent();
  const { base: eventBase } = useEvent();
  const navigate = useNavigate();
  const toast = useToast();
  const editable = can('event.configure') && (event.status === 'draft' || event.status === 'open');
  const [initial] = useState(() => ({
    form: { name: event.name, location: event.location, startsOn: event.startsOn, endsOn: event.endsOn, description: event.description } as EventForm,
    features: event.features,
    contactEmail: event.contactEmail ?? '',
  }));
  const [form, setForm] = useState<EventForm>(initial.form);
  const [features, setFeatures] = useState<EventFeatures>(initial.features);
  const [contactEmail, setContactEmail] = useState(initial.contactEmail);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof EventForm) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const back = { to: `${eventBase}/settings`, label: 'Settings' };
  const dirty =
    (Object.keys(form) as (keyof EventForm)[]).some((k) => form[k] !== initial.form[k]) ||
    (Object.keys(features) as (keyof EventFeatures)[]).some((k) => features[k] !== initial.features[k]) ||
    contactEmail !== initial.contactEmail;

  if (!can('event.configure')) return <Navigate to={back.to} replace />;

  async function save(e: FormEvent) {
    e.preventDefault();
    const local = checkEventForm(form);
    setErrors(local);
    setFailure(null);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      await api(`/events/${event.id}`, { method: 'PATCH', body: { ...form, features, contactEmail: contactEmail.trim() } });
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

  const problems = Object.keys(errors).length;

  return (
    <>
      <PageHeader title="Event details" back={back} summary={!editable ? <Badge>{STATUS_WORD[event.status]}</Badge> : undefined} />
      <form className="settings-form" onSubmit={save} noValidate>
        {(!editable || failure) && (
          <div className="banners">
            {!editable && <Banner>Locked while the event is {STATUS_WORD[event.status].toLowerCase()}. Reopen it to make changes.</Banner>}
            {failure && <Banner tone="error">{failure}</Banner>}
          </div>
        )}
        <fieldset className="settings-columns" disabled={!editable || busy}>
          <div className="panel panel-pad settings-panel">
            <h2 className="settings-panel-title">Details</h2>
            <Field id="name" label="Event name" error={errors.name}>
              <input className="input" value={form.name} onChange={set('name')} autoComplete="off" />
            </Field>
            <div className="field-pair">
              <Field id="startsOn" label="First day" error={errors.startsOn}>
                <input className="input" type="date" value={form.startsOn} onChange={set('startsOn')} />
              </Field>
              <Field id="endsOn" label="Last day" error={errors.endsOn}>
                <input className="input" type="date" value={form.endsOn} onChange={set('endsOn')} />
              </Field>
            </div>
            <Field id="location" label="Location" optional error={errors.location}>
              <input className="input" value={form.location} onChange={set('location')} placeholder="For example, Woodhouse Activity Centre" />
            </Field>
            <Field id="ev-contact" label="Contact email" optional hint="Shown on booking links, for changes to a booking" error={errors.contactEmail}>
              <input className="input" type="email" value={contactEmail} maxLength={200} onChange={(e) => setContactEmail(e.target.value)} autoComplete="off" />
            </Field>
            <Field id="description" label="Notes for staff" optional hint="Shown on Home to everyone on staff" error={errors.description}>
              <textarea className="textarea" rows={4} value={form.description} onChange={set('description')} />
            </Field>
          </div>
          <div className="panel panel-pad settings-panel">
            <h2 className="settings-panel-title">Features</h2>
            {FEATURE_GROUPS.map((g) => (
              <fieldset key={g.title} className="feature-group">
                <legend className="feature-group-title">{g.title}</legend>
                {g.keys.map((key) => (
                  <div key={key} className="feature-row">
                    <Toggle checked={features[key]} onChange={(on) => setFeatures({ ...features, [key]: on })} label={FEATURE_COPY[key].label} hint={FEATURE_SHORT[key]} />
                    <InfoTip label={`About ${FEATURE_COPY[key].label}`}>{FEATURE_COPY[key].hint}</InfoTip>
                  </div>
                ))}
              </fieldset>
            ))}
          </div>
        </fieldset>
        {editable && <SaveBar dirty={dirty} busy={busy} problems={problems} onCancel={() => navigate(back.to)} />}
      </form>
    </>
  );
}

export { Section };
