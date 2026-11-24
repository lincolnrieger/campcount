import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { csvCell, parseDelimited } from "../../shared/csv";
import type {
  ColumnMapping,
  CombinedTable,
  FileMatch,
  FirstNameMode,
  ImportField,
  LastNameMode,
  PreparedRow,
  SheetSummary,
} from "../../shared/importFields";
import {
  IMPORT_FIELDS,
  IMPORT_FIELD_ORDER,
  TAB_COLUMN,
  autoMap,
  combineSheets,
  dietaryColumns,
  marryTables,
  flagDuplicates,
  missingRequired,
  normaliseDietaryText,
  prepareRows,
  saysNothing,
} from "../../shared/importFields";
import type { DietaryEntryInput, ImportRow } from "../../shared/schemas";
import { ApiFailure, api } from "../api";
import { DietaryEditor } from "../components/DietaryEditor";
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
} from "../ui";
import { readSheets } from "../import/xlsx";
import { saveLocalColumns } from "../import/localColumns";
import { useApi } from "../useApi";
import { useEvent } from "./EventLayout";

interface ImportContext {
  fingerprintKey: string;
  dietaryEnabled: boolean;
  canEditDietary: boolean;
  reviewedFingerprints: Record<string, string | null>;
}

interface RowPlan {
  index: number;
  participantId: string;
  action: "create" | "update" | "unchanged";
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

type Step = "file" | "map" | "check" | "dietary" | "done";

async function hmacHex(key: string, text: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(text));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function downloadCsv(filename: string, rows: string[][]) {
  const text = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const STEPS: Step[] = ["file", "map", "check", "dietary", "done"];
const STEP_LABEL: Record<Step, string> = {
  file: "Choose file",
  map: "Choose fields",
  check: "Check",
  dietary: "Dietary review",
  done: "Done",
};

/** A key for a row before it has a participant ID: its line in the file. */
const rowKey = (p: PreparedRow) => p.row.participantId || `line-${p.line}`;

/**
 * People › Import: read a spreadsheet (.xlsx or .csv) on this device, choose
 * which fields to send, check what will change, then send only those fields
 * when Import is pressed. Every other column stays on this device.
 */
export function Import() {
  const { event, base } = useEvent();
  const navigate = useNavigate();
  const toast = useToast();
  const context = useApi<ImportContext>(`/events/${event.id}/import/context`);
  const [step, setStep] = useState<Step>("file");
  const [table, setTable] = useState<{
    headers: string[];
    rows: string[][];
    origins: string[];
  } | null>(null);
  /** The spreadsheets read so far (joined into `table`), and how each matched. */
  const [files, setFiles] = useState<{ name: string; table: CombinedTable }[]>(
    [],
  );
  const [matches, setMatches] = useState<FileMatch[]>([]);
  /** The workbook's tabs: how many people each had, or why it was skipped. */
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [firstMode, setFirstMode] = useState<FirstNameMode>("full");
  const [lastMode, setLastMode] = useState<LastNameMode>("full");
  /** Keep the columns that aren't sent on this device (never uploaded). */
  const [keepLocal, setKeepLocal] = useState(true);
  const [prepared, setPrepared] = useState<PreparedRow[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [withdrawMissing, setWithdrawMissing] = useState(false);
  const [dietary, setDietary] = useState<Record<string, DietaryEntryInput[]>>(
    {},
  );
  const [result, setResult] = useState<Plan["counts"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const invalid = prepared.filter((p) => p.errors.length > 0);
  const valid = prepared.filter((p) => p.errors.length === 0);
  const reviewing = Boolean(
    context.data?.dietaryEnabled &&
    context.data.canEditDietary &&
    mapping.dietary !== undefined,
  );
  const pending = useMemo(
    () =>
      plan
        ? plan.rows
            .filter((r) => r.dietaryPending)
            .map((r) => ({ plan: r, source: valid[r.index]! }))
        : [],
    [plan, valid],
  );
  const used = new Set(Object.values(mapping));
  const otherColumns = table
    ? table.headers
        .map((h, i) => ({ h: h || `Column ${i + 1}`, i }))
        .filter(({ i }) => !used.has(i))
    : [];

  /** Read one file on this device: every tab of a workbook, or a CSV as one tab. */
  async function readFile(
    file: File,
  ): Promise<{ name: string; table: CombinedTable }> {
    let tabs: { name: string; rows: string[][] }[];
    if (/\.xlsx$/i.test(file.name)) {
      tabs = await readSheets(await file.arrayBuffer());
    } else {
      const csv = parseDelimited(await file.text());
      tabs = [{ name: "File", rows: [csv.headers, ...csv.rows] }];
    }
    const table = combineSheets(tabs);
    if (table.rows.length === 0) {
      throw new Error(
        table.sheets.length
          ? `No people found in ${file.name}. Each tab needs a header row with a first name (or name) column.`
          : `${file.name} has no rows to import.`,
      );
    }
    return { name: file.name.replace(/\.(xlsx|csv|tsv|txt)$/i, ""), table };
  }

  /** Use these files: join them into one list of people, and match the columns again. */
  function applyFiles(next: { name: string; table: CombinedTable }[]) {
    const married = marryTables(next);
    setFiles(next);
    setMatches(next.length > 1 ? married.files : []);
    setTable(married);
    setSheets(married.sheets);
    const auto = autoMap(married.headers, married.rows);
    // Several tabs and no group column: the tab is usually the group.
    const tabAt = married.headers.indexOf(TAB_COLUMN);
    if (
      auto.groupName === undefined &&
      tabAt >= 0 &&
      !Object.values(auto).includes(tabAt)
    )
      auto.groupName = tabAt;
    setMapping(auto);
    setStep("map");
  }

  async function loadFiles(list: File[], add = false) {
    if (list.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      const read = await Promise.all(list.map(readFile));
      applyFiles([...(add ? files : []), ...read]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That file could not be read.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function buildRows(): Promise<ImportRow[]> {
    const ctx = context.data!;
    const sending = ctx.dietaryEnabled && mapping.dietary !== undefined;
    // No dietaries in this file: leave what's recorded (and its review state) as it is.
    const kept = new Map(
      Object.entries(ctx.reviewedFingerprints).map(([id, f]) => [
        id.toUpperCase(),
        f,
      ]),
    );
    return Promise.all(
      valid.map(async (p) => ({
        ...p.row,
        dietaryFingerprint: sending
          ? p.dietaryText
            ? await hmacHex(
                ctx.fingerprintKey,
                normaliseDietaryText(p.dietaryText),
              )
            : null
          : (kept.get(p.row.participantId.toUpperCase()) ?? null),
      })),
    );
  }

  function check() {
    if (!table) return;
    const next = prepareRows(
      table.rows,
      mapping,
      { firstName: firstMode, lastName: lastMode },
      {
        dietaryColumns: dietaryColumns(table.headers, mapping),
        origins: table.origins,
      },
    );
    flagDuplicates(next);
    setPrepared(next);
    setPlan(null);
    setRows([]);
    setStep("check");
  }

  async function preview(withdraw = withdrawMissing) {
    setBusy(true);
    setError(null);
    try {
      const built = rows.length ? rows : await buildRows();
      setRows(built);
      const res = await api<{ plan: Plan }>(
        `/events/${event.id}/import/preview`,
        { body: { rows: built, withdrawMissing: withdraw } },
      );
      setPlan(res.plan);
    } catch (err) {
      setError(
        err instanceof ApiFailure
          ? err.message
          : "No connection. Check your signal and try again.",
      );
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
      const res = await api<{
        counts: Plan["counts"];
        participantIds: string[];
      }>(`/events/${event.id}/import/commit`, {
        body: { rows: body, withdrawMissing },
      });
      // The columns that weren't sent stay on this device, filed by each person's participant ID.
      if (keepLocal && table && otherColumns.length > 0) {
        await saveLocalColumns(
          event.id,
          otherColumns.map((c) => c.h),
          valid.map((p, i) => ({
            participantId: res.participantIds[i] ?? "",
            values: otherColumns.map((c) =>
              (table.rows[p.line - 2]?.[c.i] ?? "").trim(),
            ),
          })),
        ).catch(() =>
          toast("The other columns could not be kept on this device."),
        );
      }
      setResult(res.counts);
      setStep("done");
      toast(
        `Imported ${plural(res.counts.create + res.counts.update, "person", "people")}`,
      );
    } catch (err) {
      setError(
        err instanceof ApiFailure
          ? err.message
          : "No connection. Check your signal and try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const back = { to: `${base}/people`, label: "People" };
  const header = (
    <PageHeader
      title="Import people"
      back={back}
      help="Reads a spreadsheet on this device. You choose which fields to send; nothing is sent until you press Import, and everything else stays on this device."
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
        <LoadError
          error={context.error}
          onRetry={context.reload}
          what="the import"
        />
      </>
    );
  const missing = missingRequired(mapping);
  const reviewedCount = pending.filter((p) => dietary[rowKey(p.source)]).length;
  const shownFields = IMPORT_FIELD_ORDER.filter(
    (f) =>
      f !== "fullName" ||
      mapping.fullName !== undefined ||
      mapping.firstName === undefined,
  );

  return (
    <>
      {header}
      <div className="sections import import-page">
        <Stepper
          steps={STEPS.map((s) => STEP_LABEL[s])}
          current={STEPS.indexOf(step)}
        />
        {error && <Banner tone="error">{error}</Banner>}

        {step === "file" && (
          <Section title="Choose files" id="file">
            <label className="dropzone">
              <Icon name="download" size={24} />
              <strong>{busy ? "Reading…" : "Choose one or more files"}</strong>
              <span className="meta">
                .xlsx, .csv or tab-separated text. Several files are joined,
                matching people by participant ID or name.
              </span>
              <input
                type="file"
                multiple
                accept=".xlsx,.csv,.tsv,.txt,text/csv"
                onChange={(e) => {
                  void loadFiles([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="meta import-privacy">
              <Icon name="lock" size={16} />
              Read on this device. Only the fields you choose are sent, when you
              press Import. The file itself is never uploaded.
            </p>
          </Section>
        )}

        {step === "map" && table && (
          <Section title="Choose fields" id="map">
            <FilesPanel
              files={files}
              matches={matches}
              busy={busy}
              onAdd={(list) => void loadFiles(list, true)}
              onRemove={(i) =>
                files.length > 1
                  ? applyFiles(files.filter((_, x) => x !== i))
                  : setStep("file")
              }
            />
            {files.some((f) => f.table.sheets.length > 1) && (
              <TabSummary sheets={sheets} />
            )}
            <p className="meta">
              {plural(table.rows.length, "person", "people")} ·{" "}
              {plural(table.headers.length, "column")}
              <InfoTip label="How columns are matched">
                Columns are matched by their names on this device (no AI,
                nothing sent). Check each one, or choose "Don't send" for
                anything you don't need.
              </InfoTip>
            </p>
            {missing.length > 0 && (
              <Banner tone="warning">
                Choose the column with each person's first name.
              </Banner>
            )}
            {mapping.dietary !== undefined &&
              dietaryColumns(table.headers, mapping).length > 1 && (
                <p className="meta">
                  Dietaries are read from{" "}
                  {dietaryColumns(table.headers, mapping)
                    .map((i) => table.headers[i])
                    .join(", ")}
                  , together.
                </p>
              )}
            {mapping.dietary !== undefined && !reviewing && (
              <Banner tone="info">
                {context.data?.dietaryEnabled
                  ? "Dietaries will be flagged for an event manager to review."
                  : "Dietary needs are off for this event, so that column is not sent."}
              </Banner>
            )}
            <div className="map-grid">
              {shownFields.map((field) => (
                <FieldRow
                  key={field}
                  field={field}
                  table={table}
                  mapping={mapping}
                  onChange={setMapping}
                  extra={
                    field === "firstName" ? (
                      <Segmented
                        label="How much of the first name to send"
                        value={firstMode}
                        onChange={setFirstMode}
                        options={[
                          { value: "full", label: "Full" },
                          { value: "initial", label: "Initial only" },
                        ]}
                      />
                    ) : field === "lastName" ? (
                      <Segmented
                        label="How much of the last name to send"
                        value={lastMode}
                        onChange={setLastMode}
                        options={[
                          { value: "full", label: "Full" },
                          { value: "initial", label: "Initial only" },
                          { value: "none", label: "Don't send" },
                        ]}
                      />
                    ) : null
                  }
                />
              ))}
            </div>
            {otherColumns.length > 0 && (
              <div className="local-columns">
                <Toggle
                  checked={keepLocal}
                  onChange={setKeepLocal}
                  label={`Keep the other ${plural(otherColumns.length, "column")} on this device`}
                  hint={
                    keepLocal
                      ? "Never sent. Shown on each person’s page on this device only, and removed when you sign out."
                      : "They’re left in your file and not kept anywhere."
                  }
                />
                <p className="meta">
                  Not sent: {otherColumns.map((c) => c.h).join(", ")}
                </p>
              </div>
            )}
            <div className="btn-row form-actions">
              <Button
                kind="primary"
                disabled={missing.length > 0}
                onClick={check}
              >
                Next
              </Button>
              <Button onClick={() => setStep("file")}>Back</Button>
            </div>
          </Section>
        )}

        {step === "check" && (
          <Section title="Check" id="check">
            {!plan ? (
              <>
                <p>
                  <strong>{plural(valid.length, "person", "people")}</strong>{" "}
                  ready to compare with this event. Nothing has been sent yet.
                </p>
                <SendSummary
                  mapping={mapping}
                  firstMode={firstMode}
                  lastMode={lastMode}
                />
                {invalid.length > 0 && <Problems invalid={invalid} />}
                <div className="btn-row form-actions">
                  <Button
                    kind="primary"
                    busy={busy}
                    busyLabel="Checking…"
                    disabled={valid.length === 0}
                    onClick={() => void preview()}
                  >
                    Next
                  </Button>
                  <Button onClick={() => setStep("map")}>Back</Button>
                </div>
              </>
            ) : (
              <>
                <StatStrip
                  items={[
                    {
                      label: "New",
                      value: plan.counts.create,
                      tone: "success",
                    },
                    {
                      label: "Changed",
                      value: plan.counts.update,
                      tone: "info",
                    },
                    { label: "No change", value: plan.counts.unchanged },
                    ...(reviewing
                      ? [
                          {
                            label: "Dietary to review",
                            value: plan.counts.dietaryPending,
                            tone: "warning" as const,
                          },
                        ]
                      : []),
                    ...(withdrawMissing
                      ? [
                          {
                            label: "To withdraw",
                            value: plan.counts.withdraw,
                            tone: "error" as const,
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
                    hint={
                      withdrawMissing
                        ? `${plural(plan.counts.withdraw, "person", "people")} will be withdrawn. Their records are kept.`
                        : undefined
                    }
                  />
                  <InfoTip label="When to use this">
                    Use this when the file is the complete, current list.
                  </InfoTip>
                </div>
                {plan.counts.update > 0 && (
                  <details className="more-options">
                    <summary>
                      <Icon name="chevron" />
                      See what changed ({plan.counts.update})
                    </summary>
                    <ul className="list import-changes">
                      {plan.rows
                        .filter((r) => r.action === "update")
                        .map((r) => (
                          <li key={r.index} className="row">
                            <span className="row-main">
                              <span className="row-title">
                                {valid[r.index]!.row.firstName}{" "}
                                {valid[r.index]!.row.lastName}
                              </span>
                              <span className="row-meta">
                                {r.changes.join(", ")}
                              </span>
                            </span>
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
                <div className="btn-row form-actions">
                  {reviewing && pending.length > 0 ? (
                    <Button kind="primary" onClick={() => setStep("dietary")}>
                      Next
                    </Button>
                  ) : (
                    <Button
                      kind="primary"
                      busy={busy}
                      busyLabel="Importing…"
                      onClick={() => void commit()}
                    >
                      Import{" "}
                      {plural(
                        plan.counts.create + plan.counts.update,
                        "person",
                        "people",
                      )}
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      setPlan(null);
                      setRows([]);
                      setStep("map");
                    }}
                  >
                    Back
                  </Button>
                </div>
              </>
            )}
          </Section>
        )}

        {step === "dietary" && plan && (
          <Section
            title={
              <>
                Dietary review{" "}
                <InfoTip label="About dietary review">
                  Turn each note into dietary needs for the kitchen. Only what
                  you enter here is sent; the notes themselves stay on this
                  device.
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
              onUndo={(keys) =>
                setDietary(
                  Object.fromEntries(
                    Object.entries(dietary).filter(([k]) => !keys.includes(k)),
                  ),
                )
              }
            />
            <ul className="review-list">
              {pending
                .filter(
                  ({ source }) =>
                    !(
                      saysNothing(source.dietaryText) &&
                      dietary[rowKey(source)]?.length === 0
                    ),
                )
                .map(({ source }) => {
                  const key = rowKey(source);
                  const decided = dietary[key];
                  return (
                    <li
                      key={key}
                      className={
                        decided
                          ? "panel review-item is-done"
                          : "panel review-item"
                      }
                    >
                      <div className="review-head">
                        <strong>
                          {source.row.firstName} {source.row.lastName}
                        </strong>
                        <span className="meta">{source.row.groupName}</span>
                        {decided && <Badge tone="success">Reviewed</Badge>}
                      </div>
                      <blockquote className="source-note">
                        {source.dietaryText ||
                          "The note was removed in the new file."}
                      </blockquote>
                      <DietaryEditor
                        value={decided}
                        onChange={(entries) =>
                          setDietary({ ...dietary, [key]: entries })
                        }
                        labelPrefix={`${source.row.firstName} ${source.row.lastName}`}
                      />
                    </li>
                  );
                })}
            </ul>
            <div className="btn-row form-actions">
              <Button
                kind="primary"
                busy={busy}
                busyLabel="Importing…"
                onClick={() => void commit()}
              >
                Import
              </Button>
              <Button onClick={() => setStep("check")}>Back</Button>
              <span className="meta import-progress">
                {reviewedCount} of {pending.length} reviewed
                <InfoTip label="Not reviewed">
                  Anyone not reviewed stays flagged for next time.
                </InfoTip>
              </span>
            </div>
          </Section>
        )}

        {step === "done" && result && (
          <Section title="Done" id="done">
            <Banner tone="success">
              Import complete: {result.create} added, {result.update} updated,{" "}
              {result.unchanged} unchanged
              {result.withdraw > 0 && `, ${result.withdraw} withdrawn`}
              {invalid.length > 0 &&
                `, ${plural(invalid.length, "row", "rows")} skipped`}
            </Banner>
            <div className="btn-row">
              <Button kind="primary" onClick={() => navigate(`${base}/people`)}>
                View people
              </Button>
              <ButtonLink to={`${base}/people/lanyards/print`}>
                Print lanyards
              </ButtonLink>
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
  const required = field === "firstName" && mapping.fullName === undefined;
  const sample =
    index === undefined || field === "dietary"
      ? ""
      : (table.rows.find((r) => (r[index] ?? "").trim())?.[index] ?? "");
  return (
    <div
      className={
        unset && required
          ? "map-item is-missing"
          : unset
            ? "map-item is-unset"
            : "map-item"
      }
    >
      <label htmlFor={`map-${field}`} className="map-label">
        {def.label}
        {!required && <span className="field-optional"> (optional)</span>}
      </label>
      <select
        id={`map-${field}`}
        className="select"
        value={index ?? ""}
        onChange={(e) => {
          const next = { ...mapping };
          if (e.target.value === "") delete next[field];
          else {
            const i = Number(e.target.value);
            // A column feeds one field.
            for (const [f, v] of Object.entries(next))
              if (v === i) delete next[f as ImportField];
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
      <span className="map-sample">
        {sample ? `First row: ${sample}` : " "}
      </span>
      {!unset && extra}
    </div>
  );
}

/** What will be sent, in plain words, before anything is. */
function SendSummary({
  mapping,
  firstMode,
  lastMode,
}: {
  mapping: ColumnMapping;
  firstMode: FirstNameMode;
  lastMode: LastNameMode;
}) {
  const parts: string[] = [
    firstMode === "initial" ? "first initial" : "first name",
  ];
  if (
    (mapping.lastName !== undefined || mapping.fullName !== undefined) &&
    lastMode !== "none"
  )
    parts.push(lastMode === "initial" ? "last initial" : "last name");
  if (mapping.groupName !== undefined) parts.push("group");
  if (mapping.level !== undefined) parts.push("level");
  if (mapping.participantId !== undefined) parts.push("participant ID");
  if (mapping.photoConsent !== undefined)
    parts.push("photo consent (Yes or No)");
  if (mapping.dietary !== undefined) parts.push("dietary needs you confirm");
  return (
    <p className="meta import-privacy">
      <Icon name="lock" size={16} />
      When you press Import, only these are sent, encrypted: {parts.join(", ")}.
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
            <Button
              small
              kind="ghost"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? "Hide" : "Show"}
            </Button>
            <Button
              small
              onClick={() =>
                downloadCsv("campcount-import-problems.csv", [
                  ["Where", "Problem"],
                  ...invalid.map((p) => [
                    p.where ?? `Line ${p.line}`,
                    p.errors.join("; "),
                  ]),
                ])
              }
            >
              <Icon name="download" size={16} />
              Download
            </Button>
          </>
        }
      >
        {plural(invalid.length, "row has", "rows have")} problems and will be
        skipped
      </Banner>
      {open && (
        <ul className="problem-list">
          {invalid.slice(0, 8).map((p) => (
            <li key={p.line}>
              {p.where ?? `Line ${p.line}`}: {p.errors.join("; ")}
            </li>
          ))}
          {invalid.length > 8 && (
            <li className="meta">
              and {invalid.length - 8} more in the download
            </li>
          )}
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
  const matches = pending
    .map((p) => p.source)
    .filter((s) => saysNothing(s.dietaryText));
  const marked = matches
    .filter((s) => dietary[rowKey(s)]?.length === 0)
    .map(rowKey);
  const open = matches.filter((s) => dietary[rowKey(s)] === undefined);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  if (matches.length === 0) return null;
  const ticked = open.filter((s) => !unticked.has(rowKey(s)));
  return (
    <div className="panel panel-pad nothing-panel">
      <h3 className="nothing-title">
        {plural(matches.length, "note says", "notes say")} there's nothing to
        record
        <InfoTip label="About these notes">
          These notes are only "Nil", "None", "N/A" or similar, with nothing
          else written. Untick anyone you want to read in full, then mark the
          rest. Notes with any other words are never in this list.
        </InfoTip>
      </h3>
      {open.length > 0 ? (
        <>
          <fieldset className="nothing-list">
            <legend className="visually-hidden">
              Notes that say nothing to record
            </legend>
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
            <Button
              kind="primary"
              disabled={ticked.length === 0}
              onClick={() => onMark(ticked.map(rowKey))}
            >
              Mark {plural(ticked.length, "person", "people")} as no dietary
              needs
            </Button>
          </div>
        </>
      ) : null}
      {marked.length > 0 && (
        <p className="nothing-done">
          <Badge tone="success">Done</Badge>{" "}
          {plural(marked.length, "person", "people")} marked as no dietary
          needs.{" "}
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
        <strong>Read {plural(read.length, "tab")}</strong>:{" "}
        {read.map((t) => `${t.name} (${t.people})`).join(", ")}
      </p>
      {skipped.length > 0 && (
        <p className="meta">
          Skipped:{" "}
          {skipped
            .map((t) => `${t.name} (${t.skipped!.toLowerCase()})`)
            .join(", ")}
        </p>
      )}
      <p className="meta">
        Each person's tab is in the "{TAB_COLUMN}" column, which you can send as
        their group or level.
      </p>
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
}: {
  files: { name: string; table: CombinedTable }[];
  matches: FileMatch[];
  busy: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="panel panel-pad import-files">
      <ul className="list">
        {files.map((f, i) => {
          const m = matches[i];
          return (
            <li key={`${f.name}-${i}`} className="row">
              <span className="row-main">
                <span className="row-title">{f.name}</span>
                <span className="row-meta">
                  {plural(f.table.rows.length, "person", "people")}
                  {m && i > 0 && (
                    <>
                      {" "}
                      · matched {m.matched} by{" "}
                      {m.by === "id" ? "participant ID" : "name"}, {m.added} new
                      {m.ambiguous > 0 &&
                        `, ${plural(m.ambiguous, "name")} shared by two people (added separately)`}
                    </>
                  )}
                  {i === 0 &&
                    files.length > 1 &&
                    " · the starting list; its values win"}
                </span>
              </span>
              <Button
                small
                kind="ghost"
                aria-label={`Remove ${f.name}`}
                onClick={() => onRemove(i)}
              >
                <Icon name="trash" size={16} />
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="btn-row">
        <label className="btn btn-secondary btn-small add-file">
          <Icon name="plus" size={16} />{" "}
          {busy ? "Reading…" : "Add another spreadsheet"}
          <input
            type="file"
            multiple
            className="visually-hidden"
            accept=".xlsx,.csv,.tsv,.txt,text/csv"
            onChange={(e) => {
              onAdd([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </label>
        <InfoTip label="How files are joined">
          People are matched across files on this device: by participant ID, or
          by first and last name when a file has no IDs (only when exactly one
          person has that name). Where two files have the same column, the first
          file&apos;s value is kept and later files only fill blanks. People in
          only one file are still included.
        </InfoTip>
      </div>
    </div>
  );
}
