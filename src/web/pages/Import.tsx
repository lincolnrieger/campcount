import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { csvCell, parseDelimited } from '../../shared/csv';
import type { ColumnMapping, CombinedTable, FileMatch, FirstNameMode, ImportField, LastNameMode, PreparedRow, SheetSummary } from '../../shared/importFields';
import {
  IMPORT_FIELDS,
  IMPORT_FIELD_ORDER,
  TAB_COLUMN,
  autoMap,
  combineSheets,
  defaultFileColumns,
  dietaryColumns,
  DIETARY_COLUMN,
  marryTables,
  flagDuplicates,
  missingRequired,
  normaliseDietaryText,
  prepareRows,
  saysNothing,
} from '../../shared/importFields';
import type { DietaryEntryInput, ImportRow } from '../../shared/schemas';
import { importRequestSchema } from '../../shared/schemas';
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
import { readSheets } from '../import/xlsx';
import { useApi } from '../useApi';
import { useEvent } from './EventLayout';
import type { LevelSetting } from '../../shared/levels';
import { normalizeLevel } from '../../shared/levels';

interface ImportContext {
  fingerprintKey: string;
  dietaryEnabled: boolean;
  canEditDietary: boolean;
  reviewedFingerprints: Record<string, string | null>;
}

interface RowPlan {
  index: number;
  participantId: string;
  action: 'create' | 'update' | 'unchanged';
  changes: string[];
  dietaryPending: boolean;
}
interface Plan {
  rows: RowPlan[];
  withdraw: { participantId: string }[];
  counts: {
    create: number;
    update: number;
    unchanged: number;
    withdraw: number;
    dietaryPending: number;
  };
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
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const STEPS: Step[] = ['file', 'map', 'check', 'dietary', 'done'];
const STEP_LABEL: Record<Step, string> = {
  file: 'Choose file',
  map: 'Choose fields',
  check: 'Check',
  dietary: 'Dietary review',
  done: 'Done',
};

/** A key for a row before it has a participant ID: its line in the file. */
/** One spreadsheet: its people, and (for files after the first) the columns it adds. */
type ImportFile = { name: string; table: CombinedTable; columns?: number[] };

/** A level name as CampCount keeps it: trimmed, single spaces, 40 characters at most. */
const levelName = (raw: string) => raw.trim().replace(/\s+/g, ' ').slice(0, 40).trim();

const FIELD_NAMES: Record<string, string> = {
  participantId: 'Participant ID',
  firstName: 'First name',
  lastName: 'Last name',
  level: 'Level',
  groupName: 'Group',
  photoConsent: 'Photo consent',
  dietaryFingerprint: 'Dietaries',
  dietary: 'Dietary needs',
};

/**
 * What's wrong with an import, in plain words: which row (by its place in the
 * file and name) and which field. Null when nothing is.
 */
function explainProblems(issues: { path: PropertyKey[]; message: string; code?: string; maximum?: unknown }[], rows: PreparedRow[]): string | null {
  if (issues.length === 0) return null;
  const what = (i: (typeof issues)[number]) =>
    i.code === 'too_big' && typeof i.maximum === 'number' ? `is too long (${i.maximum} characters at most)` : i.code === 'invalid_format' ? 'has characters that aren’t allowed' : `: ${i.message}`;
  const lines = issues.slice(0, 5).map((i) => {
    const [top, index, field] = i.path;
    if (top === 'rows' && typeof index === 'number') {
      const r = rows[index];
      const who = r ? `${r.where ?? `Line ${r.line}`} (${[r.row.firstName, r.row.lastName].filter(Boolean).join(' ')})` : `Row ${index + 1}`;
      return `${who}: ${FIELD_NAMES[String(field)] ?? String(field ?? 'a value')} ${what(i)}`;
    }
    if (top === 'levelLinks') return `The level link for "${String(index ?? '')}" ${what(i)}`;
    if (top === 'rows') return 'There are too many people in one import (2,000 at most). Split the file.';
    return `${String(top)} ${what(i)}`;
  });
  const more = issues.length > 5 ? ` …and ${issues.length - 5} more.` : '';
  return `Some details can’t be imported. ${lines.join('. ')}.${more}`;
}

/** An import failure, with the server's details put in plain words when it sends them. */
function failureText(err: unknown, rows: PreparedRow[]): string {
  if (!(err instanceof ApiFailure)) return 'No connection. Check your signal and try again.';
  const details = (err.details ?? []).map((d) => ({ path: d.path.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)), message: d.message }));
  return (details.length && explainProblems(details, rows)) || err.message;
}

const rowKey = (p: PreparedRow) => p.row.participantId || `line-${p.line}`;

/**
 * People › Import: read a spreadsheet (.xlsx or .csv) on this device, choose
 * which fields to send, check what will change, then send only those fields
 * when Import is pressed. Nothing else from the file is kept anywhere.
 */
export function Import() {
  const { event, base } = useEvent();
  const navigate = useNavigate();
  const toast = useToast();
  const context = useApi<ImportContext>(`/events/${event.id}/import/context`);
  const [step, setStep] = useState<Step>('file');
  const [table, setTable] = useState<{
    headers: string[];
    rows: string[][];
    origins: string[];
  } | null>(null);
  /** The spreadsheets read so far (joined into `table`), and how each matched. */
  const [files, setFiles] = useState<ImportFile[]>([]);
  const [matches, setMatches] = useState<FileMatch[]>([]);
  /** The workbook's tabs: how many people each had, or why it was skipped. */
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [firstMode, setFirstMode] = useState<FirstNameMode>('full');
  const [lastMode, setLastMode] = useState<LastNameMode>('full');
  /** Dietary columns ticked by hand (null: the ones that look dietary). */
  const [dietChoice, setDietChoice] = useState<number[] | null>(null);
  /** Each imported level name and the camp level it goes under, where changed from the suggestion. */
  const [levelChoice, setLevelChoice] = useState<Record<string, string>>({});
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
  const reviewing = Boolean(context.data?.dietaryEnabled && context.data.canEditDietary && mapping.dietary !== undefined);
  const dietCols = dietChoice ?? (table ? dietaryColumns(table.headers, mapping) : []);
  /** The camp level an imported level name goes under: chosen here, else the camp's own match (linked names included), else itself. */
  const levelTarget = (raw: string) => levelName(levelChoice[levelName(raw)] ?? normalizeLevel(raw, event.levels));
  /** Imported names linked to a different level, to remember for next time. */
  const levelLinks = () => {
    const links: Record<string, string> = {};
    for (const [raw, to] of Object.entries(levelChoice)) {
      const from = levelName(raw);
      const target = levelName(to);
      if (from && target && target.toLowerCase() !== from.toLowerCase()) links[from] = target;
    }
    return Object.keys(links).length ? links : undefined;
  };
  const pending = useMemo(() => (plan ? plan.rows.filter((r) => r.dietaryPending).map((r) => ({ plan: r, source: valid[r.index]! })) : []), [plan, valid]);

  /** Read one file on this device: every tab of a workbook, or a CSV as one tab. */
  async function readFile(file: File): Promise<ImportFile> {
    let tabs: { name: string; rows: string[][] }[];
    if (/\.xlsx$/i.test(file.name)) {
      tabs = await readSheets(await file.arrayBuffer());
    } else {
      const csv = parseDelimited(await file.text());
      tabs = [{ name: 'File', rows: [csv.headers, ...csv.rows] }];
    }
    const table = combineSheets(tabs);
    if (table.rows.length === 0) {
      throw new Error(
        table.sheets.length ? `No people found in ${file.name}. Each tab needs a header row with a first name (or name) column.` : `${file.name} has no rows to import.`,
      );
    }
    return { name: file.name.replace(/\.(xlsx|csv|tsv|txt)$/i, ''), table };
  }

  /** Use these files: join them into one list of people, and match the columns again. */
  function applyFiles(next: ImportFile[]) {
    const married = marryTables(next);
    setDietChoice(null);
    setLevelChoice({});
    setFiles(next);
    setMatches(next.length > 1 ? married.files : []);
    setTable(married);
    setSheets(married.sheets);
    const auto = autoMap(married.headers, married.rows);
    // Several tabs and no group column: the tab is usually the group.
    const tabAt = married.headers.indexOf(TAB_COLUMN);
    if (auto.groupName === undefined && tabAt >= 0 && !Object.values(auto).includes(tabAt)) auto.groupName = tabAt;
    setMapping(auto);
    setStep('map');
  }

  async function loadFiles(list: File[], add = false) {
    if (list.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const read = await Promise.all(list.map(readFile));
      // Every file after the first adds only the columns chosen for it (the field-like ones to start with).
      applyFiles([...(add ? files : []), ...read].map((f, i) => (i > 0 && !f.columns ? { ...f, columns: defaultFileColumns(f.table) } : f)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  }

  async function buildRows(): Promise<ImportRow[]> {
    const ctx = context.data!;
    const sending = ctx.dietaryEnabled && mapping.dietary !== undefined;
    // No dietaries in this file: leave what's recorded (and its review state) as it is.
    // (Only fingerprints in today's format: older ones are left for the next review.)
    const kept = new Map(Object.entries(ctx.reviewedFingerprints).map(([id, f]) => [id.toUpperCase(), f && /^[0-9a-f]{64}$/.test(f) ? f : null]));
    return Promise.all(
      valid.map(async (p) => ({
        ...p.row,
        dietaryFingerprint: sending
          ? p.dietaryText
            ? await hmacHex(ctx.fingerprintKey, normaliseDietaryText(p.dietaryText))
            : null
          : (kept.get(p.row.participantId.toUpperCase()) ?? null),
      })),
    );
  }

  function check() {
    if (!table) return;
    const next = prepareRows(table.rows, mapping, { firstName: firstMode, lastName: lastMode }, { dietaryColumns: dietCols, origins: table.origins, headers: table.headers });
    // Each imported level name goes under the camp level chosen for it.
    for (const p of next) if (p.row.level) p.row.level = levelTarget(p.row.level);
    flagDuplicates(next);
    setPrepared(next);
    setPlan(null);
    setRows([]);
    setStep('check');
  }

  async function preview(withdraw = withdrawMissing) {
    setBusy(true);
    setError(null);
    try {
      const built = rows.length ? rows : await buildRows();
      setRows(built);
      const body = { rows: built, withdrawMissing: withdraw, levelLinks: levelLinks() };
      const problems = explainProblems(importRequestSchema.safeParse(body).error?.issues ?? [], valid);
      if (problems) return setError(problems);
      const res = await api<{ plan: Plan }>(`/events/${event.id}/import/preview`, { body });
      setPlan(res.plan);
    } catch (err) {
      setError(failureText(err, valid));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const body = rows.map((r, i) => {
        const decided = dietary[rowKey(valid[i]!)];
        return reviewing && decided ? { ...r, dietary: decided } : r;
      });
      const sending = { rows: body, withdrawMissing, levelLinks: levelLinks() };
      const problems = explainProblems(importRequestSchema.safeParse(sending).error?.issues ?? [], valid);
      if (problems) return setError(problems);
      const res = await api<{
        counts: Plan['counts'];
        participantIds: string[];
      }>(`/events/${event.id}/import/commit`, {
        body: sending,
      });
      setResult(res.counts);
      setStep('done');
      toast(`Imported ${plural(res.counts.create + res.counts.update, 'person', 'people')}`);
    } catch (err) {
      setError(failureText(err, valid));
    } finally {
      setBusy(false);
    }
  }

  const back = { to: `${base}/people`, label: 'People' };
  const header = (
    <PageHeader
      title="Import people"
      back={back}
      help="Reads spreadsheets on this device. You choose which fields to send; nothing is sent until you press Import, and nothing else from the files is kept."
    />
  );
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
  const reviewedCount = pending.filter((p) => dietary[rowKey(p.source)]).length;
  const shownFields = IMPORT_FIELD_ORDER.filter((f) => f !== 'fullName' || mapping.fullName !== undefined || mapping.firstName === undefined);

  return (
    <>
      {header}
      <div className="sections import import-page">
        <Stepper steps={STEPS.map((s) => STEP_LABEL[s])} current={STEPS.indexOf(step)} />
        {error && <Banner tone="error">{error}</Banner>}

        {step === 'file' && (
          <Section title="Choose files" id="file">
            <label className="dropzone">
              <Icon name="download" size={24} />
              <strong>{busy ? 'Reading…' : 'Choose one or more files'}</strong>
              <span className="meta">.xlsx, .csv or tab-separated text. Several files are joined, matching people by participant ID or name.</span>
              <input
                type="file"
                multiple
                accept=".xlsx,.csv,.tsv,.txt,text/csv"
                onChange={(e) => {
                  void loadFiles([...(e.target.files ?? [])]);
                  e.target.value = '';
                }}
              />
            </label>
            <p className="meta import-privacy">
              <Icon name="lock" size={16} />
              Read on this device. Only the fields you choose are sent, when you press Import. The file itself is never uploaded.
            </p>
          </Section>
        )}

        {step === 'map' && table && (
          <Section title="Choose fields" id="map">
            <FilesPanel
              files={files}
              matches={matches}
              busy={busy}
              onAdd={(list) => void loadFiles(list, true)}
              onRemove={(i) => (files.length > 1 ? applyFiles(files.filter((_, x) => x !== i)) : setStep('file'))}
              onColumns={(i, columns) => applyFiles(files.map((f, x) => (x === i ? { ...f, columns } : f)))}
            />
            {files.some((f) => f.table.sheets.length > 1) && <TabSummary sheets={sheets} />}
            <p className="meta">
              {plural(table.rows.length, 'person', 'people')} · {plural(table.headers.length, 'column')}
              <InfoTip label="How columns are matched">
                Columns are matched by their names on this device; nothing is sent. Check each one, or choose "Don't send" for anything you don't need.
              </InfoTip>
            </p>
            {missing.length > 0 && <Banner tone="warning">Choose the column with each person's first name.</Banner>}
            {mapping.dietary !== undefined && !reviewing && (
              <Banner tone="info">
                {context.data?.dietaryEnabled ? 'Dietaries will be flagged for an event manager to review.' : 'Dietary needs are off for this event, so that column is not sent.'}
              </Banner>
            )}
            <div className="map-grid">
              {shownFields
                .filter((f) => f !== 'dietary')
                .map((field) => (
                  <FieldRow
                    key={field}
                    field={field}
                    table={table}
                    mapping={mapping}
                    onChange={setMapping}
                    extra={
                      field === 'firstName' ? (
                        <Segmented
                          label="How much of the first name to send"
                          value={firstMode}
                          onChange={setFirstMode}
                          options={[
                            { value: 'full', label: 'Full' },
                            { value: 'initial', label: 'Initial only' },
                          ]}
                        />
                      ) : field === 'lastName' ? (
                        <Segmented
                          label="How much of the last name to send"
                          value={lastMode}
                          onChange={setLastMode}
                          options={[
                            { value: 'full', label: 'Full' },
                            { value: 'initial', label: 'Initial only' },
                            { value: 'none', label: "Don't send" },
                          ]}
                        />
                      ) : null
                    }
                  />
                ))}
            </div>
            <DietaryColumnsField
              table={table}
              chosen={dietCols}
              onChange={(cols) => {
                setDietChoice(cols);
                const next = { ...mapping };
                if (cols.length) next.dietary = cols[0]!;
                else delete next.dietary;
                setMapping(next);
              }}
            />
            {mapping.level !== undefined && (
              <LevelLinks
                values={table.rows.map((r) => levelName(r[mapping.level!] ?? '')).filter(Boolean)}
                levels={event.levels}
                target={levelTarget}
                onChange={(raw, to) => setLevelChoice({ ...levelChoice, [raw]: to })}
              />
            )}
            <p className="meta import-privacy">
              <Icon name="lock" size={16} />
              Only the fields above are sent, when you press Import. Nothing from the file is kept on this device or anywhere else.
            </p>
            <div className="btn-row form-actions">
              <Button kind="primary" disabled={missing.length > 0} onClick={check}>
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
                  <strong>{plural(valid.length, 'person', 'people')}</strong> ready to compare with this event. Nothing has been sent yet.
                </p>
                <SendSummary mapping={mapping} firstMode={firstMode} lastMode={lastMode} />
                {invalid.length > 0 && <Problems invalid={invalid} />}
                <div className="btn-row form-actions">
                  <Button kind="primary" busy={busy} busyLabel="Checking…" disabled={valid.length === 0} onClick={() => void preview()}>
                    Next
                  </Button>
                  <Button onClick={() => setStep('map')}>Back</Button>
                </div>
              </>
            ) : (
              <>
                <StatStrip
                  items={[
                    {
                      label: 'New',
                      value: plan.counts.create,
                      tone: 'success',
                    },
                    {
                      label: 'Changed',
                      value: plan.counts.update,
                      tone: 'info',
                    },
                    { label: 'No change', value: plan.counts.unchanged },
                    ...(reviewing
                      ? [
                          {
                            label: 'Dietary to review',
                            value: plan.counts.dietaryPending,
                            tone: 'warning' as const,
                          },
                        ]
                      : []),
                    ...(withdrawMissing
                      ? [
                          {
                            label: 'To withdraw',
                            value: plan.counts.withdraw,
                            tone: 'error' as const,
                          },
                        ]
                      : []),
                  ]}
                />
                {invalid.length > 0 && <Problems invalid={invalid} />}
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
                          <li key={r.index} className="row">
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
                      setStep('map');
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
                  Turn each note into dietary needs for the kitchen. Only what you enter here is sent; the notes themselves stay on this device.
                </InfoTip>
              </>
            }
            id="dietary"
          >
            <NothingToRecord
              pending={pending}
              dietary={dietary}
              onMark={(keys) =>
                setDietary({
                  ...dietary,
                  ...Object.fromEntries(keys.map((k) => [k, []])),
                })
              }
              onUndo={(keys) => setDietary(Object.fromEntries(Object.entries(dietary).filter(([k]) => !keys.includes(k))))}
            />
            <ul className="review-list">
              {pending
                .filter(({ source }) => !(saysNothing(source.dietaryText) && dietary[rowKey(source)]?.length === 0))
                .map(({ source }) => {
                  const key = rowKey(source);
                  const decided = dietary[key];
                  return (
                    <li key={key} className={decided ? 'panel review-item is-done' : 'panel review-item'}>
                      <div className="review-head">
                        <strong>
                          {source.row.firstName} {source.row.lastName}
                        </strong>
                        <span className="meta">{source.row.groupName}</span>
                        {decided && <Badge tone="success">Reviewed</Badge>}
                      </div>
                      {source.dietaryParts.length > 0 ? (
                        <dl className="source-notes">
                          {source.dietaryParts.map((part) => (
                            <div key={part.label} className="source-note-part">
                              <dt>{part.label}</dt>
                              <dd>{part.text}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <blockquote className="source-note">The note was removed in the new file.</blockquote>
                      )}
                      <DietaryEditor
                        value={decided}
                        onChange={(entries) => setDietary({ ...dietary, [key]: entries })}
                        labelPrefix={`${source.row.firstName} ${source.row.lastName}`}
                      />
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

/** One CampCount field: which column it comes from (or "Don't send"), a sample, and any options. */
function FieldRow({
  field,
  table,
  mapping,
  onChange,
  extra,
}: {
  field: ImportField;
  table: { headers: string[]; rows: string[][] };
  mapping: ColumnMapping;
  onChange: (next: ColumnMapping) => void;
  extra: ReactNode;
}) {
  const def = IMPORT_FIELDS[field];
  const index = mapping[field];
  const unset = index === undefined;
  const required = field === 'firstName' && mapping.fullName === undefined;
  const sample = index === undefined || field === 'dietary' ? '' : (table.rows.find((r) => (r[index] ?? '').trim())?.[index] ?? '');
  return (
    <div className={unset && required ? 'map-item is-missing' : unset ? 'map-item is-unset' : 'map-item'}>
      <label htmlFor={`map-${field}`} className="map-label">
        {def.label}
        {!required && <span className="field-optional"> (optional)</span>}
      </label>
      <select
        id={`map-${field}`}
        className="select"
        value={index ?? ''}
        onChange={(e) => {
          const next = { ...mapping };
          if (e.target.value === '') delete next[field];
          else {
            const i = Number(e.target.value);
            // A column feeds one field.
            for (const [f, v] of Object.entries(next)) if (v === i) delete next[f as ImportField];
            next[field] = i;
          }
          onChange(next);
        }}
      >
        <option value="">Don't send</option>
        {table.headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
      <span className="map-sample">{sample ? `First row: ${sample}` : ' '}</span>
      {!unset && extra}
    </div>
  );
}

/** What will be sent, in plain words, before anything is. */
function SendSummary({ mapping, firstMode, lastMode }: { mapping: ColumnMapping; firstMode: FirstNameMode; lastMode: LastNameMode }) {
  const parts: string[] = [firstMode === 'initial' ? 'first initial' : 'first name'];
  if ((mapping.lastName !== undefined || mapping.fullName !== undefined) && lastMode !== 'none') parts.push(lastMode === 'initial' ? 'last initial' : 'last name');
  if (mapping.groupName !== undefined) parts.push('group');
  if (mapping.level !== undefined) parts.push('level');
  if (mapping.participantId !== undefined) parts.push('participant ID');
  if (mapping.photoConsent !== undefined) parts.push('photo consent (Yes or No)');
  if (mapping.dietary !== undefined) parts.push('dietary needs you confirm');
  return (
    <p className="meta import-privacy">
      <Icon name="lock" size={16} />
      When you press Import, only these are sent, encrypted: {parts.join(', ')}.
    </p>
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
              onClick={() => downloadCsv('campcount-import-problems.csv', [['Where', 'Problem'], ...invalid.map((p) => [p.where ?? `Line ${p.line}`, p.errors.join('; ')])])}
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
            <li key={p.line}>
              {p.where ?? `Line ${p.line}`}: {p.errors.join('; ')}
            </li>
          ))}
          {invalid.length > 8 && <li className="meta">and {invalid.length - 8} more in the download</li>}
        </ul>
      )}
    </div>
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
  const marked = matches.filter((s) => dietary[rowKey(s)]?.length === 0).map(rowKey);
  const open = matches.filter((s) => dietary[rowKey(s)] === undefined);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  if (matches.length === 0) return null;
  const ticked = open.filter((s) => !unticked.has(rowKey(s)));
  return (
    <div className="panel panel-pad nothing-panel">
      <h3 className="nothing-title">
        {plural(matches.length, 'note says', 'notes say')} there's nothing to record
        <InfoTip label="About these notes">
          These notes are only "Nil", "None", "N/A" or similar, with nothing else written. Untick anyone you want to read in full, then mark the rest. Notes with any other words
          are never in this list.
        </InfoTip>
      </h3>
      {open.length > 0 ? (
        <>
          <fieldset className="nothing-list">
            <legend className="visually-hidden">Notes that say nothing to record</legend>
            {open.map((s) => {
              const key = rowKey(s);
              return (
                <Choice
                  key={key}
                  label={`${s.row.firstName} ${s.row.lastName}`}
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
            <Button kind="primary" disabled={ticked.length === 0} onClick={() => onMark(ticked.map(rowKey))}>
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

/** The tabs read from a workbook, and any skipped. */
function TabSummary({ sheets }: { sheets: SheetSummary[] }) {
  const read = sheets.filter((t) => !t.skipped);
  const skipped = sheets.filter((t) => t.skipped);
  return (
    <div className="panel panel-pad import-tabs">
      <p>
        <strong>Read {plural(read.length, 'tab')}</strong>: {read.map((t) => `${t.name} (${t.people})`).join(', ')}
      </p>
      {skipped.length > 0 && <p className="meta">Skipped: {skipped.map((t) => `${t.name} (${t.skipped!.toLowerCase()})`).join(', ')}</p>}
      <p className="meta">Each person's tab is in the "{TAB_COLUMN}" column, which you can send as their group or level.</p>
    </div>
  );
}

/** The spreadsheets being joined: how each matched, with Add and Remove. */
function FilesPanel({
  files,
  matches,
  busy,
  onAdd,
  onRemove,
  onColumns,
}: {
  files: ImportFile[];
  matches: FileMatch[];
  busy: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onColumns: (index: number, columns: number[]) => void;
}) {
  return (
    <div className="panel panel-pad import-files">
      <ul className="list">
        {files.map((f, i) => {
          const m = matches[i];
          return (
            <li key={`${f.name}-${i}`} className="import-file">
              <div className="row">
                <span className="row-main">
                  <span className="row-title">{f.name}</span>
                  <span className="row-meta">
                    {plural(f.table.rows.length, 'person', 'people')}
                    {m && i > 0 && (
                      <>
                        {' '}
                        · matched {m.matched} by {m.by === 'id' ? 'participant ID' : 'name'}, {m.added} new
                        {m.ambiguous > 0 && `, ${plural(m.ambiguous, 'name')} shared by two people (added separately)`}
                      </>
                    )}
                    {i === 0 && files.length > 1 && ' · the starting list; its values win'}
                  </span>
                </span>
                <Button small kind="ghost" aria-label={`Remove ${f.name}`} onClick={() => onRemove(i)}>
                  <Icon name="trash" size={16} />
                </Button>
              </div>
              {i > 0 && <FileColumns file={f} onChange={(cols) => onColumns(i, cols)} />}
            </li>
          );
        })}
      </ul>
      <div className="btn-row">
        <label className="btn btn-secondary btn-small add-file">
          <Icon name="plus" size={16} /> {busy ? 'Reading…' : 'Add another spreadsheet'}
          <input
            type="file"
            multiple
            className="visually-hidden"
            accept=".xlsx,.csv,.tsv,.txt,text/csv"
            onChange={(e) => {
              onAdd([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </label>
        <InfoTip label="How files are joined">
          People are matched across files on this device: by participant ID, or by first and last name when a file has no IDs (only when exactly one person has that name). Where
          two files have the same column, the first file&apos;s value is kept and later files only fill blanks. People in only one file are still included.
        </InfoTip>
      </div>
    </div>
  );
}

/** The first value in a column, as an example. */
const sampleOf = (table: { rows: string[][] }, i: number) => table.rows.find((r) => (r[i] ?? '').trim())?.[i]?.trim() ?? '';

/** Which columns a later spreadsheet adds. Its ID and name columns still match people either way. */
function FileColumns({ file, onChange }: { file: ImportFile; onChange: (columns: number[]) => void }) {
  const chosen = new Set(file.columns ?? []);
  const t = file.table;
  return (
    <details className="file-columns">
      <summary>
        <Icon name="chevron" /> Columns to add from this file ({chosen.size} of {t.headers.length})
      </summary>
      <fieldset className="choices file-columns-list">
        <legend className="visually-hidden">Columns to add from {file.name}</legend>
        {t.headers.map((h, i) => {
          const sample = sampleOf(t, i);
          return (
            <Choice
              key={i}
              label={h || `Column ${i + 1}`}
              description={sample ? `e.g. ${sample.slice(0, 60)}` : 'Empty'}
              checked={chosen.has(i)}
              onChange={(e) => onChange(t.headers.map((_, x) => x).filter((x) => (x === i ? e.target.checked : chosen.has(x))))}
            />
          );
        })}
      </fieldset>
      <p className="field-hint">Ticked columns fill in people&apos;s blanks. Its ID and name columns are always used to match people, even if they&apos;re not ticked.</p>
    </details>
  );
}

/**
 * Dietaries: tick every column that holds dietary needs. They're all shown,
 * column by column, in the dietary review, where you choose what to record.
 */
function DietaryColumnsField({ table, chosen, onChange }: { table: { headers: string[]; rows: string[][] }; chosen: number[]; onChange: (columns: number[]) => void }) {
  const [all, setAll] = useState(false);
  const set = new Set(chosen);
  const likely = table.headers.map((h, i) => i).filter((i) => set.has(i) || (DIETARY_COLUMN.test(table.headers[i] ?? '') && !/medication/i.test(table.headers[i] ?? '')));
  const shown = all ? table.headers.map((_, i) => i) : likely;
  return (
    <fieldset className="panel panel-pad choices dietary-columns">
      <legend className="field-label">
        Dietaries <span className="field-optional">(optional)</span>
        <InfoTip label="About dietary columns">
          Tick every column with dietary needs. In the dietary review you&apos;ll see each one separately for every person, and choose what to record. The column text itself is
          never sent.
        </InfoTip>
      </legend>
      {shown.length === 0 && <p className="meta">No columns look like dietary needs.</p>}
      {shown.map((i) => {
        const sample = sampleOf(table, i);
        return (
          <Choice
            key={i}
            label={table.headers[i] || `Column ${i + 1}`}
            description={sample ? `e.g. ${sample.slice(0, 60)}` : 'Empty'}
            checked={set.has(i)}
            onChange={(e) => onChange(table.headers.map((_, x) => x).filter((x) => (x === i ? e.target.checked : set.has(x))))}
          />
        );
      })}
      <Button small kind="ghost" onClick={() => setAll(!all)}>
        {all ? 'Show only dietary-looking columns' : 'Show all columns'}
      </Button>
    </fieldset>
  );
}

/**
 * The level names in the file, each linked to one of the camp's levels: an
 * existing one, a new one with the same name, or a new name ("Early Bird Youth"
 * and "Full Participant Youth" both under Youth). Links are remembered.
 */
function LevelLinks({
  values,
  levels,
  target,
  onChange,
}: {
  values: string[];
  levels: readonly LevelSetting[];
  target: (raw: string) => string;
  onChange: (raw: string, to: string) => void;
}) {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const raws = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  const [naming, setNaming] = useState<Record<string, boolean>>({});
  const known = new Set(levels.map((l) => l.name.toLowerCase()));
  // Levels to offer: the camp's, plus any new names chosen on this screen.
  const options = [...new Set([...levels.map((l) => l.name), ...raws.map(target)])];
  const NEW = '\u0000new';
  return (
    <fieldset className="panel panel-pad level-links">
      <legend className="field-label">
        Levels in this file
        <InfoTip label="About levels">
          Choose the level each name in the file goes under. Several names can share one level (for example two kinds of youth ticket both under Youth). CampCount remembers these
          links for the next import. Levels are set up in Settings › Levels.
        </InfoTip>
      </legend>
      <div className="level-links-list">
        {raws.map((raw) => {
          const to = target(raw);
          const isNew = !known.has(to.toLowerCase());
          return (
            <div key={raw} className="level-link">
              <span className="level-link-from">
                {raw} <span className="meta">({counts.get(raw)})</span>
              </span>
              <span className="meta" aria-hidden="true">
                →
              </span>
              {naming[raw] ? (
                <input
                  className="input"
                  ref={(el) => el?.focus()}
                  maxLength={40}
                  aria-label={`New level for ${raw}`}
                  defaultValue=""
                  placeholder="New level name"
                  onBlur={(e) => {
                    if (e.target.value.trim()) onChange(raw, e.target.value.trim());
                    setNaming({ ...naming, [raw]: false });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
              ) : (
                <select
                  className="select"
                  aria-label={`Level for ${raw}`}
                  value={to}
                  onChange={(e) => (e.target.value === NEW ? setNaming({ ...naming, [raw]: true }) : onChange(raw, e.target.value))}
                >
                  {options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                      {known.has(o.toLowerCase()) ? '' : ' (new level)'}
                    </option>
                  ))}
                  <option value={NEW}>Another new level…</option>
                </select>
              )}
              {isNew && !naming[raw] && <Badge tone="info">New</Badge>}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
