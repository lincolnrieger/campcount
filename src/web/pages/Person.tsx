import { useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import type { DietaryEntryInput } from '../../shared/schemas';
import { SECTIONS } from '../../shared/sections';
import { dayInZone, dayLabel, timeInZone, timeRange } from '../../shared/time';
import { ApiFailure, api } from '../api';
import { DietaryEditor, describeEntry } from '../components/DietaryEditor';
import type { Card } from '../lanyards/pdf';
import type { Where } from '../model';
import { scanVerb } from '../model';
import { recordByHand } from '../scan/manual';
import { useApi } from '../useApi';
import { Badge, Button, EmptyState, Field, Icon, LoadError, Loading, Menu, PageHeader, Section, Sheet, SkeletonHeader, SkeletonRows, useConfirm, useToast } from '../ui';
import type { MenuItem, Tone } from '../ui';
import { useEvent } from './EventLayout';

interface PersonData {
  registration: {
    id: string;
    memberNumber: string;
    firstName: string;
    preferredName: string;
    lastName: string;
    displayName: string;
    kind: 'youth' | 'adult';
    section: string;
    groupName: string;
    position: string;
    status: 'active' | 'withdrawn';
    shortCode: string | null;
    photoConsent?: 'yes' | 'no' | 'unknown';
    dietary?: DietaryEntryInput[];
  };
  can: { edit: boolean; editDietary: boolean; cards: boolean };
  where: Where | null;
  bookings: { activityId: string; name: string; startsAt: string | null; endsAt: string | null; selfBooked: boolean }[];
  history: { id: string; at: string; type: 'activity' | 'meal' | 'site'; place: string; direction: 'in' | 'out'; method: string; outcome: string; message: string; by: string }[];
}

const OUTCOME: Record<string, { label: string; tone: Tone } | undefined> = {
  duplicate: { label: 'Repeat, not counted', tone: 'neutral' },
  review: { label: 'To check', tone: 'warning' },
  rejected: { label: 'Refused', tone: 'error' },
  void: { label: 'Undone', tone: 'neutral' },
};

/** Where they are right now, as one big line (plus any activities). */
function RightNow({ where, tz }: { where: Where; tz: string }) {
  const t = (iso: string | null) => (iso ? timeInZone(iso, tz) : '');
  const site =
    where.site === 'on'
      ? { text: `On site since ${t(where.siteSince)}`, tone: 'success' as const }
      : where.site === 'off'
        ? { text: `Left camp at ${t(where.siteSince)}`, tone: 'neutral' as const }
        : where.site === 'never'
          ? { text: 'Not arrived yet', tone: 'warning' as const }
          : null;
  return (
    <div className="right-now">
      {site && (
        <p className={`right-now-main right-now-${site.tone}`}>
          <Icon name={site.tone === 'success' ? 'success' : site.tone === 'warning' ? 'warning' : 'info'} size={24} />
          {site.text}
        </p>
      )}
      {where.activities.map((a) => (
        <p key={a.key} className="right-now-main right-now-info">
          <Icon name="info" size={24} />
          At {a.name} since {t(a.since)}
        </p>
      ))}
      <p className="meta">
        {where.lastSeen
          ? `Last scanned: ${scanVerb(where.lastSeen.type, where.lastSeen.direction).toLowerCase()} at ${where.lastSeen.contextName}, ${t(where.lastSeen.at)}`
          : 'Not scanned anywhere yet'}
      </p>
    </div>
  );
}

/** One person on the event: where they are now, their needs, their activities and their history. */
export function Person() {
  const { event, can, base } = useEvent();
  const { registrationId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const confirm = useConfirm();
  const path = `/events/${event.id}/registrations/${registrationId}`;
  const { data, error, loading, reload } = useApi<PersonData>(path);
  const [editingDiet, setEditingDiet] = useState<DietaryEntryInput[] | null>(null);
  const fromHome = (location.state as { from?: string } | null)?.from === 'home';
  const back = fromHome ? { to: base || '/', label: 'Home' } : { to: `${base}/people`, label: 'People' };

  const fail = (err: unknown) => toast(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.', { tone: 'error' });

  if (loading && !data)
    return (
      <Loading what="this person">
        <SkeletonHeader />
        <SkeletonRows rows={2} />
        <SkeletonRows rows={4} />
      </Loading>
    );
  if (error)
    return (
      <>
        <PageHeader title="Person" back={back} />
        <LoadError error={error} onRetry={reload} what="this person" message={error.status === 404 ? 'This person is no longer on the event.' : undefined} />
      </>
    );
  if (!data) return null;
  const r = data.registration;
  const fullName = `${r.preferredName || r.firstName} ${r.lastName}`;
  const tz = event.timezone;
  const allergy = r.dietary?.some((d) => d.category === 'allergy');
  const canMark = event.status === 'open' && event.features.site && can('site.scan') && data.where?.site && r.status === 'active';
  const leaving = data.where?.site === 'on';

  async function mark() {
    try {
      const res = await recordByHand(event.id, { contextType: 'site', contextId: null, direction: leaving ? 'out' : 'in', registrationId: r.id });
      if (res.outcome === 'accepted') toast(`${fullName} marked ${leaving ? 'left' : 'arrived'}`);
      else toast(res.message, { tone: 'error' });
      await reload();
    } catch (err) {
      fail(err);
    }
  }

  async function downloadCard() {
    try {
      const res = await api<{ cards: Card[] }>(`/events/${event.id}/credentials/print`, { body: { registrationIds: [r.id] } });
      const card = res.cards[0];
      if (!card) return;
      const { buildLanyardPdf, downloadPdf } = await import('../lanyards/pdf');
      downloadPdf(await buildLanyardPdf([card], 'lanyard', event.name), `${fullName.replace(/\W+/g, '-')}-lanyard.pdf`);
    } catch (err) {
      fail(err);
    }
  }

  const setStatus = (status: 'active' | 'withdrawn') => api(path, { method: 'PATCH', body: { status } });

  const menu: MenuItem[] = [
    data.can.edit && { label: 'Edit details', to: 'edit' },
    data.can.cards && r.shortCode && { label: 'Download lanyard', onSelect: () => void downloadCard() },
    data.can.cards &&
      r.status === 'active' &&
      !r.shortCode && {
        label: 'Issue lanyard',
        onSelect: async () => {
          try {
            await api(`/events/${event.id}/credentials/issue`, { body: { mode: 'missing', registrationIds: [r.id] } });
            toast('Lanyard issued. Download it from this menu.');
            await reload();
          } catch (err) {
            fail(err);
          }
        },
      },
    data.can.cards &&
      r.shortCode && {
        label: 'Replace lanyard',
        onSelect: async () => {
          const ok = await confirm({ title: `Replace ${fullName}'s lanyard?`, body: <p>The current card stops working straight away.</p>, confirm: 'Replace lanyard' });
          if (!ok) return;
          try {
            await api(`/events/${event.id}/credentials/issue`, { body: { mode: 'replace', registrationIds: [r.id] } });
            toast('New lanyard issued. Download it from this menu.');
            await reload();
          } catch (err) {
            fail(err);
          }
        },
      },
    data.can.edit &&
      (r.status === 'active'
        ? {
            label: 'Withdraw from event',
            onSelect: async () => {
              const ok = await confirm({
                title: `Withdraw ${fullName}?`,
                body: <p>Their card stops scanning. Their records are kept, and you can restore them later.</p>,
                confirm: 'Withdraw',
              });
              if (!ok) return;
              try {
                await setStatus('withdrawn');
                await reload();
                toast(`${fullName} withdrawn`, {
                  undo: async () => {
                    await setStatus('active');
                    await reload();
                  },
                });
              } catch (err) {
                fail(err);
              }
            },
          }
        : {
            label: 'Restore to event',
            onSelect: async () => {
              try {
                await setStatus('active');
                await reload();
                toast(`${fullName} is back on the event`);
              } catch (err) {
                fail(err);
              }
            },
          }),
    data.can.edit && {
      label: 'Delete person…',
      danger: true,
      onSelect: async () => {
        const scans = data.history.length;
        const ok = await confirm({
          title: `Delete ${fullName}?`,
          body: (
            <p>
              Their lanyard, dietary needs{scans ? ` and ${scans} scan${scans === 1 ? '' : 's'}` : ''} are deleted too. This can't be undone. To keep the records, withdraw them
              instead.
            </p>
          ),
          confirm: 'Delete person',
          danger: true,
        });
        if (!ok) return;
        try {
          await api(path, { method: 'DELETE' });
          toast(`Deleted ${fullName}`);
          navigate(`${base}/people`, { replace: true });
        } catch (err) {
          fail(err);
        }
      },
    },
  ].filter(Boolean) as MenuItem[];

  // History grouped by day, newest first.
  const days = new Map<string, PersonData['history']>();
  for (const h of data.history) {
    const day = new Date(h.at).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz });
    days.set(day, [...(days.get(day) ?? []), h]);
  }

  return (
    <>
      <PageHeader
        title={fullName}
        back={back}
        summary={
          <>
            <span>{[r.groupName, r.kind === 'adult' ? r.position || 'Leader' : r.section].filter(Boolean).join(' · ')}</span>
            {r.status === 'withdrawn' && <Badge tone="error">Withdrawn</Badge>}
            {r.photoConsent === 'no' && <Badge tone="error">No photos</Badge>}
            {allergy && <Badge tone="error">Allergy</Badge>}
          </>
        }
        primary={
          canMark && (
            <Button kind="primary" busyLabel="Saving…" onAction={mark}>
              {leaving ? 'Mark as left' : 'Mark as arrived'}
            </Button>
          )
        }
        menu={menu.length ? menu : undefined}
        menuLabel={`More actions for ${fullName}`}
      />

      <div className="columns">
        <div className="sections">
          {data.where && (
            <Section title="Right now" id="now">
              <div className="panel panel-pad">
                <RightNow where={data.where} tz={tz} />
              </div>
            </Section>
          )}

          {r.dietary && (
            <Section
              title="Dietary needs"
              id="diet"
              actions={
                data.can.editDietary && (
                  <Button small kind="ghost" onClick={() => setEditingDiet(r.dietary ?? [])}>
                    Edit
                  </Button>
                )
              }
            >
              {r.dietary.length === 0 ? (
                <p className="meta">None recorded.</p>
              ) : (
                <ul className="list">
                  {r.dietary.map((d, i) => (
                    <li key={i} className="row">
                      {d.category === 'allergy' ? <Badge tone="error">Allergy</Badge> : null}
                      <span className="row-main">{describeEntry(d)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          <Section title="Activities" id="acts">
            {data.bookings.length === 0 ? (
              <p className="meta">Not signed up for any activities.</p>
            ) : (
              <ul className="list">
                {data.bookings.map((b) => (
                  <li key={b.activityId} className="row">
                    <span className="row-main">
                      <span className="row-title">{b.name}</span>
                      <span className="row-meta">
                        {b.startsAt ? `${dayLabel(dayInZone(b.startsAt, tz))}, ${timeRange(b.startsAt, b.endsAt, tz)}` : 'Any time'}
                        {b.selfBooked ? '' : ' · booked by leaders'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="sections">
          <Section title="History" id="history">
            {data.history.length === 0 ? (
              <EmptyState title="No scans yet" />
            ) : (
              [...days].map(([day, items]) => (
                <div key={day} className="list">
                  <p className="list-group-heading">{day}</p>
                  <ol>
                    {items.map((h) => {
                      const tag = OUTCOME[h.outcome];
                      const undoable = can('attendance.correct') && h.outcome !== 'void' && h.outcome !== 'rejected';
                      return (
                        <li key={h.id} className={h.outcome === 'accepted' ? 'row' : 'row is-muted'}>
                          <span className="history-time num">{timeInZone(h.at, tz)}</span>
                          <span className="row-main">
                            <span className={h.outcome === 'void' ? 'row-title is-struck' : 'row-title'}>
                              {scanVerb(h.type, h.direction)} · {h.place}
                            </span>
                            <span className="row-meta">
                              {[h.by && `by ${h.by}`, h.method === 'manual' ? 'by hand' : h.method === 'code' ? 'typed code' : null].filter(Boolean).join(' · ')}
                            </span>
                            {tag && (
                              <span>
                                <Badge tone={tag.tone}>{tag.label}</Badge>
                              </span>
                            )}
                          </span>
                          {undoable && (
                            <span className="row-side">
                              <Menu
                                label={`Options for ${scanVerb(h.type, h.direction).toLowerCase()} at ${timeInZone(h.at, tz)}`}
                                items={[
                                  {
                                    label: 'Undo this scan',
                                    danger: true,
                                    onSelect: async () => {
                                      const ok = await confirm({
                                        title: 'Undo this scan?',
                                        body: (
                                          <p>
                                            {scanVerb(h.type, h.direction)} at {h.place}, {timeInZone(h.at, tz)}. It stays in the history, marked as undone.
                                          </p>
                                        ),
                                        confirm: 'Undo scan',
                                        danger: true,
                                      });
                                      if (!ok) return;
                                      try {
                                        await api(`/events/${event.id}/scans/${h.id}/void`, { body: { reason: 'Undone from the person page' } });
                                        toast('Scan undone');
                                        await reload();
                                      } catch (err) {
                                        fail(err);
                                      }
                                    },
                                  },
                                ]}
                              />
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))
            )}
          </Section>

          <Section title="Details" id="details">
            <dl className="panel panel-pad dl">
              <div>
                <dt>Name</dt>
                <dd>
                  {r.firstName} {r.lastName}
                  {r.preferredName && ` (goes by ${r.preferredName})`}
                </dd>
              </div>
              <div>
                <dt>Membership number</dt>
                <dd>{r.memberNumber || 'Not a member'}</dd>
              </div>
              <div>
                <dt>{r.kind === 'adult' ? 'Role' : 'Section'}</dt>
                <dd>{r.kind === 'adult' ? r.position || 'Leader' : r.section}</dd>
              </div>
              <div>
                <dt>Scout group</dt>
                <dd>{r.groupName || 'Not recorded'}</dd>
              </div>
              {r.photoConsent && (
                <div>
                  <dt>Photos</dt>
                  <dd>{r.photoConsent === 'yes' ? 'OK to photograph' : r.photoConsent === 'no' ? 'No photos' : 'Not recorded'}</dd>
                </div>
              )}
              {data.can.cards && (
                <div>
                  <dt>Lanyard</dt>
                  <dd>{r.shortCode ? <span className="code">{r.shortCode}</span> : 'Not issued'}</dd>
                </div>
              )}
            </dl>
          </Section>
        </div>
      </div>

      <Sheet open={editingDiet !== null} title="Dietary needs" onClose={() => setEditingDiet(null)}>
        {editingDiet !== null && (
          <>
            <DietaryEditor value={editingDiet} onChange={setEditingDiet} labelPrefix={fullName} />
            <div className="btn-row">
              <Button
                kind="primary"
                busyLabel="Saving…"
                onAction={async () => {
                  try {
                    await api(`${path}/dietary`, { method: 'PUT', body: { entries: editingDiet } });
                    setEditingDiet(null);
                    toast('Dietary needs saved');
                    await reload();
                  } catch (err) {
                    fail(err);
                  }
                }}
              >
                Save changes
              </Button>
              <Button onClick={() => setEditingDiet(null)}>Cancel</Button>
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}

/** People › person › Edit details. */
export function PersonEdit() {
  const { event, base } = useEvent();
  const { registrationId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const path = `/events/${event.id}/registrations/${registrationId}`;
  const { data, error, loading, reload } = useApi<PersonData>(path);
  const back = { to: `${base}/people/${registrationId}`, label: 'Back' };
  if (loading && !data)
    return (
      <Loading what="this person">
        <SkeletonHeader />
        <SkeletonRows rows={4} />
      </Loading>
    );
  if (error)
    return (
      <>
        <PageHeader title="Edit details" back={back} />
        <LoadError error={error} onRetry={reload} what="this person" />
      </>
    );
  if (!data) return null;
  return (
    <DetailsForm
      r={data.registration}
      back={back}
      onSaved={() => {
        toast('Changes saved');
        navigate(back.to);
      }}
      path={path}
    />
  );
}

function DetailsForm({ r, back, path, onSaved }: { r: PersonData['registration']; back: { to: string; label: string }; path: string; onSaved: () => void }) {
  const navigate = useNavigate();
  const [f, setF] = useState({
    firstName: r.firstName,
    preferredName: r.preferredName,
    lastName: r.lastName,
    memberNumber: r.memberNumber,
    kind: r.kind,
    section: r.section,
    groupName: r.groupName,
    position: r.position,
    photoConsent: r.photoConsent,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const name = `${r.preferredName || r.firstName} ${r.lastName}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!f.firstName.trim()) local.firstName = 'Enter a first name';
    if (!f.lastName.trim()) local.lastName = 'Enter a last name';
    setErrors(local);
    if (Object.keys(local).length) return;
    const body: Record<string, string> = {};
    for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== (r as unknown as Record<string, unknown>)[k]) body[k] = v;
    setBusy(true);
    setFailure(null);
    try {
      await api(path, { method: 'PATCH', body });
      onSaved();
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
      <PageHeader title="Edit details" back={back} summary={name} />
      <form className="form" onSubmit={submit} noValidate>
        {failure && (
          <p className="field-error" role="alert">
            <Icon name="error" size={16} />
            {failure}
          </p>
        )}
        <div className="field-pair">
          <Field id="p-first" label="First name" error={errors.firstName}>
            <input className="input" value={f.firstName} onChange={set('firstName')} autoComplete="off" />
          </Field>
          <Field id="p-last" label="Last name" error={errors.lastName}>
            <input className="input" value={f.lastName} onChange={set('lastName')} autoComplete="off" />
          </Field>
        </div>
        <Field id="p-pref" label="Goes by" optional hint="Shown on their lanyard instead of their first name.">
          <input className="input" value={f.preferredName} onChange={set('preferredName')} autoComplete="off" />
        </Field>
        <Field id="p-member" label="Membership number" error={errors.memberNumber}>
          <input className="input" inputMode="numeric" value={f.memberNumber} onChange={set('memberNumber')} autoComplete="off" />
        </Field>
        <div className="field-pair">
          <Field id="p-kind" label="Youth or leader">
            <select className="select" value={f.kind} onChange={set('kind')}>
              <option value="youth">Youth</option>
              <option value="adult">Leader</option>
            </select>
          </Field>
          <Field id="p-section" label="Section">
            <select className="select" value={f.section} onChange={set('section')}>
              {SECTIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field id="p-group" label="Scout group" optional>
          <input className="input" value={f.groupName} onChange={set('groupName')} autoComplete="off" />
        </Field>
        {f.kind === 'adult' && (
          <Field id="p-position" label="Role" optional hint="For example, Cub Leader, cook, first aider">
            <input className="input" value={f.position} onChange={set('position')} autoComplete="off" />
          </Field>
        )}
        {f.photoConsent !== undefined && (
          <Field id="p-photo" label="Photos">
            <select className="select" value={f.photoConsent} onChange={set('photoConsent')}>
              <option value="yes">OK to photograph</option>
              <option value="no">No photos</option>
              <option value="unknown">Not recorded</option>
            </select>
          </Field>
        )}
        <div className="btn-row">
          <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…">
            Save changes
          </Button>
          <Button onClick={() => navigate(back.to)}>Cancel</Button>
        </div>
      </form>
    </>
  );
}
