import { useEffect, useMemo, useRef, useState } from 'react';
import { HEALTH_EXTRA_FIELDS } from '../../shared/consent2go';
import type { IntakePerson, IntakeSource, IntakeState } from '../../shared/intake';
import { SOURCE_NAME, needsCheck } from '../../shared/intake';
import { matchesSearch } from '../../shared/search';
import { saysNothing } from '../../shared/myscout';
import { SECTIONS } from '../../shared/sections';
import type { DietaryEntryInput, ImportRow } from '../../shared/schemas';
import { ApiFailure, api } from '../api';
import { DietaryEditor, describeEntry } from '../components/DietaryEditor';
import type { ReadFile, SourceRecord } from '../import/intakeFiles';
import { dietaryFingerprint, fingerprints, hmacKey, memberKey, readIntakeFile } from '../import/intakeFiles';
import { useApi } from '../useApi';
import { Badge, Button, ButtonLink, Choice, CountTile, EmptyState, Icon, LoadError, Loading, Notice, PageHeader, SearchField, Section, plural, useToast } from '../ui';
import { useEvent } from './EventLayout';

interface Board {
  people: IntakePerson[];
  lastUpload: Record<IntakeSource, string | null>;
  fingerprintKey: string;
  dietaryEnabled: boolean;
  canEditDietary: boolean;
  editable: boolean;
  checklist: { key: string; label: string }[];
}

type Files = Map<string, Partial<Record<IntakeSource, SourceRecord>>>;
type Filter = 'todo' | 'all' | 'checked' | 'both' | 'myscout' | 'consent2go' | 'left_off' | 'roster_only';

const STATE_BADGE: Record<IntakeState, { tone: 'neutral' | 'success' | 'warning' | 'info' | 'error'; text: string }> = {
  new: { tone: 'info', text: 'To check' },
  changed: { tone: 'warning', text: 'Changed' },
  in_progress: { tone: 'warning', text: 'Half done' },
  checked: { tone: 'success', text: 'Checked' },
  left_off: { tone: 'neutral', text: 'Left off camp' },
  roster_only: { tone: 'neutral', text: 'Not in either file' },
};

const fail = (err: unknown) => (err instanceof ApiFailure || err instanceof Error ? err.message : 'No connection. Check your signal and try again.');
const when = (iso: string) => new Date(iso).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * People › Import & check. Upload the MyScout and Consent2Go exports
 * (together or one at a time, as often as you like), then check each person
 * with both files side by side. People already checked are skipped next time
 * unless something about them changed, or they've since filled in the other.
 */
export function Intake() {
  const { event, base } = useEvent();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Board>(`/events/${event.id}/intake`);
  const [board, setBoard] = useState<Board | null>(null);
  const [files, setFiles] = useState<Files>(new Map());
  const [read, setRead] = useState<ReadFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('todo');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (data) setBoard(data);
  }, [data]);

  const people = useMemo(() => board?.people ?? [], [board]);
  const counts = useMemo(
    () => ({
      todo: people.filter((p) => needsCheck(p.state)).length,
      checked: people.filter((p) => p.state === 'checked').length,
      both: people.filter((p) => p.myscout && p.consent2go).length,
      myscout: people.filter((p) => p.myscout && !p.consent2go).length,
      consent2go: people.filter((p) => !p.myscout && p.consent2go).length,
      left_off: people.filter((p) => p.state === 'left_off').length,
      roster_only: people.filter((p) => p.state === 'roster_only').length,
      all: people.length,
    }),
    [people],
  );
  const shown = people.filter((p) => {
    const keep =
      filter === 'all' ||
      (filter === 'todo' && needsCheck(p.state)) ||
      (filter === 'checked' && p.state === 'checked') ||
      (filter === 'both' && p.myscout && p.consent2go) ||
      (filter === 'myscout' && p.myscout && !p.consent2go) ||
      (filter === 'consent2go' && !p.myscout && p.consent2go) ||
      (filter === 'left_off' && p.state === 'left_off') ||
      (filter === 'roster_only' && p.state === 'roster_only');
    return keep && (!q.trim() || matchesSearch(q, `${p.name} ${p.memberNumber} ${p.groupName}`));
  });

  async function upload(list: FileList) {
    if (!board) return;
    setProblem(null);
    setBusy(true);
    try {
      const key = await hmacKey(board.fingerprintKey);
      const results: ReadFile[] = [];
      for (const f of [...list]) results.push(await readIntakeFile(f));
      const next: Files = new Map(files);
      for (const r of results) {
        for (const rec of r.records) next.set(rec.key, { ...next.get(rec.key), [r.source]: rec });
        // Tell the server who is in the file: names and fingerprints only.
        const sent = await Promise.all(
          r.records.map(async (rec) => ({
            memberNumber: rec.prepared.row.memberNumber,
            name: `${rec.prepared.row.preferredName || rec.prepared.row.firstName} ${rec.prepared.row.lastName}`.trim().slice(0, 130),
            section: rec.prepared.row.section,
            groupName: rec.prepared.row.groupName,
            fields: await fingerprints(key, rec.raw),
          })),
        );
        for (let i = 0; i < sent.length; i += 100) await api(`/events/${event.id}/intake/seen`, { body: { source: r.source, people: sent.slice(i, i + 100) } });
      }
      setFiles(next);
      setRead((prev) => [...prev.filter((p) => !results.some((r) => r.source === p.source)), ...results]);
      await reload();
      setFilter('todo');
      toast(results.map((r) => `${SOURCE_NAME[r.source]}: ${plural(r.records.length, 'person', 'people')}`).join(' · '));
    } catch (err) {
      setProblem(fail(err));
    } finally {
      setBusy(false);
    }
  }

  const back = { to: `${base}/people`, label: 'People' };
  const header = (
    <PageHeader
      title="Import & check"
      back={back}
      summary="Upload the MyScout and Consent2Go exports, together or one at a time, as often as you like. Check each person with both side by side. Anyone you’ve checked is skipped next time, unless their details change or they fill in the other one."
      menu={[{ label: 'Import with column matching', to: `${base}/people/import/columns` }]}
    />
  );
  if (loading && !board) return (<>{header}<Loading what="the import" rows={6} /></>);
  if (error && !board) return (<>{header}<LoadError error={error} onRetry={reload} what="the import" /></>);
  if (!board) return null;

  const openIndex = open ? shown.findIndex((p) => memberKey(p.memberNumber) === open) : -1;
  const person = open ? people.find((p) => memberKey(p.memberNumber) === open) : undefined;
  if (person) {
    const go = (i: number) => {
      const p = shown[i];
      setOpen(p ? memberKey(p.memberNumber) : null);
      top.current?.scrollIntoView();
    };
    return (
      <div ref={top}>
        <CheckCard
          key={person.memberNumber}
          eventId={event.id}
          peopleBase={`${base}/people`}
          board={board}
          person={person}
          files={files.get(memberKey(person.memberNumber)) ?? {}}
          position={openIndex >= 0 ? { at: openIndex + 1, of: shown.length } : null}
          onBack={() => setOpen(null)}
          onPrev={openIndex > 0 ? () => go(openIndex - 1) : undefined}
          onNext={openIndex >= 0 && openIndex < shown.length - 1 ? () => go(openIndex + 1) : undefined}
          onSaved={(updated, advance) => {
            setBoard((b) => (b ? { ...b, people: b.people.map((p) => (memberKey(p.memberNumber) === memberKey(updated.memberNumber) ? updated : p)) } : b));
            if (advance) {
              // The list is filtered: the next one to do is at the same place once this one drops off "To check".
              const rest = shown.filter((p) => memberKey(p.memberNumber) !== memberKey(updated.memberNumber));
              const stillShown = filter !== 'todo' || needsCheck(updated.state);
              const nextP = stillShown ? shown[openIndex + 1] : rest[openIndex];
              setOpen(nextP ? memberKey(nextP.memberNumber) : null);
              top.current?.scrollIntoView();
            }
          }}
        />
      </div>
    );
  }

  const tile = (f: Filter, label: string, tone: 'neutral' | 'success' | 'warning' | 'info' = 'neutral') => (
    <CountTile value={counts[f]} label={label} tone={tone} pressed={filter === f} onPress={() => setFilter(f)} />
  );
  return (
    <>
      {header}
      <div className="sections intake">
        {problem && (
          <Notice tone="error" title="That file couldn’t be used">
            <p>{problem}</p>
          </Notice>
        )}
        {board.editable && (
          <Section title="Upload exports" id="upload">
            <label className="dropzone">
              <Icon name="download" size={24} />
              <strong>{busy ? 'Reading…' : 'Choose the MyScout and Consent2Go files'}</strong>
              <span className="meta">Pick one or both. Each is recognised by its columns. The files stay on this computer: only names and fingerprints are sent.</span>
              <input type="file" multiple accept=".xlsx,.csv,.tsv,.txt,text/csv" disabled={busy} onChange={(e) => e.target.files?.length && void upload(e.target.files)} />
            </label>
            <ul className="intake-sources">
              {(['myscout', 'consent2go'] as const).map((s) => {
                const r = read.find((x) => x.source === s);
                return (
                  <li key={s}>
                    <strong>{SOURCE_NAME[s]}</strong>
                    <span className="meta">
                      {r ? `${r.fileName}: ${plural(r.records.length, 'person', 'people')} read now` : 'Not uploaded on this visit'}
                      {board.lastUpload[s] ? ` · last uploaded ${when(board.lastUpload[s]!)}` : ' · never uploaded'}
                    </span>
                  </li>
                );
              })}
            </ul>
            {read.some((r) => r.problems.length) && (
              <Notice tone="warning" title="Rows that couldn’t be read">
                <ul>
                  {read.flatMap((r) =>
                    r.problems.map((p, i) => (
                      <li key={`${r.source}-${i}`}>
                        {SOURCE_NAME[r.source]}, {p.where}: {p.errors.join('; ')}
                      </li>
                    )),
                  )}
                </ul>
              </Notice>
            )}
          </Section>
        )}

        <Section title="Everyone" id="everyone">
          <div className="tiles intake-tiles">
            {tile('todo', 'To check', counts.todo ? 'warning' : 'success')}
            {tile('checked', 'Checked', 'success')}
            {tile('both', 'In both')}
            {tile('myscout', 'MyScout only')}
            {tile('consent2go', 'Consent2Go only')}
            {counts.left_off > 0 && tile('left_off', 'Left off camp')}
            {counts.roster_only > 0 && tile('roster_only', 'In neither file')}
            {tile('all', 'Everyone')}
          </div>
          <div className="intake-tools">
            <SearchField id="intake-q" label="Find a person" value={q} onChange={setQ} placeholder="Name, membership number or group" />
            {counts.todo > 0 && filter === 'todo' && shown.length > 0 && (
              <Button kind="primary" onClick={() => setOpen(memberKey(shown[0]!.memberNumber))}>
                Start checking
              </Button>
            )}
          </div>
          {people.length === 0 ? (
            <EmptyState title="No one yet">Upload the MyScout export, the Consent2Go export, or both.</EmptyState>
          ) : shown.length === 0 ? (
            <p className="meta">{filter === 'todo' ? 'Everyone is checked. Upload new exports any time to catch late registrations and changes.' : 'No one here.'}</p>
          ) : (
            <ul className="list intake-list">
              {shown.map((p) => {
                const b = STATE_BADGE[p.state];
                const k = memberKey(p.memberNumber);
                return (
                  <li key={k}>
                    <button type="button" className="row row-button" onClick={() => setOpen(k)}>
                      <span className="row-main">
                        <span className="row-title">{p.name}</span>
                        <span className="row-meta">{[p.memberNumber, p.section, p.groupName].filter(Boolean).join(' · ')}</span>
                        {p.changed.length > 0 && <span className="row-meta intake-changed">Changed: {p.changed.slice(0, 3).join(', ')}{p.changed.length > 3 ? ` and ${p.changed.length - 3} more` : ''}</span>}
                      </span>
                      <span className="intake-marks">
                        <SourceMark label="MyScout" on={!!p.myscout} />
                        <SourceMark label="Consent2Go" on={!!p.consent2go} />
                        <Badge tone={b.tone}>{b.text}</Badge>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

function SourceMark({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={on ? 'intake-mark is-on' : 'intake-mark'}>
      <Icon name={on ? 'check' : 'cross'} size={14} />
      {label}
      <span className="visually-hidden">{on ? ': in the file' : ': not in the file'}</span>
    </span>
  );
}

// ---------------------------------------------------------------- one person

type FieldKey = 'firstName' | 'preferredName' | 'lastName' | 'section' | 'groupName' | 'photoConsent';
const FIELDS: { key: FieldKey; label: string }[] = [
  { key: 'firstName', label: 'First name' },
  { key: 'preferredName', label: 'Preferred name' },
  { key: 'lastName', label: 'Last name' },
  { key: 'section', label: 'Section' },
  { key: 'groupName', label: 'Group' },
  { key: 'photoConsent', label: 'Photo consent' },
];
const PHOTO: Record<string, string> = { yes: 'Yes', no: 'No', unknown: 'Not given' };
const show = (k: FieldKey, v: string) => (k === 'photoConsent' ? (PHOTO[v] ?? v) : v);

type Col = 'myscout' | 'consent2go' | 'now';
const COL_NAME: Record<Col, string> = { myscout: 'MyScout', consent2go: 'Consent2Go', now: 'CampCount now' };

/** Which value to keep by default: MyScout for who they are, Consent2Go for photo consent. */
function defaultPick(k: FieldKey, values: Record<Col, string | undefined>): Col | null {
  const has = (c: Col) => values[c] !== undefined && values[c] !== '' && !(k === 'photoConsent' && values[c] === 'unknown');
  const order: Col[] = k === 'photoConsent' ? ['consent2go', 'myscout', 'now'] : k === 'preferredName' ? ['myscout', 'now'] : ['myscout', 'now', 'consent2go'];
  return order.find(has) ?? (values.now !== undefined ? 'now' : values.myscout !== undefined ? 'myscout' : values.consent2go !== undefined ? 'consent2go' : null);
}

function CheckCard({
  eventId,
  peopleBase,
  board,
  person,
  files,
  position,
  onBack,
  onPrev,
  onNext,
  onSaved,
}: {
  eventId: string;
  peopleBase: string;
  board: Board;
  person: IntakePerson;
  files: Partial<Record<IntakeSource, SourceRecord>>;
  position: { at: number; of: number } | null;
  onBack: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onSaved: (p: IntakePerson, advance: boolean) => void;
}) {
  const ms = files.myscout?.prepared;
  const cg = files.consent2go?.prepared;
  const now = person.roster;
  const values = (k: FieldKey): Record<Col, string | undefined> => ({
    myscout: ms ? String(ms.row[k] ?? '') : undefined,
    consent2go: cg ? (k === 'preferredName' ? undefined : String(cg.row[k] ?? '')) : undefined,
    now: now ? String(now[k] ?? '') : undefined,
  });
  const [pick, setPick] = useState<Record<FieldKey, Col | null>>(() => Object.fromEntries(FIELDS.map((f) => [f.key, defaultPick(f.key, values(f.key))])) as Record<FieldKey, Col | null>);
  const notes = { myscout: ms?.dietaryText ?? '', consent2go: cg?.dietaryText ?? '' };
  const existingDiet = now?.dietary as DietaryEntryInput[] | undefined;
  const nothingNoted = [notes.myscout, notes.consent2go].every((t) => !t.trim() || saysNothing(t));
  const [dietary, setDietary] = useState<DietaryEntryInput[] | undefined>(existingDiet ?? (nothingNoted ? [] : undefined));
  const [checks, setChecks] = useState<Record<string, boolean>>(person.check && person.state !== 'changed' ? person.check.checklist : {});
  const [busy, setBusy] = useState<'save' | 'leave' | 'undo' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();
  const loaded = !!(ms || cg);
  const health = cg?.row.extra ?? {};
  const allTicked = board.checklist.every((c) => checks[c.key]);

  async function save(leftOff: boolean) {
    setProblem(null);
    setBusy(leftOff ? 'leave' : 'save');
    try {
      let row: ImportRow | undefined;
      if (!leftOff) {
        if (!loaded && !now) throw new Error('Upload the files again to see what they say about this person.');
        const val = (k: FieldKey) => {
          const c = pick[k];
          return c ? (values(k)[c] ?? '') : '';
        };
        const section = (val('section') || 'Other') as ImportRow['section'];
        if (!(SECTIONS as readonly string[]).includes(section)) throw new Error('Choose a section.');
        const kind: ImportRow['kind'] = section === 'Leaders' ? 'adult' : section === 'Rovers' ? (ms?.row.kind ?? now?.kind ?? 'youth') : 'youth';
        const text = [notes.myscout, notes.consent2go].filter(Boolean).join('\n');
        const key = await hmacKey(board.fingerprintKey);
        const extra = Object.fromEntries(Object.entries(health).filter(([, v]) => v !== ''));
        row = {
          memberNumber: ms?.row.memberNumber ?? cg?.row.memberNumber ?? person.memberNumber,
          firstName: val('firstName'),
          preferredName: val('preferredName'),
          lastName: val('lastName'),
          kind,
          section,
          groupName: val('groupName'),
          position: ms?.row.position ?? now?.position ?? '',
          roleLabel: ms?.row.roleLabel ?? now?.roleLabel ?? '',
          team: ms?.row.team ?? now?.team ?? '',
          sourceStatus: ms?.row.sourceStatus ?? now?.sourceStatus ?? '',
          photoConsent: (val('photoConsent') || 'unknown') as ImportRow['photoConsent'],
          dietaryFingerprint: text ? await dietaryFingerprint(key, text) : null,
          ...(board.canEditDietary && dietary !== undefined ? { dietary } : {}),
          ...(Object.keys(extra).length ? { extra } : {}),
        };
        if (!row.firstName || !row.lastName) throw new Error('Choose a first and last name.');
      }
      const res = await api<{ person: IntakePerson }>(`/events/${eventId}/intake/check`, {
        body: { memberNumber: person.memberNumber, leftOff, checklist: checks, ...(row ? { row } : {}) },
      });
      toast(leftOff ? `${person.name} left off this camp` : allTicked ? `${person.name} checked` : `${person.name} saved, not finished`);
      onSaved(res.person, true);
    } catch (err) {
      setProblem(fail(err));
    } finally {
      setBusy(null);
    }
  }

  async function undo() {
    setBusy('undo');
    try {
      await api(`/events/${eventId}/intake/check/${encodeURIComponent(person.memberNumber)}`, { method: 'DELETE' });
      setChecks({});
      onSaved({ ...person, check: null, state: 'new', changed: [] }, false);
    } catch (err) {
      setProblem(fail(err));
    } finally {
      setBusy(null);
    }
  }

  const st = STATE_BADGE[person.state];
  return (
    <>
      <button type="button" className="back-link intake-back" onClick={onBack}>
        <Icon name="back" />
        Everyone
      </button>
      <PageHeader title={person.name} summary={[person.memberNumber, person.section, person.groupName].filter(Boolean).join(' · ')} />
      <div className="sections intake-card">
        <div className="intake-card-bar">
          <span className="intake-marks">
            <SourceMark label="MyScout" on={!!person.myscout} />
            <SourceMark label="Consent2Go" on={!!person.consent2go} />
            <Badge tone={st.tone}>{st.text}</Badge>
          </span>
          {position && (
            <span className="intake-nav">
              <Button small kind="ghost" disabled={!onPrev} onClick={onPrev}>
                <Icon name="back" /> Previous
              </Button>
              <span className="meta num">
                {position.at} of {position.of}
              </span>
              <Button small kind="ghost" disabled={!onNext} onClick={onNext}>
                Next <Icon name="chevron" />
              </Button>
            </span>
          )}
        </div>
        {person.check && (
          <p className="meta">
            {person.check.leftOff ? 'Left off this camp' : person.check.complete ? 'Checked' : 'Started'} {when(person.check.at)}
            {person.check.by ? ` by ${person.check.by}` : ''}.
          </p>
        )}
        {person.changed.length > 0 && (
          <Notice tone="warning" title="Changed since it was checked">
            <ul>
              {person.changed.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Notice>
        )}
        {!loaded && (
          <Notice title="Upload the files to see their details">
            <p>The files stay on the computer they were opened on, so this visit doesn’t have them. Upload them again on the Everyone page: anyone already checked is skipped.</p>
          </Notice>
        )}
        {problem && (
          <Notice tone="error">
            <p>{problem}</p>
          </Notice>
        )}

        <Section title="Details" id="details">
          <div className="table-wrap">
            <table className="table intake-compare">
              <thead>
                <tr>
                  <th scope="col">Detail</th>
                  {(['myscout', 'consent2go', 'now'] as Col[]).map((c) => (
                    <th key={c} scope="col">
                      {COL_NAME[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FIELDS.map((f) => {
                  const v = values(f.key);
                  // A blank (or photo consent not given) isn't a different answer, just a missing one.
                  const filled = (['myscout', 'consent2go', 'now'] as Col[]).filter((c) => v[c] !== undefined && v[c] !== '' && !(f.key === 'photoConsent' && v[c] === 'unknown'));
                  const distinct = new Set(filled.map((c) => v[c]!.trim().toLowerCase()));
                  const differs = distinct.size > 1;
                  return (
                    <tr key={f.key} className={differs ? 'is-diff' : undefined}>
                      <th scope="row">
                        {f.label}
                        {differs && <span className="intake-diff">Differs</span>}
                      </th>
                      {(['myscout', 'consent2go', 'now'] as Col[]).map((c) => (
                        <td key={c}>
                          {v[c] === undefined ? (
                            <span className="meta">{c === 'now' ? 'Not on the roster yet' : c === 'consent2go' && f.key === 'preferredName' ? 'Not asked' : `Not in ${COL_NAME[c]}`}</span>
                          ) : differs && filled.includes(c) ? (
                            <label className="intake-pick">
                              <input type="radio" name={`pick-${f.key}`} checked={pick[f.key] === c} onChange={() => setPick({ ...pick, [f.key]: c })} />
                              <span>{show(f.key, v[c]!) || <span className="meta">(blank)</span>}</span>
                            </label>
                          ) : (
                            show(f.key, v[c]!) || <span className="meta">(blank)</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="meta">Where they differ, tick the one to keep. MyScout is picked for who they are, and Consent2Go for photo consent, unless you change it.</p>
        </Section>

        <Section title="Dietary and medical notes" id="notes">
          <div className="intake-notes">
            <NoteBox title="MyScout" text={notes.myscout} present={!!ms} />
            <NoteBox title="Consent2Go" text={notes.consent2go} present={!!cg} />
          </div>
          {existingDiet && existingDiet.length > 0 && (
            <p className="meta">Recorded now: {existingDiet.map(describeEntry).join('; ')}</p>
          )}
          {board.dietaryEnabled && board.canEditDietary ? (
            <DietaryEditor value={dietary} onChange={setDietary} labelPrefix={person.name} />
          ) : (
            <p className="meta">{board.dietaryEnabled ? 'Someone who can edit dietary needs records these.' : 'Dietary needs are switched off for this camp.'}</p>
          )}
        </Section>

        <Section title="Health and activities (Consent2Go)" id="health">
          {!cg ? (
            <p className="meta">{person.consent2go ? 'Upload the Consent2Go file to see these.' : 'Not in Consent2Go yet.'}</p>
          ) : (
            <dl className="intake-dl">
              {['Swimming ability', 'Swimming comments', ...HEALTH_EXTRA_FIELDS].map((k) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{health[k] || <span className="meta">(blank)</span>}</dd>
                </div>
              ))}
            </dl>
          )}
        </Section>

        <Section title="Everything in the files" id="everything">
          <p className="meta">Every column, exactly as in each file, so nothing is missed. Only what’s above is saved.</p>
          <div className="intake-notes">
            {(['myscout', 'consent2go'] as const).map((s) => (
              <div key={s} className="intake-raw">
                <h3>{SOURCE_NAME[s]}</h3>
                {files[s] ? (
                  <>
                    <p className="meta">{files[s]!.where}</p>
                    <dl className="intake-dl">
                      {files[s]!.raw
                        .filter(([, v]) => v)
                        .map(([k, v], i) => (
                          <div key={`${k}-${i}`}>
                            <dt>{k}</dt>
                            <dd>{v}</dd>
                          </div>
                        ))}
                    </dl>
                    {files[s]!.raw.some(([, v]) => !v) && (
                      <p className="meta">
                        Blank: {files[s]!.raw.filter(([, v]) => !v).map(([k]) => k).join(', ')}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="meta">{person[s] ? `Upload the ${SOURCE_NAME[s]} file to see it.` : `Not in ${SOURCE_NAME[s]}.`}</p>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Checklist" id="checklist">
          <fieldset className="choices intake-checklist" disabled={!board.editable}>
            <legend className="visually-hidden">Checklist for {person.name}</legend>
            {board.checklist.map((c) => (
              <Choice key={c.key} label={c.label} checked={!!checks[c.key]} onChange={(e) => setChecks({ ...checks, [c.key]: e.target.checked })} />
            ))}
          </fieldset>
          {board.editable && (
            <div className="btn-row">
              <Button kind="primary" busy={busy === 'save'} busyLabel="Saving…" disabled={busy !== null} onClick={() => void save(false)}>
                {allTicked ? 'Checked' : 'Save for later'}
                {onNext ? ', next person' : ''}
              </Button>
              <Button kind="ghost" busy={busy === 'leave'} busyLabel="Saving…" disabled={busy !== null} onClick={() => void save(true)}>
                Leave off this camp
              </Button>
              {person.check && (
                <Button kind="ghost" busy={busy === 'undo'} busyLabel="Undoing…" disabled={busy !== null} onClick={() => void undo()}>
                  Undo check
                </Button>
              )}
            </div>
          )}
          {person.roster && (
            <p className="meta">
              <ButtonLink small kind="ghost" to={`${peopleBase}/${person.roster.registrationId}`}>
                Open their People page
              </ButtonLink>
            </p>
          )}
        </Section>
      </div>
    </>
  );
}

function NoteBox({ title, text, present }: { title: string; text: string; present: boolean }) {
  return (
    <div className="intake-note">
      <h3>{title}</h3>
      {!present ? <p className="meta">Not in {title} (or the file isn’t uploaded on this visit).</p> : text ? <p className="intake-note-text">{text}</p> : <p className="meta">No notes.</p>}
    </div>
  );
}
