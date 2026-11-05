import { useState } from 'react';
import { parseDelimited } from '../../shared/csv';
import type { ProgramField, ProgramMapping, ProgramRow } from '../../shared/program';
import { PROGRAM_FIELDS, autoMapProgram, describeWhen, prepareProgram } from '../../shared/program';
import { eventDays, zonedIso } from '../../shared/time';
import { ApiFailure, api } from '../api';
import { readFirstSheet } from '../import/xlsx';
import type { Activity, Meal } from '../model';
import { useApi } from '../useApi';
import { Badge, Button, ButtonLink, Choice, CountTile, Icon, LoadError, Loading, Notice, PageHeader, Section, SkeletonRows, Stepper, plural, useToast } from '../ui';
import { useEvent } from './EventLayout';

type Step = 'file' | 'map' | 'check' | 'done';
const STEPS: Step[] = ['file', 'map', 'check', 'done'];
const STEP_LABEL: Record<Step, string> = { file: 'Choose file', map: 'Match columns', check: 'Check', done: 'Done' };

const TEMPLATE = [
  'Name,Type,Day,Start,End,Place,Places,Description',
  'Kayaking,Activity,Saturday,9:00,10:30,Lake,12,Bring a change of clothes',
  'Archery,Activity,Saturday,9:00,10:30,Range,10,',
  'Saturday lunch,Meal,Saturday,12:00,13:00,Hall,,',
  'Campfire,Activity,Saturday,19:30,21:00,Fire circle,,',
].join('\n');

/**
 * Activities › Import programme: load a whole camp programme (activities and
 * meals) from a spreadsheet. The file is read on this computer; only the
 * rows shown in the check step are sent, all together.
 */
export function ProgramImport() {
  const { event, can, base } = useEvent();
  const toast = useToast();
  const days = eventDays(event.startsOn, event.endsOn);
  const existing = useApi<{ activities: Activity[] }>(`/events/${event.id}/activities`);
  const existingMeals = useApi<{ meals: Meal[] }>(event.features.meals && can('meals.manage') ? `/events/${event.id}/meals` : null);
  const [step, setStep] = useState<Step>('file');
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<ProgramMapping>({});
  const [mealsByName, setMealsByName] = useState(true);
  const [rows, setRows] = useState<ProgramRow[]>([]);
  const [skipDupes, setSkipDupes] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ activities: number; meals: number } | null>(null);
  const mealsAllowed = event.features.meals && can('meals.manage');

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
      if (parsed.rows.length === 0) throw new Error('That file has a header row but nothing under it.');
      setTable(parsed);
      setFileName(file.name);
      setMapping(autoMapProgram(parsed.headers));
      setStep('map');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  }

  // Something with the same name at the same time is already in the programme.
  const tz = event.timezone;
  const key = (name: string, startsAt: string | null) => `${name.trim().toLowerCase()}|${startsAt ? Date.parse(startsAt) : ''}`;
  const taken = new Set([
    ...(existing.data?.activities ?? []).filter((a) => a.status === 'active').map((a) => key(a.name, a.startsAt)),
    ...(existingMeals.data?.meals ?? []).filter((m) => m.status === 'active').map((m) => key(m.name, m.startsAt)),
  ]);
  const at = (r: ProgramRow, time: string | null) => (r.day && time ? zonedIso(r.day, time, tz) : null);
  const isDupe = (r: ProgramRow) => taken.has(key(r.name, at(r, r.start)));

  const valid = rows.filter((r) => r.errors.length === 0 && (r.kind === 'activity' || mealsAllowed));
  const toSend = valid.filter((r) => !(skipDupes && isDupe(r)));
  const problems = rows.filter((r) => r.errors.length > 0);
  const mealsSkipped = rows.filter((r) => r.errors.length === 0 && r.kind === 'meal' && !mealsAllowed).length;
  const dupes = valid.filter(isDupe).length;

  async function importNow() {
    setBusy(true);
    setError(null);
    try {
      const activities = toSend
        .filter((r) => r.kind === 'activity')
        .map((r) => ({
          name: r.name,
          location: r.location,
          description: r.description,
          instructions: r.instructions,
          startsAt: at(r, r.start),
          endsAt: at(r, r.end),
          capacity: r.capacity,
        }));
      const meals = toSend.filter((r) => r.kind === 'meal').map((r) => ({ name: r.name, location: r.location, startsAt: at(r, r.start), endsAt: at(r, r.end) }));
      const res = await api<{ activities: number; meals: number }>(`/events/${event.id}/program/import`, { body: { activities, meals } });
      setResult(res);
      setStep('done');
      toast(`Imported ${plural(res.activities, 'activity', 'activities')}${res.meals ? ` and ${plural(res.meals, 'meal')}` : ''}`);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : 'No connection. Check your signal and try again.');
    } finally {
      setBusy(false);
    }
  }

  const header = <PageHeader title="Import programme" back={{ to: `${base}/activities`, label: 'Activities' }} />;
  if (!can('activities.manage'))
    return (
      <>
        {header}
        <Notice tone="warning">
          <p>Only event managers can import a programme.</p>
        </Notice>
      </>
    );
  if (existing.loading && !existing.data)
    return (
      <>
        {header}
        <Loading what="the programme">
          <SkeletonRows rows={3} />
        </Loading>
      </>
    );
  if (existing.error)
    return (
      <>
        {header}
        <LoadError error={existing.error} onRetry={existing.reload} what="the programme" />
      </>
    );

  return (
    <>
      {header}
      <div className="sections">
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
                Use any spreadsheet with one row per session: at least a name, and ideally a day, start and end time and place. Meals can go in the same file.
                Repeat a row for each session of the same activity.
              </p>
              <p className="meta">
                Days can be dates (5/12/2026), weekdays (Saturday) or "Day 1". Times can be 9:00, 9am or 14:30.{' '}
                <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="programme-template.csv">
                  Download a template
                </a>
              </p>
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
              {fileName}: {plural(table.rows.length, 'row')}. Choose which column holds each detail.
            </p>
            <ul className="list">
              {(Object.keys(PROGRAM_FIELDS) as ProgramField[]).map((field) => {
                const def = PROGRAM_FIELDS[field];
                const index = mapping[field];
                const sample = index === undefined ? '' : (table.rows.find((r) => (r[index] ?? '').trim())?.[index] ?? '');
                return (
                  <li key={field} className="row map-row">
                    <span className="row-main">
                      <label htmlFor={`pmap-${field}`} className="row-title">
                        {def.label}
                        {!def.required && <span className="field-optional"> (optional)</span>}
                      </label>
                      {sample && <span className="row-meta">For example: {sample}</span>}
                    </span>
                    <select
                      id={`pmap-${field}`}
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
            {mapping.type === undefined && mealsAllowed && (
              <Choice
                label="Treat Breakfast, Lunch, Dinner and similar rows as meals"
                description="So they're counted as meals, not booked like activities."
                checked={mealsByName}
                onChange={(e) => setMealsByName(e.target.checked)}
              />
            )}
            {mapping.name === undefined && (
              <Notice tone="warning">
                <p>Choose the column with each session's name.</p>
              </Notice>
            )}
            <div className="btn-row">
              <Button
                kind="primary"
                disabled={mapping.name === undefined}
                onClick={() => {
                  setRows(prepareProgram(table.rows, mapping, days, { mealsByName: mealsAllowed && mealsByName }));
                  setStep('check');
                }}
              >
                Next
              </Button>
              <Button onClick={() => setStep('file')}>Back</Button>
            </div>
          </Section>
        )}

        {step === 'check' && (
          <Section title="Check" id="check">
            <div className="tiles">
              <CountTile value={toSend.filter((r) => r.kind === 'activity').length} label="Activities to add" tone="success" />
              <CountTile value={toSend.filter((r) => r.kind === 'meal').length} label="Meals to add" tone="info" />
              <CountTile value={problems.length} label="Rows with problems" tone={problems.length ? 'warning' : 'neutral'} />
            </div>
            {dupes > 0 && (
              <Choice
                label={`Skip ${plural(dupes, 'row')} already in the programme`}
                description="Same name at the same time as one that's already there."
                checked={skipDupes}
                onChange={(e) => setSkipDupes(e.target.checked)}
              />
            )}
            {mealsSkipped > 0 && (
              <Notice tone="info">
                <p>{plural(mealsSkipped, 'meal')} won't be added: meals are switched off for this camp, or you can't manage them.</p>
              </Notice>
            )}
            {problems.length > 0 && (
              <Notice tone="warning" title={`${plural(problems.length, 'row')} won't be added`}>
                <p>Fix these in the file and choose it again, or add them by hand afterwards.</p>
              </Notice>
            )}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Line</th>
                    <th scope="col">Name</th>
                    <th scope="col">When</th>
                    <th scope="col" className="only-desktop">
                      Place
                    </th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const dupe = r.errors.length === 0 && isDupe(r);
                    return (
                      <tr key={r.line}>
                        <td className="num">{r.line}</td>
                        <td>
                          <strong>{r.name || '(no name)'}</strong>
                          {r.kind === 'meal' && (
                            <>
                              {' '}
                              <Badge tone="info">Meal</Badge>
                            </>
                          )}
                        </td>
                        <td>{describeWhen(r)}</td>
                        <td className="only-desktop">{r.location}</td>
                        <td>
                          {r.errors.length ? (
                            <Badge tone="warning">{r.errors.join('; ')}</Badge>
                          ) : dupe && skipDupes ? (
                            <Badge>Already there, skipped</Badge>
                          ) : r.kind === 'meal' && !mealsAllowed ? (
                            <Badge>Skipped</Badge>
                          ) : (
                            <Badge tone="success">Will be added</Badge>
                          )}
                          {r.notes.length > 0 && <span className="meta"> {r.notes.join('; ')}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="btn-row">
              <Button kind="primary" disabled={toSend.length === 0} busy={busy} busyLabel="Importing…" onClick={() => void importNow()}>
                Import {plural(toSend.length, 'session')}
              </Button>
              <Button onClick={() => setStep('map')}>Back</Button>
            </div>
          </Section>
        )}

        {step === 'done' && result && (
          <Section title="Done" id="done">
            <Notice tone="success" title="Programme imported">
              <p>
                Added {plural(result.activities, 'activity', 'activities')}
                {result.meals ? ` and ${plural(result.meals, 'meal')}` : ''}.
              </p>
            </Notice>
            <div className="btn-row">
              <ButtonLink to={`${base}/schedule`} kind="primary">
                Open the schedule
              </ButtonLink>
              <ButtonLink to={`${base}/activities`}>View activities</ButtonLink>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
