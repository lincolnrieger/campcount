import { useTitle } from '../useTitle';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { parseDelimited } from '../../shared/csv';
import type { ColumnMapping, PreparedRow, TargetField } from '../../shared/myscout';
import { TARGET_FIELDS, autoMap, flagDuplicates, missingRequired, normaliseDietaryText, prepareRows } from '../../shared/myscout';
import type { DietaryEntryInput, ImportRow } from '../../shared/schemas';
import { ApiFailure, api } from '../api';
import { DietaryEditor } from '../components/DietaryEditor';
import { BackLink, LoadError, Loading, Notice, Skeleton } from '../components/ui';
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

export function Import() {
  useTitle('Import from MyScout');
  const { event } = useEvent();
  const context = useApi<ImportContext>(`/events/${event.id}/import/context`);
  const [step, setStep] = useState<Step>('file');
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
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
    const next = prepareRows(table.rows, mapping);
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
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong.');
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
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (context.loading && !context.data)
    return (
      <Loading label="Loading import">
        <Skeleton width="100%" height="9rem" radius="var(--radius)" />
      </Loading>
    );
  if (context.error) return <LoadError error={context.error} onRetry={context.reload} />;
  const mappedCount = Object.keys(mapping).length;

  return (
    <div className="import">
      <BackLink to=".." label="People" />
      <ol className="steps" aria-label="Import steps">
        {(['file', 'map', 'check', 'dietary', 'done'] as Step[]).map((s, i) => (
          <li key={s} aria-current={step === s ? 'step' : undefined}>
            <span>{i + 1}</span> {{ file: 'Choose file', map: 'Match columns', check: 'Check', dietary: 'Dietary review', done: 'Done' }[s]}
          </li>
        ))}
      </ol>
      {error && <Notice tone="stop">{error}</Notice>}

      {step === 'file' && (
        <section className="narrow">
          <h2>Import from MyScout</h2>
          <p>
            Use the participant export from MyScout, as an Excel workbook (.xlsx) or CSV. Include adults; CampCount works out who is
            youth and who is a leader.
          </p>
          <Notice tone="ok" title="Your file stays on this device">
            <p>
              CampCount reads the file here in your browser and only sends names, membership numbers, group, role and photo consent.
              Addresses, contact details, Medicare numbers, guardian details and medical notes are never uploaded.
            </p>
          </Notice>
          <label className="dropzone">
            <strong>{busy ? 'Reading…' : 'Choose a file'}</strong>
            <span>.xlsx, .csv or tab-separated text</span>
            <input
              type="file"
              accept=".xlsx,.csv,.tsv,.txt,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
              }}
            />
          </label>
        </section>
      )}

      {step === 'map' && table && (
        <section>
          <h2>Match columns</h2>
          <p className="lede">
            {fileName}: {table.rows.length} people, {table.headers.length} columns. Only the {mappedCount} columns below are used;
            the other {table.headers.length - mappedCount} are ignored and never leave this device.
          </p>
          <div className="sheet-wrap">
            <table className="sheet">
              <thead>
                <tr>
                  <th scope="col">CampCount needs</th>
                  <th scope="col">Column in your file</th>
                  <th scope="col">First row</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(TARGET_FIELDS) as TargetField[]).map((field) => {
                  const def = TARGET_FIELDS[field];
                  const index = mapping[field];
                  const sample = index === undefined || field === 'dietaryText' ? '' : (table.rows[0]?.[index] ?? '');
                  return (
                    <tr key={field}>
                      <td>
                        <label htmlFor={`map-${field}`}>
                          {def.label}
                          {def.required && <span className="field-hint"> (required)</span>}
                        </label>
                      </td>
                      <td>
                        <select
                          id={`map-${field}`}
                          className="input"
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
                      </td>
                      <td className="field-hint">{sample}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {mapping.dietaryText !== undefined && !reviewing && (
            <Notice tone="warn">
              <p>
                {context.data?.dietaryEnabled
                  ? 'You can import the roster. Dietary notes will be flagged for an event manager to review.'
                  : 'Dietary requirements are switched off for this event, so this column will be ignored.'}
              </p>
            </Notice>
          )}
          {missingRequired(mapping).length > 0 && (
            <Notice tone="stop">Choose a column for: {missingRequired(mapping).map((f) => TARGET_FIELDS[f].label).join(', ')}.</Notice>
          )}
          <div className="actions">
            <button className="btn" disabled={missingRequired(mapping).length > 0} onClick={() => void check()}>
              Check rows
            </button>
            <button className="btn btn-secondary" onClick={() => setStep('file')}>
              Choose a different file
            </button>
          </div>
        </section>
      )}

      {step === 'check' && (
        <section>
          <h2>Check</h2>
          {invalid.length > 0 && (
            <Notice tone="warn" title={`${invalid.length} ${invalid.length === 1 ? 'row has' : 'rows have'} problems and will be skipped`}>
              <ul>
                {invalid.slice(0, 8).map((p) => (
                  <li key={p.line}>
                    Line {p.line}
                    {p.row.memberNumber && ` (member ${p.row.memberNumber})`}: {p.errors.join('; ')}
                  </li>
                ))}
              </ul>
              <button
                className="btn-link"
                onClick={() =>
                  downloadCsv('campcount-import-problems.csv', [
                    ['Line', 'Membership number', 'Problem'],
                    ...invalid.map((p) => [String(p.line), p.row.memberNumber, p.errors.join('; ')]),
                  ])
                }
              >
                Download the list of problems
              </button>
            </Notice>
          )}
          {!plan && (
            <>
              <p>{valid.length} people are ready to check against this event's roster. Nothing is saved yet.</p>
              <button className="btn" disabled={busy || valid.length === 0} onClick={() => void preview()}>
                {busy ? 'Checking…' : 'Compare with roster'}
              </button>
            </>
          )}
          {plan && (
            <>
              <dl className="facts">
                <dt>New</dt>
                <dd>{plan.counts.create}</dd>
                <dt>Changed</dt>
                <dd>{plan.counts.update}</dd>
                <dt>No change</dt>
                <dd>{plan.counts.unchanged}</dd>
                {reviewing && (
                  <>
                    <dt>Dietary to review</dt>
                    <dd>{plan.counts.dietaryPending}</dd>
                  </>
                )}
              </dl>
              <label className="check">
                <input
                  type="checkbox"
                  checked={withdrawMissing}
                  onChange={(e) => {
                    setWithdrawMissing(e.target.checked);
                    void preview(e.target.checked);
                  }}
                />
                <div>
                  <strong>Mark people not in this file as withdrawn</strong>
                  <span>
                    Use this when the file is the complete, current list.
                    {withdrawMissing && ` ${plan.counts.withdraw} will be marked withdrawn. Their records are kept.`}
                  </span>
                </div>
              </label>
              {plan.counts.update > 0 && (
                <details className="section-gap">
                  <summary>See what changed</summary>
                  <ul>
                    {plan.rows
                      .filter((r) => r.action === 'update')
                      .map((r) => (
                        <li key={r.memberNumber}>
                          {valid[r.index]!.row.firstName} {valid[r.index]!.row.lastName}: {r.changes.join(', ')}
                        </li>
                      ))}
                  </ul>
                </details>
              )}
              <div className="actions">
                {reviewing && pending.length > 0 ? (
                  <button className="btn" onClick={() => setStep('dietary')}>
                    Review dietary requirements
                  </button>
                ) : (
                  <button className="btn" disabled={busy} onClick={() => void commit()}>
                    {busy ? 'Importing…' : `Import ${plan.counts.create + plan.counts.update} people`}
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {step === 'dietary' && plan && (
        <section>
          <h2>Dietary review</h2>
          <p>
            Turn each note into dietary requirements. Record food needs only. Leave out other medical information; it stays in MyScout.
            The notes themselves are not saved.
          </p>
          <ul className="review-list">
            {pending.map(({ source }) => {
              const key = source.row.memberNumber;
              const decided = dietary[key];
              return (
                <li key={key} className={decided ? 'is-done' : undefined}>
                  <div className="review-head">
                    <strong>
                      {source.row.preferredName || source.row.firstName} {source.row.lastName}
                    </strong>
                    <span className="field-hint">
                      {source.row.groupName}, member {key}
                    </span>
                  </div>
                  <blockquote className="source-note">{source.dietaryText || 'The note was removed in the new file.'}</blockquote>
                  <DietaryEditor
                    value={decided}
                    onChange={(entries) => setDietary({ ...dietary, [key]: entries })}
                    labelPrefix={`${source.row.firstName} ${source.row.lastName}`}
                  />
                </li>
              );
            })}
          </ul>
          <div className="actions sticky-actions">
            <button className="btn" disabled={busy} onClick={() => void commit()}>
              {busy ? 'Importing…' : 'Import'}
            </button>
            <span className="field-hint">
              {pending.filter((p) => dietary[p.source.row.memberNumber]).length} of {pending.length} reviewed. Anyone not reviewed stays
              flagged for next time.
            </span>
          </div>
        </section>
      )}

      {step === 'done' && result && (
        <section className="narrow">
          <Notice tone="ok" title="Import complete">
            <p>
              {result.create} added, {result.update} updated, {result.unchanged} unchanged
              {result.withdraw > 0 && `, ${result.withdraw} marked withdrawn`}.
              {invalid.length > 0 && ` ${invalid.length} rows were skipped because of problems.`}
            </p>
          </Notice>
          <div className="actions">
            <Link className="btn" to={`/events/${event.id}/people`}>
              View people
            </Link>
            <Link className="btn btn-secondary" to={`/events/${event.id}/people/lanyards`}>
              Print lanyards
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
