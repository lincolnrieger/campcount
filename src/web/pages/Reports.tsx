import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { minutesAgo } from '../model';
import { useApi } from '../useApi';
import { Badge, Button, Field, Icon, LoadError, Loading, Menu, Notice, PageHeader, Section, Sheet, SkeletonRows, plural, useConfirm, useToast } from '../ui';
import { useEvent } from './EventLayout';

interface Item {
  kind: 'still_present' | 'review' | 'unknown_card';
  contextKey: string;
  contextName: string;
  name: string;
  detail: string;
  at: string | null;
  scanId: string | null;
}
interface Reconciliation {
  items: Item[];
  devices: { deviceId: string; lastUpload: string; scans: number }[];
  pendingDietary: number;
  timezone: string;
}

/** One line on what each download holds. */
const DESCRIPTION: Record<string, string> = {
  attendance: 'Every scan, with time, place and who scanned it',
  'activity-summary': 'Each activity: bookings, people who came, sign-outs',
  'meal-counts': 'Each meal: how many were served',
  site: 'Each person: when they arrived and left camp',
  catering: 'Totals for each dietary need, for the kitchen',
  'dietary-list': 'Each person and their dietary needs',
};
const SENSITIVE = new Set(['dietary-list', 'catering']);

const fail = (err: unknown) => (err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');

/** Ask for the reason a correction is made (kept in the record). */
function ReasonForm({ label, defaultReason, submitLabel, onSubmit, onCancel }: { label: string; defaultReason: string; submitLabel: string; onSubmit: (reason: string) => Promise<void>; onCancel: () => void }) {
  const [reason, setReason] = useState(defaultReason);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) return setError('Give a reason of at least 3 characters');
    setError(undefined);
    setBusy(true);
    try {
      await onSubmit(reason.trim());
    } catch (err) {
      setError(fail(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form" onSubmit={submit} noValidate>
      <p>{label}</p>
      <Field id="reason" label="Reason" hint="Kept in the record." error={error}>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoComplete="off" />
      </Field>
      <div className="btn-row">
        <Button type="submit" kind="primary" busy={busy} busyLabel="Saving…">
          {submitLabel}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/** Reports: the check-up before closing, downloads, and closing the event. */
export function Reports() {
  const { event, can, reload: reloadEvent } = useEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const rec = useApi<Reconciliation>(`/events/${event.id}/reconciliation`);
  const exports = useApi<{ exports: { key: string; label: string }[] }>(`/events/${event.id}/exports`);
  const [ask, setAsk] = useState<{ title: string; label: string; defaultReason: string; submitLabel: string; run: (reason: string) => Promise<void> } | null>(null);
  // When the page loaded, for spotting phones that haven't uploaded for a while.
  const [loadedAt] = useState(() => Date.now());
  const correct = can('attendance.correct') && (event.status === 'open' || event.status === 'completed');

  const header = <PageHeader title="Reports" summary="Check everything is sorted, download records, then close the event." />;
  if (rec.loading && !rec.data)
    return (
      <>
        {header}
        <Loading what="reports">
          <SkeletonRows rows={4} action />
        </Loading>
      </>
    );
  if (rec.error)
    return (
      <>
        {header}
        <LoadError error={rec.error} onRetry={rec.reload} what="reports" />
      </>
    );
  const data = rec.data!;
  const items = data.items;
  const groups = [...new Set(items.map((i) => i.contextKey))];
  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: data.timezone }) : '');
  const stale = data.devices.filter((d) => loadedAt - Date.parse(d.lastUpload) > 60 * 60_000);
  const allClear = items.length === 0 && data.pendingDietary === 0 && stale.length === 0;

  async function transition(to: 'completed' | 'open') {
    const closing = to === 'completed';
    const ok = await confirm({
      title: closing ? `Close ${event.name}?` : `Reopen ${event.name}?`,
      body: closing ? (
        <p>
          {items.length > 0 ? `${plural(items.length, 'record')} still to sort out. ` : ''}Scanning stops and settings are locked. You can reopen it for late corrections.
        </p>
      ) : (
        <p>Staff can scan again and settings can be changed.</p>
      ),
      confirm: closing ? 'Close event' : 'Reopen event',
    });
    if (!ok) return;
    try {
      await api(`/events/${event.id}/transition`, { body: { to } });
      toast(closing ? 'Event closed' : 'Event reopened');
      await reloadEvent();
    } catch (err) {
      toast(fail(err), { tone: 'error' });
    }
  }

  return (
    <>
      {header}
      <div className="sections">
        <Section title="Check-up" id="checkup">
          {allClear ? (
            <Notice tone="success" title="All clear">
              <p>No one is still signed in, no scans need checking, and every phone has uploaded.</p>
            </Notice>
          ) : (
            <p className="meta">Sort these out before you close. Scan records are not proof of where someone is and don't replace a roll call.</p>
          )}

          {data.pendingDietary > 0 && (
            <Notice tone="warning">
              <p>{plural(data.pendingDietary, 'person has', 'people have')} dietary notes still to review. Import the roster again to review them.</p>
            </Notice>
          )}

          {groups.map((key) => {
            const list = items.filter((i) => i.contextKey === key);
            const present = list.filter((i) => i.kind === 'still_present');
            const site = key === 'site:';
            const place = list[0]!.contextName || 'Unknown place';
            return (
              <div key={key} className="list">
                <div className="row checkup-head">
                  <span className="row-main">
                    <span className="row-title">{site ? 'Gate' : place}</span>
                    <span className="row-meta">
                      {present.length > 0 && `${plural(present.length, 'person', 'people')} still ${site ? 'on site' : 'signed in'}`}
                      {present.length > 0 && present.length < list.length && ' · '}
                      {list.length > present.length && `${plural(list.length - present.length, 'scan')} to check`}
                    </span>
                  </span>
                  {correct && present.length > 0 && (
                    <span className="row-side">
                      <Button
                        small
                        onClick={() =>
                          setAsk({
                            title: site ? 'Record departures' : 'Sign everyone out',
                            label: site
                              ? `Record ${plural(present.length, 'departure')} from the gate now.`
                              : `Sign ${plural(present.length, 'person', 'people')} out of ${place} now.`,
                            defaultReason: site ? 'Confirmed departed at end of camp' : 'Activity finished',
                            submitLabel: site ? 'Record departures' : 'Sign everyone out',
                            run: async (reason) => {
                              await api(`/events/${event.id}/reconciliation/sign-out-all`, { body: { contextKey: key, reason } });
                              toast(site ? `Recorded ${plural(present.length, 'departure')}` : `Signed out ${plural(present.length, 'person', 'people')}`);
                              setAsk(null);
                              await rec.reload();
                            },
                          })
                        }
                      >
                        {site ? 'Record departures' : 'Sign everyone out'}
                      </Button>
                    </span>
                  )}
                </div>
                <ul>
                  {list.map((i, n) => (
                    <li key={`${i.scanId ?? i.name}-${n}`} className="row">
                      <span className="row-main">
                        <span>{i.name}</span>
                        <span className="row-meta">{[i.detail, time(i.at)].filter(Boolean).join(' · ')}</span>
                      </span>
                      {i.kind === 'unknown_card' && <Badge tone="warning">Unknown card</Badge>}
                      {i.kind === 'review' && <Badge tone="warning">To check</Badge>}
                      {correct && i.scanId && (
                        <span className="row-side">
                          <Menu
                            label={`Options for ${i.name}`}
                            items={[
                              {
                                label: "Don't count this scan",
                                danger: true,
                                onSelect: () =>
                                  setAsk({
                                    title: "Don't count this scan",
                                    label: `${i.name}: ${i.detail}. It stays in the history, marked as undone.`,
                                    defaultReason: '',
                                    submitLabel: "Don't count it",
                                    run: async (reason) => {
                                      await api(`/events/${event.id}/scans/${i.scanId}/void`, { body: { reason } });
                                      toast('Scan corrected');
                                      setAsk(null);
                                      await rec.reload();
                                    },
                                  }),
                              },
                            ]}
                          />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          {data.devices.length > 0 && (
            <div className="list">
              <p className="list-group-heading">Scanning phones</p>
              <ul>
                {data.devices.map((d) => {
                  const late = stale.includes(d);
                  return (
                    <li key={d.deviceId} className="row">
                      <span className="row-main">
                        <span>Phone …{d.deviceId.slice(-4)}</span>
                        <span className="row-meta">
                          {plural(d.scans, 'scan')} · last upload {minutesAgo(d.lastUpload)}
                        </span>
                      </span>
                      {late && <Badge tone="warning">Check it has signal</Badge>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Section>

        <Section title="Downloads" id="downloads">
          {exports.loading && !exports.data ? (
            <Loading what="downloads" rows={3} />
          ) : exports.error && exports.error.status !== 403 ? (
            <LoadError error={exports.error} onRetry={exports.reload} what="downloads" />
          ) : (exports.data?.exports.length ?? 0) === 0 ? (
            <p className="meta">Your role can't download records.</p>
          ) : (
            <>
              <p className="meta">Spreadsheet files (CSV) that open in Excel. Every download is recorded in the activity log. Store them securely.</p>
              <ul className="list">
                {exports.data!.exports.map((e) => (
                  <li key={e.key} className="row">
                    <span className="row-main">
                      <span className="row-title">{e.label}</span>
                      {DESCRIPTION[e.key] && <span className="row-meta">{DESCRIPTION[e.key]}</span>}
                      {SENSITIVE.has(e.key) && (
                        <span>
                          <Badge tone="warning">Contains dietary information</Badge>
                        </span>
                      )}
                    </span>
                    <span className="row-side">
                      <a className="btn btn-secondary btn-small" href={`/api/events/${event.id}/exports/${e.key}.csv`} download>
                        <Icon name="download" />
                        Download<span className="visually-hidden"> {e.label}</span>
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        {can('event.close') && (event.status === 'open' || event.status === 'completed') && (
          <section className="danger-zone" aria-labelledby="close-heading">
            <h2 id="close-heading">{event.status === 'open' ? 'Close event' : 'Reopen event'}</h2>
            <p className="prose">
              {event.status === 'open'
                ? 'Closing stops scanning and locks settings. You can reopen it for late corrections.'
                : 'This event is closed. Reopen it to fix late records; close it again when you are done.'}
            </p>
            <div>
              <Button onAction={() => transition(event.status === 'open' ? 'completed' : 'open')} busyLabel="Saving…">
                {event.status === 'open' ? 'Close event' : 'Reopen event'}
              </Button>
            </div>
          </section>
        )}
      </div>

      <Sheet open={ask !== null} title={ask?.title ?? ''} onClose={() => setAsk(null)}>
        {ask && <ReasonForm label={ask.label} defaultReason={ask.defaultReason} submitLabel={ask.submitLabel} onSubmit={ask.run} onCancel={() => setAsk(null)} />}
      </Sheet>
    </>
  );
}
