import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { parseDelimited } from '../../shared/csv';
import type { ColumnMapping, PreparedRow, TargetField } from '../../shared/myscout';
import { TARGET_FIELDS, autoMap, extraLabel, flagDuplicates, missingRequired, normaliseDietaryText, prepareRows, saysNothing } from '../../shared/myscout';
import { MAX_EXTRA_FIELDS } from '../../shared/schemas';
import type { DietaryEntryInput, ImportRow } from '../../shared/schemas';
import { ApiFailure, api } from '../api';
import { DietaryEditor } from '../components/DietaryEditor';
import { Badge, Button, ButtonLink, Choice, CountTile, Icon, LoadError, Loading, Notice, PageHeader, Section, Skeleton, Stepper, plural, useToast } from '../ui';
import { readFirstSheet } from '../import/xlsx';
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
  const text = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const STEPS: Step[] = ['file', 'map', 'check', 'dietary', 'done'];
const STEP_LABEL: Record<Step, string> = { file: 'Choose file', map: 'Match columns', check: 'Check', dietary: 'Dietary review', done: 'Done' };

/** People › Import from MyScout: a step-by-step import that reads the file in the browser. */
export function Import() {
  const { event, base } = useEvent();
  const navigate = useNavigate();
  const toast = useToast();
  const context = useApi<ImportContext>(`/events/${event.id}/import/context`);
  const [step, setStep] = useState<Step>('file');
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
      const res = await api<{ plan: Plan }>(`/events/${event.id}/import/preview`, { body: { rows: built, withdrawMissing: withdraw } });
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
        body: { rows: body, withdrawMissing, sourceLabel: fileName },
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
  const header = <PageHeader title="Import from MyScout" back={back} />;
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

  return (
    <>
      {header}
      <div className="sections import">
        <Stepper steps={STEPS.map((s) => STEP_LABEL[s])} current={STEPS.indexOf(step)} />
        {error && (
          <Notice tone="error" title="That didn't work">
            <p>{error}</p>
          </Notice>
        )}

        {step === 'file' && (
          <Section title="Choose file" id="file">
            <div className="prose">
              <p>
                Use the participant export from MyScout, as an Excel workbook (.xlsx) or a CSV file. Include adults: CampCount works out who is youth and who is
                a leader.
              </p>
              <p className="meta">The file stays on this computer. Only the columns CampCount needs are sent.</p>
            </div>
            <label className="dropzone">
              <Icon name="download" size={24} />
              <strong>{busy ? 'Reading…' : 'Choose a file'}</strong>
              <span className="meta">.xlsx, .csv or tab-separated text</span>
              <input
                type="file"
                accept=".xlsx,.csv,.tsv,.txt,text/csv"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void loadFile(f);
                }}
              />
            </label>
          </Section>
        )}

        {step === 'map' && table && (
          <Section title="Match columns" id="map">
            <p className="meta">
              {fileName}: {plural(table.rows.length, 'person', 'people')}, {plural(table.headers.length, 'column')}. Only the matched columns and any others you
              choose to keep are used; the rest never leave this computer.
            </p>
            <ul className="list">
              {(Object.keys(TARGET_FIELDS) as TargetField[]).map((field) => {
                const def = TARGET_FIELDS[field];
                const index = mapping[field];
                const sample = index === undefined || field === 'dietaryText' ? '' : (table.rows[0]?.[index] ?? '');
                return (
                  <li key={field} className="row map-row">
                    <span className="row-main">
                      <label htmlFor={`map-${field}`} className="row-title">
                        {def.label}
                        {!def.required && <span className="field-optional"> (optional)</span>}
                      </label>
                      {sample && <span className="row-meta">First row: {sample}</span>}
                    </span>
                    <select
                      id={`map-${field}`}
                      className="select map-select"
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
                  </li>
                );
              })}
            </ul>
            <OtherColumns table={table} mapping={mapping} chosen={extraCols} onChange={setExtraCols} />
            {mapping.dietaryText !== undefined && !reviewing && (
              <Notice tone="warning">
                <p>
                  {context.data?.dietaryEnabled
                    ? 'You can import the people. Dietary notes will be flagged for an event manager to review.'
                    : 'Dietary needs are switched off for this event, so this column is ignored.'}
                </p>
              </Notice>
            )}
            {missing.length > 0 && (
              <Notice tone="warning">
                <p>Choose a column for: {missing.map((f) => TARGET_FIELDS[f].label).join(', ')}.</p>
              </Notice>
            )}
            <div className="btn-row">
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
                <p>{plural(valid.length, 'person is', 'people are')} ready to compare with this event's list. Nothing is saved yet.</p>
                {invalid.length > 0 && <Problems invalid={invalid} />}
                <div className="btn-row">
                  <Button kind="primary" busy={busy} busyLabel="Checking…" disabled={valid.length === 0} onClick={() => void preview()}>
                    Next
                  </Button>
                  <Button onClick={() => setStep('map')}>Back</Button>
                </div>
              </>
            ) : (
              <>
                <div className={reviewing ? 'tiles import-tiles-4' : 'tiles'}>
                  <CountTile value={plan.counts.create} label="New" tone="success" />
                  <CountTile value={plan.counts.update} label="Changed" tone="info" />
                  <CountTile value={plan.counts.unchanged} label="No change" />
                  {reviewing && <CountTile value={plan.counts.dietaryPending} label="Dietary to review" tone="warning" />}
                </div>
                {invalid.length > 0 && <Problems invalid={invalid} />}
                <Choice
                  checked={withdrawMissing}
                  onChange={(e) => {
                    setWithdrawMissing(e.target.checked);
                    void preview(e.target.checked);
                  }}
                  label={<strong>Mark people not in this file as withdrawn</strong>}
                  description={`Use this when the file is the complete, current list.${withdrawMissing ? ` ${plural(plan.counts.withdraw, 'person', 'people')} will be withdrawn. Their records are kept.` : ''}`}
                />
                {plan.counts.update > 0 && (
                  <details className="more-options">
                    <summary>
                      <Icon name="chevron" />
                      See what changed
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
                <div className="btn-row">
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
          <Section title="Dietary review" id="dietary">
            <p className="prose">
              Turn each note into dietary needs. Record food needs only; other medical information stays in MyScout. The notes themselves are not saved.
            </p>
            <NothingToRecord pending={pending} dietary={dietary} onMark={(keys) => setDietary({ ...dietary, ...Object.fromEntries(keys.map((k) => [k, []])) })} onUndo={(keys) => setDietary(Object.fromEntries(Object.entries(dietary).filter(([k]) => !keys.includes(k))))} />
            <ul className="review-list">
              {pending
                .filter(({ source }) => !(saysNothing(source.dietaryText) && dietary[source.row.memberNumber]?.length === 0))
                .map(({ source }) => {
                const key = source.row.memberNumber;
                const decided = dietary[key];
                return (
                  <li key={key} className="panel panel-pad review-item">
                    <div className="review-head">
                      <strong>
                        {source.row.preferredName || source.row.firstName} {source.row.lastName}
                      </strong>
                      <span className="meta">
                        {[source.row.groupName, `member ${key}`].filter(Boolean).join(' · ')}
                      </span>
                      {decided && <Badge tone="success">Reviewed</Badge>}
                    </div>
                    <blockquote className="source-note">{source.dietaryText || 'The note was removed in the new file.'}</blockquote>
                    <DietaryEditor value={decided} onChange={(entries) => setDietary({ ...dietary, [key]: entries })} labelPrefix={`${source.row.firstName} ${source.row.lastName}`} />
                  </li>
                );
              })}
            </ul>
            <p className="meta">
              {pending.filter((p) => dietary[p.source.row.memberNumber]).length} of {pending.length} reviewed. Anyone not reviewed stays flagged for next time.
            </p>
            <div className="btn-row">
              <Button kind="primary" busy={busy} busyLabel="Importing…" onClick={() => void commit()}>
                Import
              </Button>
              <Button onClick={() => setStep('check')}>Back</Button>
            </div>
          </Section>
        )}

        {step === 'done' && result && (
          <Section title="Done" id="done">
            <Notice tone="success" title="Import complete">
              <p>
                {result.create} added, {result.update} updated, {result.unchanged} unchanged
                {result.withdraw > 0 && `, ${result.withdraw} withdrawn`}.{invalid.length > 0 && ` ${plural(invalid.length, 'row was', 'rows were')} skipped because of problems.`}
              </p>
            </Notice>
            <div className="btn-row">
              <Button kind="primary" onClick={() => navigate(`${base}/people`)}>
                View people
              </Button>
              <ButtonLink to={`${base}/people/lanyards`}>Print lanyards</ButtonLink>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}

/** Rows that can't be imported, with a download of the full list. */
function Problems({ invalid }: { invalid: PreparedRow[] }) {
  return (
    <Notice tone="warning" title={`${plural(invalid.length, 'row has', 'rows have')} problems and will be skipped`}>
      <ul className="problem-list">
        {invalid.slice(0, 8).map((p) => (
          <li key={p.line}>
            Line {p.line}
            {p.row.memberNumber && ` (member ${p.row.memberNumber})`}: {p.errors.join('; ')}
          </li>
        ))}
      </ul>
      <Button
        small
        onClick={() =>
          downloadCsv('campcount-import-problems.csv', [
            ['Line', 'Membership number', 'Problem'],
            ...invalid.map((p) => [String(p.line), p.row.memberNumber, p.errors.join('; ')]),
          ])
        }
      >
        Download the list of problems
      </Button>
    </Notice>
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
  const full = chosen.filter((i) => !used.has(i)).length >= MAX_EXTRA_FIELDS;
  return (
    <fieldset className="choices other-columns">
      <legend className="field-label">Other columns to keep (optional)</legend>
      <p className="field-hint">
        Tick any column you want on each person's profile, such as a team, patrol, bus or tent, or a MyScout custom field. Up to {MAX_EXTRA_FIELDS}. Only keep what
        staff need at camp: never medical or contact details.
      </p>
      <div className="other-columns-list">
        {others.map(({ h, i }) => {
          const sample = table.rows.find((r) => (r[i] ?? '').trim())?.[i]?.trim() ?? '';
          const checked = chosen.includes(i);
          return (
            <Choice
              key={i}
              label={extraLabel(h, i)}
              description={sample ? `For example: ${sample.slice(0, 60)}` : 'Empty in this file'}
              checked={checked}
              disabled={!checked && full}
              onChange={(e) => onChange(e.target.checked ? [...chosen, i] : chosen.filter((x) => x !== i))}
            />
          );
        })}
      </div>
      {hidden > 0 && <p className="field-hint">{plural(hidden, 'column')} that look like contact, medical or personal details can't be kept and stay on this computer.</p>}
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
      <h3>{plural(matches.length, 'note says', 'notes say')} there's nothing to record</h3>
      {open.length > 0 ? (
        <>
          <p className="meta">
            These notes are only "Nil", "None", "N/A" or similar, with nothing else written. Check the list, untick anyone you want to read in full, then mark the
            rest. Notes with any other words are never in this list.
          </p>
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
