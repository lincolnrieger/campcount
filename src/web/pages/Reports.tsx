import { useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, api } from '../api';
import { minutesAgo } from '../model';
import { useApi } from '../useApi';
import { matchesSearch } from '../../shared/search';
import {
  Badge,
  Banner,
  Button,
  ButtonLink,
  EmptyState,
  Field,
  FilterTabs,
  Icon,
  InfoTip,
  LoadError,
  Loading,
  Menu,
  PageHeader,
  SearchField,
  Sheet,
  SkeletonRows,
  StatStrip,
  Toolbar,
  plural,
  useConfirm,
  useRemembered,
  useToast,
} from '../ui';
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
  attendance: 'Every scan: time, place, scanned by',
  'activity-summary': 'Each activity: bookings, attendance, sign-outs',
  'meal-counts': 'Each meal: number served',
  site: 'Each person: arrived and left',
  catering: 'Totals per dietary need, for the kitchen',
  'dietary-list': 'Each person and their dietary needs',
};
const SENSITIVE = new Set(['dietary-list', 'catering']);

type Tab = 'checkup' | 'downloads' | 'quest';
type Kind = 'all' | 'present' | 'check';

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
  const { event, can, base, reload: reloadEvent } = useEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const rec = useApi<Reconciliation>(`/events/${event.id}/reconciliation`);
  const exports = useApi<{ exports: { key: string; label: string }[] }>(`/events/${event.id}/exports`);
  const [ask, setAsk] = useState<{ title: string; label: string; defaultReason: string; submitLabel: string; run: (reason: string) => Promise<void> } | null>(null);
  const [tab, setTab] = useRemembered<Tab>(`reports:${event.id}:tab`, 'checkup');
  const [kind, setKind] = useState<Kind>('all');
  const [query, setQuery] = useState('');
  // When the page loaded, for spotting phones that haven't uploaded for a while.
  const [loadedAt] = useState(() => Date.now());
  const correct = can('attendance.correct') && (event.status === 'open' || event.status === 'completed');
  const canClose = can('event.close') && (event.status === 'open' || event.status === 'completed');
  const items = rec.data?.items ?? [];

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

  const header = (
    <PageHeader
      title="Reports"
      summary={
        rec.data ? (
          <>
            <span className="sep">{items.length ? `${plural(items.length, 'record')} to sort out` : 'Nothing to sort out'}</span>
            {event.status === 'completed' && <Badge>Closed</Badge>}
          </>
        ) : undefined
      }
      help="Sort out the check-up before you close the event. Scan records are not proof of where someone is and don't replace a roll call."
      primary={
        canClose && (
          <Button kind={event.status === 'open' ? 'secondary' : 'primary'} onAction={() => transition(event.status === 'open' ? 'completed' : 'open')} busyLabel="Saving…">
            <Icon name={event.status === 'open' ? 'lock' : 'unlock'} />
            {event.status === 'open' ? 'Close event' : 'Reopen event'}
          </Button>
        )
      }
    />
  );
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
  const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: data.timezone }) : '');
  const stale = data.devices.filter((d) => loadedAt - Date.parse(d.lastUpload) > 60 * 60_000);
  const allClear = items.length === 0 && data.pendingDietary === 0 && stale.length === 0;
  const presentCount = items.filter((i) => i.kind === 'still_present').length;
  const checkCount = items.length - presentCount;
  const shownItems = items
    .filter((i) => kind === 'all' || (kind === 'present' ? i.kind === 'still_present' : i.kind !== 'still_present'))
    .filter((i) => matchesSearch(query, i.name, i.detail));
  const groups = [...new Set(shownItems.map((i) => i.contextKey))];
  const pickKind = (k: Kind) => setKind(kind === k ? 'all' : k);
  const exportCount = exports.data?.exports.length;

  return (
    <>
      {header}
      <div className="sections reports">
        <FilterTabs
          label="Reports"
          value={tab === 'quest' && !event.features.sideQuest ? 'checkup' : tab}
          onChange={setTab}
          options={[
            { value: 'checkup', label: <>Check-up{items.length > 0 && <span className="tab-count">{items.length}</span>}</> },
            { value: 'downloads', label: <>Downloads{exportCount ? <span className="tab-count">{exportCount}</span> : null}</> },
            ...(event.features.sideQuest ? [{ value: 'quest' as Tab, label: 'Side Quest' }] : []),
          ]}
        />

        {(tab === 'checkup' || (tab === 'quest' && !event.features.sideQuest)) && (
          <div className="reports-checkup">
            <StatStrip
              items={[
                { label: 'Still signed in', value: presentCount, tone: presentCount ? 'warning' : 'success', pressed: kind === 'present', onPress: () => pickKind('present') },
                { label: 'Scans to check', value: checkCount, tone: checkCount ? 'warning' : 'success', pressed: kind === 'check', onPress: () => pickKind('check') },
                { label: 'Scanning phones', value: data.devices.length },
                { label: 'Phones not uploading', value: stale.length, tone: stale.length ? 'warning' : undefined, hint: 'No upload in the last hour' },
              ]}
            />

            {(allClear || data.pendingDietary > 0) && (
              <div className="banners">
                {allClear && <Banner tone="success">All clear <span className="meta">· no one signed in, no scans to check, every phone has uploaded</span></Banner>}
                {data.pendingDietary > 0 && (
                  <Banner
                    tone="warning"
                    action={
                      can('roster.edit') ? (
                        <ButtonLink to={`${base}/people/import`} small>
                          Review
                        </ButtonLink>
                      ) : undefined
                    }
                  >
                    {plural(data.pendingDietary, 'person has', 'people have')} dietary notes to review <span className="meta">· import the roster again</span>
                  </Banner>
                )}
              </div>
            )}

            <div className="reports-columns">
              <div className="reports-groups">
                {items.length > 0 && (
                  <Toolbar label="Filter the check-up">
                    <SearchField id="checkup-q" label="Find a name" value={query} onChange={setQuery} slash />
                    {kind !== 'all' && (
                      <Button small kind="ghost" onClick={() => setKind('all')}>
                        Show all
                      </Button>
                    )}
                    <div className="toolbar-end">
                      <span className="meta" aria-live="polite">
                        {plural(shownItems.length, 'record')}
                      </span>
                    </div>
                  </Toolbar>
                )}
                {items.length > 0 && shownItems.length === 0 && <EmptyState title="Nothing matches">Try another name, or show all.</EmptyState>}
                {groups.map((key) => {
                  const list = shownItems.filter((i) => i.contextKey === key);
                  const all = items.filter((i) => i.contextKey === key);
                  const present = all.filter((i) => i.kind === 'still_present');
                  const site = key === 'site:';
                  const place = all[0]!.contextName || 'Unknown place';
                  return (
                    <div key={key} className="list checkup-group">
                      <div className="row checkup-head">
                        <span className="row-main">
                          <span className="row-title">{site ? 'Gate' : place}</span>
                          <span className="row-meta">
                            {present.length > 0 && `${plural(present.length, 'person', 'people')} still ${site ? 'on site' : 'signed in'}`}
                            {present.length > 0 && present.length < all.length && ' · '}
                            {all.length > present.length && `${plural(all.length - present.length, 'scan')} to check`}
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
                      <ul className="scroll-list checkup-items">
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
              </div>

              {data.devices.length > 0 && (
                <aside className="list reports-phones" aria-label="Scanning phones">
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
                </aside>
              )}
            </div>
          </div>
        )}

        {tab === 'downloads' && (
          <section className="section" aria-labelledby="downloads-heading">
            <div className="section-head section-head-start">
              <h2 id="downloads-heading">Downloads</h2>
              <InfoTip label="About downloads">Spreadsheet files (CSV) that open in Excel. Every download is recorded in the activity log. Store them securely.</InfoTip>
            </div>
            {exports.loading && !exports.data ? (
              <Loading what="downloads" rows={3} />
            ) : exports.error && exports.error.status !== 403 ? (
              <LoadError error={exports.error} onRetry={exports.reload} what="downloads" />
            ) : (exportCount ?? 0) === 0 ? (
              <EmptyState title="Your role can't download records" />
            ) : (
              <ul className="download-grid">
                {exports.data!.exports.map((e) => (
                  <li key={e.key} className="panel download-card">
                    <span className="download-text">
                      <span className="row-title">{e.label}</span>
                      {DESCRIPTION[e.key] && <span className="row-meta">{DESCRIPTION[e.key]}</span>}
                      {SENSITIVE.has(e.key) && (
                        <span>
                          <Badge tone="warning">Contains dietary information</Badge>
                        </span>
                      )}
                    </span>
                    <a className="btn btn-secondary btn-small" href={`/api/events/${event.id}/exports/${e.key}.csv`} download>
                      <Icon name="download" />
                      CSV<span className="visually-hidden"> download: {e.label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === 'quest' && event.features.sideQuest && <SideQuestBoard eventId={event.id} />}
      </div>

      <Sheet open={ask !== null} title={ask?.title ?? ''} onClose={() => setAsk(null)}>
        {ask && <ReasonForm label={ask.label} defaultReason={ask.defaultReason} submitLabel={ask.submitLabel} onSubmit={ask.run} onCancel={() => setAsk(null)} />}
      </Sheet>
    </>
  );
}

/** Super Splash Side Quest: who has collected the most people, for prizes. Full names here; participants only ever see first names. */
function SideQuestBoard({ eventId }: { eventId: string }) {
  const { data } = useApi<{ collections: number; rows: { registrationId: string; place: number; name: string; groupName: string; section: string; collected: number }[] }>(
    `/events/${eventId}/side-quest`,
  );
  return (
    <section className="section" aria-labelledby="side-quest-heading">
      <div className="section-head section-head-start">
        <h2 id="side-quest-heading">Super Splash Side Quest</h2>
        <InfoTip label="About the Side Quest">The secret game: campers collect each other by scanning lanyards with their own phone. Top 20 shown.</InfoTip>
      </div>
      {!data ? (
        <Loading what="the leaderboard" rows={4} />
      ) : (
        <>
          <StatStrip
            items={[
              { label: data.rows.length === 1 ? 'Player' : 'Players', value: data.rows.length },
              { label: 'People collected', value: data.collections },
            ]}
          />
          {data.rows.length === 0 ? (
            <EmptyState title="No one has found it yet" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col" className="cell-num">
                      Place
                    </th>
                    <th scope="col">Name</th>
                    <th scope="col">Group</th>
                    <th scope="col" className="cell-num">
                      Collected
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.slice(0, 20).map((r) => (
                    <tr key={r.registrationId}>
                      <td className="cell-num">{r.place}</td>
                      <td>{r.name}</td>
                      <td>{[r.section, r.groupName].filter(Boolean).join(' · ')}</td>
                      <td className="cell-num">{r.collected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
