import { useMemo, useState } from 'react';
import type { Consent2GoTab } from '../../shared/consent2go';
import { prepareConsent2Go } from '../../shared/consent2go';
import { useNavigate } from 'react-router';
import { csvCell, parseDelimited } from '../../shared/csv';
import type { ColumnMapping, PreparedRow, TargetField } from '../../shared/myscout';
import { TARGET_FIELDS, autoMap, extraLabel, flagDuplicates, missingRequired, normaliseDietaryText, prepareRows, saysNothing } from '../../shared/myscout';
import { MAX_EXTRA_FIELDS } from '../../shared/schemas';
import type { DietaryEntryInput, ImportRow } from '../../shared/schemas';
import { ApiFailure, api } from '../api';
import { DietaryEditor } from '../components/DietaryEditor';
import {
  Badge,
  Banner,
  Button,
  ButtonLink,
  Choice,
  Icon,
  InfoTip,
  LoadError,
  Loading,
  PageHeader,
  Section,
  Segmented,
  Skeleton,
  StatStrip,
  Stepper,
  Toggle,
  plural,
  useToast,
} from '../ui';
import { readFirstSheet, readSheets } from '../import/xlsx';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';

interface ImportContext {
  fingerprintKey: string;
  dietaryEnabled: boolean;
  canEditDietary: boolean;
  reviewedFingerprints: Record<string, string | null>;
}

interface RowPlan {
  index: number;
  memberNumber: string;
  action: 'create' | 'update' | 'unchanged';
  changes: string[];
  dietaryPending: boolean;
}
interface Plan {
  rows: RowPlan[];
  withdraw: { memberNumber: string }[];
  counts: { create: number; update: number; unchanged: number; withdraw: number; dietaryPending: number };
}

type Step = 'file' | 'map' | 'check' | 'dietary' | 'done';

async function hmacHex(key: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function downloadCsv(filename: string, rows: string[][]) {
  const text = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const STEPS: Step[] = ['file', 'map', 'check', 'dietary', 'done'];
/** Consent2Go files have fixed columns, so there's nothing to match. */
const C2G_STEPS: Step[] = ['file', 'check', 'dietary', 'done'];
type Source = 'myscout' | 'consent2go';
const SOURCE_NAME: Record<Source, string> = { myscout: 'MyScout', consent2go: 'Consent2Go' };
const STEP_LABEL: Record<Step, string> = { file: 'Choose file', map: 'Match columns', check: 'Check', dietary: 'Dietary review', done: 'Done' };

/** People › Import from MyScout: a step-by-step import that reads the file in the browser. */
export function Import() {
  const { event, base } = useEvent();
  const navigate = useNavigate();
  const toast = useToast();
  const context = useApi<ImportContext>(`/events/${event.id}/import/context`);
  const [step, setStep] = useState<Step>('file');
  const [source, setSource] = useState<Source>(() => (new URLSearchParams(window.location.search).get('source') === 'consent2go' ? 'consent2go' : 'myscout'));
  const [tabs, setTabs] = useState<Consent2GoTab[]>([]);
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  /** Other columns the manager chose to keep on each person's profile. */
  const [extraCols, setExtraCols] = useState<number[]>([]);
  const [prepared, setPrepared] = useState<PreparedRow[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [withdrawMissing, setWithdrawMissing] = useState(false);
  const [dietary, setDietary] = useState<Record<string, DietaryEntryInput[]>>({});
  const [result, setResult] = useState<Plan['counts'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invalid = prepared.filter((p) => p.errors.length > 0);
  const valid = prepared.filter((p) => p.errors.length === 0);
  const reviewing = Boolean(context.data?.dietaryEnabled && context.data.canEditDietary);
  const pending = useMemo(
    () => (plan ? plan.rows.filter((r) => r.dietaryPending).map((r) => ({ plan: r, source: valid[r.index]! })) : []),
    [plan, valid],
  );

  async function loadFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      if (source === 'consent2go') {
        if (!/\.xlsx$/i.test(file.name)) throw new Error('Choose the Excel workbook (.xlsx) exported from Consent2Go.');
        const { prepared: next, tabs: found } = prepareConsent2Go(await readSheets(await file.arrayBuffer()));
        if (next.length === 0) throw new Error('No people found. Check it’s the Consent2Go export, with a "Student ID" column on each tab.');
        setFileName(file.name);
        setTabs(found);
        setPrepared(next);
        setPlan(null);
        setRows([]);
        setStep('check');
        return;
      }
      let parsed: { headers: string[]; rows: string[][] };
      if (/\.xlsx$/i.test(file.name)) {
        const all = (await readFirstSheet(await file.arrayBuffer())).filter((r) => r.some((c) => c.trim()));
        const [head = [], ...rest] = all;
        parsed = { headers: head.map((h) => h.trim()), rows: rest.map((r) => head.map((_, i) => (r[i] ?? '').trim())) };
      } else {
        parsed = parseDelimited(await file.text());
      }
      if (parsed.rows.length === 0) throw new Error('That file has a header row but no people in it.');
      setTable(parsed);
      setFileName(file.name);
      setMapping(autoMap(parsed.headers));
      setExtraCols([]);
      setStep('map');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  }

  async function buildRows(): Promise<ImportRow[]> {
    const ctx = context.data!;
    return Promise.all(
      valid.map(async (p) => ({
        ...p.row,
        dietaryFingerprint: p.dietaryText ? await hmacHex(ctx.fingerprintKey, normaliseDietaryText(p.dietaryText)) : null,
      })),
    );
  }

  async function check() {
    if (!table) return;
    const used = new Set(Object.values(mapping));
    const next = prepareRows(
      table.rows,
      mapping,
      extraCols.filter((i) => !used.has(i)).map((i) => ({ index: i, label: extraLabel(table.headers[i] ?? '', i) })),
    );
    flagDuplicates(next);
    setPrepared(next);
    setStep('check');
  }

  async function preview(withdraw = withdrawMissing) {
    setBusy(true);
    setError(null);
    try {
      const built = rows.length ? rows : await buildRows();
      setRows(built);
      const res = await api<{ plan: Plan }>(`/events/${event.id}/import/preview`, { body: { rows: built, withdrawMissing: source === 'myscout' && withdraw, source } });
      setPlan(res.plan);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const body = rows.map((r) => (reviewing && dietary[r.memberNumber] ? { ...r, dietary: dietary[r.memberNumber] } : r));
      const res = await api<{ counts: Plan['counts'] }>(`/events/${event.id}/import/commit`, {
        body: { rows: body, withdrawMissing: source === 'myscout' && withdrawMissing, sourceLabel: fileName, source },
      });
      setResult(res.counts);
      setStep('done');
      toast(`Imported ${plural(res.counts.create + res.counts.update, 'person', 'people')}`);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  const back = { to: `${base}/people`, label: 'People' };
  const header = (
    <PageHeader
      title={`Import from ${SOURCE_NAME[source]}`}
      back={back}
      help={
        source === 'consent2go'
          ? 'Adds consent, dietary needs and swimming and medication details to people from MyScout, matched on membership number.'
          : 'Reads a MyScout export in this browser, matches its columns, then shows what will change before anything is saved.'
      }
    />
  );
  const steps = source === 'consent2go' ? C2G_STEPS : STEPS;
  if (context.loading && !context.data)
    return (
      <>
        {header}
        <Loading what="import">
          <Skeleton width="100%" height="9rem" className="" />
        </Loading>
      </>
    );
  if (context.error)
    return (
      <>
        {header}
        <LoadError error={context.error} onRetry={context.reload} what="the import" />
      </>
    );
  const missing = missingRequired(mapping);
  const reviewedCount = pending.filter((p) => dietary[p.source.row.memberNumber]).length;

  return (
    <>
      {header}
      <div className="sections import import-page">
        <Stepper steps={steps.map((s) => STEP_LABEL[s])} current={steps.indexOf(step)} />
        {error && <Banner tone="error">{error}</Banner>}

        {step === 'file' && (
          <Section title="Choose file" id="file">
            <div className="import-source">
              <span className="field-label" id="import-source-label">
                From
              </span>
              <Segmented
                label="Where is the file from?"
                value={source}
                onChange={setSource}
                options={(['myscout', 'consent2go'] as const).map((s) => ({ value: s, label: SOURCE_NAME[s] }))}
              />
              <InfoTip label={`About ${SOURCE_NAME[source]} files`}>
                {source === 'myscout'
                  ? 'The registration list: who is coming, their section and group. Import this first. Use the participant export as .xlsx or .csv, adults included: CampCount works out who is youth and who is a leader.'
                  : 'The Consent2Go export (.xlsx) with every group’s tab. Section comes from the tab: Joeys, Scouts or Venturers, and everyone else is a leader. People already registered keep their MyScout name, section and group; Consent2Go adds photo consent, dietary needs, swimming ability and medication permissions. Anyone not in MyScout yet is added.'}
              </InfoTip>
            </div>
            <label className="dropzone">
              <Icon name="download" size={24} />
              <strong>{busy ? 'Reading…' : 'Choose a file'}</strong>
              <span className="meta">{source === 'consent2go' ? '.xlsx from Consent2Go' : '.xlsx, .csv or tab-separated text'}</span>
              <input
                type="file"
                accept={source === 'consent2go' ? '.xlsx' : '.xlsx,.csv,.tsv,.txt,text/csv'}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadFile(f);
                }}
              />
            </label>
            <p className="meta import-privacy">
              <Icon name="lock" size={16} />
              Read on this computer. Only the columns CampCount needs are sent; parent and emergency contacts never are.
            </p>
          </Section>
        )}

        {step === 'map' && table && (
          <Section title="Match columns" id="map">
            <p className="meta">
              {fileName} · {plural(table.rows.length, 'person', 'people')} · {plural(table.headers.length, 'column')}
              <InfoTip label="What is sent">Only the matched columns and any others you choose to keep are used. The rest never leave this computer.</InfoTip>
            </p>
            {missing.length > 0 && <Banner tone="warning">Choose a column for {missing.map((f) => TARGET_FIELDS[f].label).join(', ')}</Banner>}
            {mapping.dietaryText !== undefined && !reviewing && (
              <Banner tone="info">
                {context.data?.dietaryEnabled ? 'Dietary notes will be flagged for an event manager to review.' : 'Dietary needs are off for this event, so that column is ignored.'}
              </Banner>
            )}
            <div className="map-grid">
              {(Object.keys(TARGET_FIELDS) as TargetField[]).map((field) => {
                const def = TARGET_FIELDS[field];
                const index = mapping[field];
                const sample = index === undefined || field === 'dietaryText' ? '' : (table.rows[0]?.[index] ?? '');
                const unset = index === undefined;
                return (
                  <div key={field} className={unset && def.required ? 'map-item is-missing' : unset ? 'map-item is-unset' : 'map-item'}>
                    <label htmlFor={`map-${field}`} className="map-label">
                      {def.label}
                      {!def.required && <span className="field-optional"> (optional)</span>}
                    </label>
                    <select
                      id={`map-${field}`}
                      className="select"
                      value={index ?? ''}
                      onChange={(e) => {
                        const next = { ...mapping };
                        if (e.target.value === '') delete next[field];
                        else next[field] = Number(e.target.value);
                        setMapping(next);
                      }}
                    >
                      <option value="">Not in this file</option>
                      {table.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                    <span className="map-sample">{sample ? `First row: ${sample}` : ' '}</span>
                  </div>
                );
              })}
            </div>
            <OtherColumns table={table} mapping={mapping} chosen={extraCols} onChange={setExtraCols} />
            <div className="btn-row form-actions">
              <Button kind="primary" disabled={missing.length > 0} onClick={() => void check()}>
                Next
              </Button>
              <Button onClick={() => setStep('file')}>Back</Button>
            </div>
          </Section>
        )}

        {step === 'check' && (
          <Section title="Check" id="check">
            {!plan ? (
              <>
                <p>
                  <strong>{plural(valid.length, 'person', 'people')}</strong> ready to compare with this event. Nothing is saved yet.
                </p>
                {source === 'consent2go' && tabs.length > 0 && (
                  <ul className="list import-tabs">
                    {tabs.map((t) => (
                      <li key={t.name} className="row">
                        <span className="row-main">
                          <span className="row-title">{t.name}</span>
                        </span>
                        <span className={t.skipped ? 'meta' : 'row-side'}>{t.skipped ?? plural(t.people, 'person', 'people')}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {invalid.length > 0 && <Problems invalid={invalid} />}
                <div className="btn-row form-actions">
                  <Button kind="primary" busy={busy} busyLabel="Checking…" disabled={valid.length === 0} onClick={() => void preview()}>
                    Next
                  </Button>
                  <Button onClick={() => setStep(source === 'consent2go' ? 'file' : 'map')}>Back</Button>
                </div>
              </>
            ) : (
              <>
                <StatStrip
                  items={[
                    { label: 'New', value: plan.counts.create, tone: 'success' },
                    { label: 'Changed', value: plan.counts.update, tone: 'info' },
                    { label: 'No change', value: plan.counts.unchanged },
                    ...(reviewing ? [{ label: 'Dietary to review', value: plan.counts.dietaryPending, tone: 'warning' as const }] : []),
                    ...(source === 'myscout' && withdrawMissing ? [{ label: 'To withdraw', value: plan.counts.withdraw, tone: 'error' as const }] : []),
                  ]}
                />
                {invalid.length > 0 && <Problems invalid={invalid} />}
                {source === 'myscout' && (
                  <div className="import-withdraw">
                    <Toggle
                      checked={withdrawMissing}
                      onChange={(v) => {
                        setWithdrawMissing(v);
                        void preview(v);
                      }}
                      label="Withdraw people not in this file"
                      hint={withdrawMissing ? `${plural(plan.counts.withdraw, 'person', 'people')} will be withdrawn. Their records are kept.` : undefined}
                    />
                    <InfoTip label="When to use this">Use this when the file is the complete, current list.</InfoTip>
                  </div>
                )}
                {plan.counts.update > 0 && (
                  <details className="more-options">
                    <summary>
                      <Icon name="chevron" />
                      See what changed ({plan.counts.update})
                    </summary>
                    <ul className="list import-changes">
                      {plan.rows
                        .filter((r) => r.action === 'update')
                        .map((r) => (
                          <li key={r.memberNumber} className="row">
                            <span className="row-main">
                              <span className="row-title">
                                {valid[r.index]!.row.firstName} {valid[r.index]!.row.lastName}
                              </span>
                              <span className="row-meta">{r.changes.join(', ')}</span>
                            </span>
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
                <div className="btn-row form-actions">
                  {reviewing && pending.length > 0 ? (
                    <Button kind="primary" onClick={() => setStep('dietary')}>
                      Next
                    </Button>
                  ) : (
                    <Button kind="primary" busy={busy} busyLabel="Importing…" onClick={() => void commit()}>
                      Import {plural(plan.counts.create + plan.counts.update, 'person', 'people')}
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      setPlan(null);
                      setRows([]);
                      setStep(source === 'consent2go' ? 'file' : 'map');
                    }}
                  >
                    Back
                  </Button>
                </div>
              </>
            )}
          </Section>
        )}

        {step === 'dietary' && plan && (
          <Section
            title={
              <>
                Dietary review{' '}
                <InfoTip label="About dietary review">
                  Turn each note into dietary needs. Record food needs only; other medical information stays in {SOURCE_NAME[source]}. The notes themselves are not saved.
                </InfoTip>
              </>
            }
            id="dietary"
          >
            <NothingToRecord pending={pending} dietary={dietary} onMark={(keys) => setDietary({ ...dietary, ...Object.fromEntries(keys.map((k) => [k, []])) })} onUndo={(keys) => setDietary(Object.fromEntries(Object.entries(dietary).filter(([k]) => !keys.includes(k))))} />
            <ul className="review-list">
              {pending
                .filter(({ source }) => !(saysNothing(source.dietaryText) && dietary[source.row.memberNumber]?.length === 0))
                .map(({ source }) => {
                  const key = source.row.memberNumber;
                  const decided = dietary[key];
                  return (
                    <li key={key} className={decided ? 'panel review-item is-done' : 'panel review-item'}>
                      <div className="review-head">
                        <strong>
                          {source.row.preferredName || source.row.firstName} {source.row.lastName}
                        </strong>
                        <span className="meta">{[source.row.groupName, `member ${key}`].filter(Boolean).join(' · ')}</span>
                        {decided && <Badge tone="success">Reviewed</Badge>}
                      </div>
                      <blockquote className="source-note">{source.dietaryText || 'The note was removed in the new file.'}</blockquote>
                      <DietaryEditor value={decided} onChange={(entries) => setDietary({ ...dietary, [key]: entries })} labelPrefix={`${source.row.firstName} ${source.row.lastName}`} />
                    </li>
                  );
                })}
            </ul>
            <div className="btn-row form-actions">
              <Button kind="primary" busy={busy} busyLabel="Importing…" onClick={() => void commit()}>
                Import
              </Button>
              <Button onClick={() => setStep('check')}>Back</Button>
              <span className="meta import-progress">
                {reviewedCount} of {pending.length} reviewed
                <InfoTip label="Not reviewed">Anyone not reviewed stays flagged for next time.</InfoTip>
              </span>
            </div>
          </Section>
        )}

        {step === 'done' && result && (
          <Section title="Done" id="done">
            <Banner tone="success">
              Import complete: {result.create} added, {result.update} updated, {result.unchanged} unchanged
              {result.withdraw > 0 && `, ${result.withdraw} withdrawn`}
              {invalid.length > 0 && `, ${plural(invalid.length, 'row', 'rows')} skipped`}
            </Banner>
            <div className="btn-row">
              <Button kind="primary" onClick={() => navigate(`${base}/people`)}>
                View people
              </Button>
              <ButtonLink to={`${base}/people/lanyards/print`}>Print lanyards</ButtonLink>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}

/** Rows that can't be imported: one line, with the list behind a toggle and a download. */
function Problems({ invalid }: { invalid: PreparedRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="import-problems">
      <Banner
        tone="warning"
        action={
          <>
            <Button small kind="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Hide' : 'Show'}
            </Button>
            <Button
              small
              onClick={() =>
                downloadCsv('campcount-import-problems.csv', [
                  ['Where', 'Membership number', 'Problem'],
                  ...invalid.map((p) => [p.where ?? `Line ${p.line}`, p.row.memberNumber, p.errors.join('; ')]),
                ])
              }
            >
              <Icon name="download" size={16} />
              Download
            </Button>
          </>
        }
      >
        {plural(invalid.length, 'row has', 'rows have')} problems and will be skipped
      </Banner>
      {open && (
        <ul className="problem-list">
          {invalid.slice(0, 8).map((p) => (
            <li key={p.where ?? p.line}>
              {p.where ?? `Line ${p.line}`}
              {p.row.memberNumber && ` (member ${p.row.memberNumber})`}: {p.errors.join('; ')}
            </li>
          ))}
          {invalid.length > 8 && <li className="meta">and {invalid.length - 8} more in the download</li>}
        </ul>
      )}
    </div>
  );
}

/** Column names that suggest contact, medical or identity details: never offered as extras. */
const SENSITIVE = /e-?mail|phone|mobile|address|street|suburb|postcode|medic|health|allerg|condition|birth|\bdob\b|guardian|parent|carer|contact|emergency|doctor|insurance/i;

/**
 * Columns that aren't matched to anything, offered as extras to keep on each
 * person's profile (team, patrol, bus, tent, or any MyScout custom field).
 */
function OtherColumns({ table, mapping, chosen, onChange }: { table: { headers: string[]; rows: string[][] }; mapping: ColumnMapping; chosen: number[]; onChange: (next: number[]) => void }) {
  const used = new Set(Object.values(mapping));
  const unmatched = table.headers.map((h, i) => ({ h, i })).filter(({ i }) => !used.has(i));
  const others = unmatched.filter(({ h }) => !SENSITIVE.test(h));
  const hidden = unmatched.length - others.length;
  if (others.length === 0) return null;
  const kept = chosen.filter((i) => !used.has(i)).length;
  const full = kept >= MAX_EXTRA_FIELDS;
  return (
    <fieldset className="choices other-columns">
      <legend className="field-label other-columns-legend">
        Other columns to keep <span className="field-optional">(optional, {kept} of {MAX_EXTRA_FIELDS})</span>
        <InfoTip label="About other columns">
          Tick any column you want on each person's profile, such as a team, patrol, bus or tent, or a MyScout custom field. Only keep what staff need at camp: never medical or
          contact details.
          {hidden > 0 && ` ${plural(hidden, 'column')} that look like contact, medical or personal details can't be kept and stay on this computer.`}
        </InfoTip>
      </legend>
      <div className="other-columns-list">
        {others.map(({ h, i }) => {
          const sample = table.rows.find((r) => (r[i] ?? '').trim())?.[i]?.trim() ?? '';
          const checked = chosen.includes(i);
          return (
            <Choice
              key={i}
              label={extraLabel(h, i)}
              description={sample ? `e.g. ${sample.slice(0, 60)}` : 'Empty in this file'}
              checked={checked}
              disabled={!checked && full}
              onChange={(e) => onChange(e.target.checked ? [...chosen, i] : chosen.filter((x) => x !== i))}
            />
          );
        })}
      </div>
      {hidden > 0 && <p className="field-hint">{plural(hidden, 'column')} with personal details hidden</p>}
    </fieldset>
  );
}

/**
 * Notes that, as a whole, just say there's nothing to record ("Nil", "None",
 * "N/A"…). Each is listed with its exact text and its own tick box, all
 * ticked, so the manager can glance down the list, untick anything odd, and
 * mark the rest as no dietary needs in one go. Anything else is never here.
 */
function NothingToRecord({
  pending,
  dietary,
  onMark,
  onUndo,
}: {
  pending: { source: PreparedRow }[];
  dietary: Record<string, DietaryEntryInput[]>;
  onMark: (keys: string[]) => void;
  onUndo: (keys: string[]) => void;
}) {
  const matches = pending.map((p) => p.source).filter((s) => saysNothing(s.dietaryText));
  const marked = matches.filter((s) => dietary[s.row.memberNumber]?.length === 0).map((s) => s.row.memberNumber);
  const open = matches.filter((s) => dietary[s.row.memberNumber] === undefined);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  if (matches.length === 0) return null;
  const ticked = open.filter((s) => !unticked.has(s.row.memberNumber));
  return (
    <div className="panel panel-pad nothing-panel">
      <h3 className="nothing-title">
        {plural(matches.length, 'note says', 'notes say')} there's nothing to record
        <InfoTip label="About these notes">
          These notes are only "Nil", "None", "N/A" or similar, with nothing else written. Untick anyone you want to read in full, then mark the rest. Notes with any other words are
          never in this list.
        </InfoTip>
      </h3>
      {open.length > 0 ? (
        <>
          <fieldset className="nothing-list">
            <legend className="visually-hidden">Notes that say nothing to record</legend>
            {open.map((s) => {
              const key = s.row.memberNumber;
              return (
                <Choice
                  key={key}
                  label={`${s.row.preferredName || s.row.firstName} ${s.row.lastName}`}
                  description={`Note: "${s.dietaryText}"`}
                  checked={!unticked.has(key)}
                  onChange={(e) => {
                    const next = new Set(unticked);
                    if (e.target.checked) next.delete(key);
                    else next.add(key);
                    setUnticked(next);
                  }}
                />
              );
            })}
          </fieldset>
          <div className="btn-row">
            <Button kind="primary" disabled={ticked.length === 0} onClick={() => onMark(ticked.map((s) => s.row.memberNumber))}>
              Mark {plural(ticked.length, 'person', 'people')} as no dietary needs
            </Button>
          </div>
        </>
      ) : null}
      {marked.length > 0 && (
        <p className="nothing-done">
          <Badge tone="success">Done</Badge> {plural(marked.length, 'person', 'people')} marked as no dietary needs.{' '}
          <Button small kind="ghost" onClick={() => onUndo(marked)}>
            Undo
          </Button>
        </p>
      )}
    </div>
  );
}
