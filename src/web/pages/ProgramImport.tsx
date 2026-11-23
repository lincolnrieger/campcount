import { useState } from 'react';
import { parseDelimited } from '../../shared/csv';
import type { ProgramField, ProgramMapping, ProgramRow } from '../../shared/program';
import { PROGRAM_FIELDS, autoMapProgram, describeWhen, prepareProgram } from '../../shared/program';
import { eventDays, zonedIso } from '../../shared/time';
import { ApiFailure, api } from '../api';
import { readFirstSheet } from '../import/xlsx';
import type { Activity, Meal } from '../model';
import { useApi } from '../useApi';
import { Badge, Banner, Button, ButtonLink, FilterChips, Icon, InfoTip, LoadError, Loading, PageHeader, SkeletonRows, StatStrip, Stepper, Toggle, Toolbar, plural, useToast } from '../ui';
import { useEvent } from './EventLayout';

type Step = 'file' | 'map' | 'check' | 'done';
type CheckFilter = 'all' | 'add' | 'problems' | 'skipped';
const STEPS: Step[] = ['file', 'map', 'check', 'done'];
const STEP_LABEL: Record<Step, string> = { file: 'Choose file', map: 'Match columns', check: 'Check', done: 'Done' };

const TEMPLATE = [
  'Name,Type,Day,Start,End,Place,Places,Booking,Description',
  'Welcome,Programme,Saturday,8:30,9:00,Main arena,,,',
  'Kayaking,Activity,Saturday,9:00,10:30,Lake,12,Required,Bring a change of clothes',
  'Archery,Activity,Saturday,9:00,10:30,Range,10,,',
  'Saturday lunch,Meal,Saturday,12:00,13:00,Hall,,,',
  'Campfire,Programme,Saturday,19:30,21:00,Fire circle,,,',
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
  const [checkFilter, setCheckFilter] = useState<CheckFilter>('all');
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
        .filter((r) => r.kind !== 'meal')
        .map((r) => ({
          kind: r.kind === 'program' ? ('program' as const) : ('activity' as const),
          // Booking-required sessions can be booked by people themselves (lanyard page and sign-up screen).
          bookingRequired: r.bookingRequired,
          signupOpen: r.bookingRequired,
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

  const header = (
    <PageHeader
      title="Import programme"
      back={{ to: `${base}/activities`, label: 'Activities' }}
      help="Activities, meals and programme items (Welcome, Movies) from one spreadsheet. The file is read on this computer; only the rows you import are sent."
    />
  );
  if (!can('activities.manage'))
    return (
      <>
        {header}
        <Banner tone="warning">Only event managers can import a programme.</Banner>
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

  const outcome = (r: ProgramRow): CheckFilter => (r.errors.length ? 'problems' : (isDupe(r) && skipDupes) || (r.kind === 'meal' && !mealsAllowed) ? 'skipped' : 'add');
  const outcomeCount = (f: CheckFilter) => rows.filter((r) => f === 'all' || outcome(r) === f).length;
  const checked = rows.filter((r) => checkFilter === 'all' || outcome(r) === checkFilter);

  return (
    <>
      {header}
      <div className="sections pg-sections">
        <Stepper steps={STEPS.map((s) => STEP_LABEL[s])} current={STEPS.indexOf(step)} />
        {error && <Banner tone="error">{error}</Banner>}

        {step === 'file' && (
          <section className="panel panel-pad pg-import-file" aria-labelledby="pi-file-heading">
            <div className="pg-import-file-head">
              <h2 id="pi-file-heading" className="pg-panel-title">
                Choose file
              </h2>
              <InfoTip label="What the file needs">
                One row per session: a name, and ideally day, start, end and place. Set Type to Meal or Programme for those rows. Put Required in Booking for
                activities people must book. Days: 5/12/2026, Saturday or Day 1. Times: 9:00, 9am or 14:30.
              </InfoTip>
              <a className="btn btn-ghost btn-small pg-push" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="programme-template.csv">
                <Icon name="download" size={18} />
                Download template
              </a>
            </div>
            <label className="dropzone pg-dropzone">
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
          </section>
        )}

        {step === 'map' && table && (
          <section className="pg-import-step" aria-labelledby="pi-map-heading">
            <div className="section-head">
              <h2 id="pi-map-heading">Match columns</h2>
              <span className="meta">
                {fileName} · {plural(table.rows.length, 'row')}
              </span>
            </div>
            {mapping.name === undefined && <Banner tone="warning">Choose the column with each session's name.</Banner>}
            <ul className="pg-map">
              {(Object.keys(PROGRAM_FIELDS) as ProgramField[]).map((field) => {
                const def = PROGRAM_FIELDS[field];
                const index = mapping[field];
                const sample = index === undefined ? '' : (table.rows.find((r) => (r[index] ?? '').trim())?.[index] ?? '');
                return (
                  <li key={field} className={index === undefined ? 'pg-map-item' : 'pg-map-item is-set'}>
                    <label htmlFor={`pmap-${field}`} className="pg-map-label">
                      {def.label}
                      {!def.required && <span className="field-optional"> (optional)</span>}
                    </label>
                    <select
                      id={`pmap-${field}`}
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
                    <span className="row-meta pg-map-sample">{sample ? `e.g. ${sample}` : ' '}</span>
                  </li>
                );
              })}
            </ul>
            {mapping.type === undefined && mealsAllowed && (
              <Toggle label="Treat Breakfast, Lunch, Dinner rows as meals" hint="Counted as meals, not booked like activities." checked={mealsByName} onChange={setMealsByName} />
            )}
            <div className="pg-actionbar">
              <Button
                kind="primary"
                disabled={mapping.name === undefined}
                onClick={() => {
                  setRows(prepareProgram(table.rows, mapping, days, { mealsByName: mealsAllowed && mealsByName }));
                  setCheckFilter('all');
                  setStep('check');
                }}
              >
                Next
              </Button>
              <Button onClick={() => setStep('file')}>Back</Button>
            </div>
          </section>
        )}

        {step === 'check' && (
          <section className="pg-import-step" aria-labelledby="pi-check-heading">
            <h2 id="pi-check-heading" className="visually-hidden">
              Check
            </h2>
            <StatStrip
              items={[
                { label: 'Activities and programme', value: toSend.filter((r) => r.kind !== 'meal').length, tone: 'success' },
                { label: 'Meals to add', value: toSend.filter((r) => r.kind === 'meal').length },
                { label: 'Rows with problems', value: problems.length, tone: problems.length ? 'warning' : undefined, pressed: checkFilter === 'problems', onPress: problems.length ? () => setCheckFilter('problems') : undefined },
              ]}
            />
            {(problems.length > 0 || mealsSkipped > 0) && (
              <div className="banners">
                {problems.length > 0 && (
                  <Banner tone="warning" action={checkFilter !== 'problems' && <Button small onClick={() => setCheckFilter('problems')}>Show them</Button>}>
                    {plural(problems.length, 'row')} won't be added. <span className="meta">Fix them in the file and choose it again, or add them by hand.</span>
                  </Banner>
                )}
                {mealsSkipped > 0 && <Banner>{plural(mealsSkipped, 'meal')} won't be added: meals are off for this camp, or you can't manage them.</Banner>}
              </div>
            )}
            <Toolbar label="Rows">
              <FilterChips
                label="Show rows"
                value={checkFilter}
                onChange={setCheckFilter}
                options={[
                  { value: 'all', label: 'All', count: outcomeCount('all') },
                  { value: 'add', label: 'To add', count: outcomeCount('add') },
                  { value: 'problems', label: 'Problems', count: outcomeCount('problems') },
                  { value: 'skipped', label: 'Skipped', count: outcomeCount('skipped') },
                ]}
              />
              {dupes > 0 && (
                <div className="toolbar-end">
                  <Toggle label={`Skip ${plural(dupes, 'row')} already in the programme`} hint="Same name at the same time." checked={skipDupes} onChange={setSkipDupes} />
                </div>
              )}
            </Toolbar>
            <div className="table-wrap scroll-list">
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
                  {checked.length === 0 && (
                    <tr>
                      <td colSpan={5} className="meta">
                        No rows here.
                      </td>
                    </tr>
                  )}
                  {checked.map((r) => {
                    const dupe = r.errors.length === 0 && isDupe(r);
                    return (
                      <tr key={r.line}>
                        <td className="num">{r.line}</td>
                        <td>
                          <strong>{r.name || '(no name)'}</strong>
                          {r.kind !== 'activity' && (
                            <>
                              {' '}
                              <Badge tone={r.kind === 'meal' ? 'info' : 'neutral'}>{r.kind === 'meal' ? 'Meal' : 'Programme'}</Badge>
                            </>
                          )}
                          {r.bookingRequired && (
                            <>
                              {' '}
                              <Badge tone="brand">Booking required</Badge>
                            </>
                          )}
                        </td>
                        <td className="pg-nowrap">{describeWhen(r)}</td>
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
            <div className="pg-actionbar">
              <Button kind="primary" disabled={toSend.length === 0} busy={busy} busyLabel="Importing…" onClick={() => void importNow()}>
                Import {plural(toSend.length, 'session')}
              </Button>
              <Button onClick={() => setStep('map')}>Back</Button>
            </div>
          </section>
        )}

        {step === 'done' && result && (
          <section className="pg-import-step" aria-labelledby="pi-done-heading">
            <h2 id="pi-done-heading" className="visually-hidden">
              Done
            </h2>
            <Banner tone="success">
              Programme imported. <span className="meta">Added {plural(result.activities, 'activity', 'activities')}
              {result.meals ? ` and ${plural(result.meals, 'meal')}` : ''}.</span>
            </Banner>
            <div className="btn-row">
              <ButtonLink to={`${base}/schedule`} kind="primary">
                Open the schedule
              </ButtonLink>
              <ButtonLink to={`${base}/activities`}>View activities</ButtonLink>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
