import { useEffect, useMemo, useRef, useState } from 'react';
import type { IntakePerson, IntakeSource, IntakeState } from '../../shared/intake';
import { SOURCE_NAME, needsCheck } from '../../shared/intake';
import { csvCell } from '../../shared/csv';
import { suggestDietary } from '../../shared/dietarySuggest';
import { matchesSearch } from '../../shared/search';
import { saysNothing } from '../../shared/myscout';
import { SECTIONS } from '../../shared/sections';
import type { DietaryEntryInput, ImportRow } from '../../shared/schemas';
import { ApiFailure, api } from '../api';
import { DietaryEditor, describeEntry } from '../components/DietaryEditor';
import type { ReadFile, SourceRecord } from '../import/intakeFiles';
import { autoDetails, dietaryFingerprint, fingerprints, hmacKey, memberKey, readIntakeFile } from '../import/intakeFiles';
import { useApi } from '../useApi';
import { Badge, Button, ButtonLink, Choice, CountTile, EmptyState, Icon, LoadError, Loading, Notice, PageHeader, SearchField, Section, plural, useConfirm, useToast } from '../ui';
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

const FILTER_FILE: Record<Filter, string> = {
  todo: 'To check',
  all: 'Everyone',
  checked: 'Checked',
  both: 'Done both',
  myscout: 'No Consent2Go yet',
  consent2go: 'Not in MyScout',
  left_off: 'Left off camp',
  roster_only: 'In neither file',
};

function downloadCsv(filename: string, rows: string[][]) {
  const text = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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
  const confirm = useConfirm();
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
            fields: await fingerprints(key, r.source, rec.raw),
          })),
        );
        for (let i = 0; i < sent.length; i += 100) await api(`/events/${event.id}/intake/seen`, { body: { source: r.source, people: sent.slice(i, i + 100) } });
      }
      // People already on the roster: fill in names, photo consent and Consent2Go answers straight away.
      const onRoster = new Set(board.people.filter((p) => p.roster).map((p) => memberKey(p.memberNumber)));
      const touched = new Set(results.flatMap((r) => r.records.map((rec) => rec.key)));
      const sync = [...touched]
        .filter((k) => onRoster.has(k))
        .map((k) => {
          const f = next.get(k)!;
          const auto = autoDetails(f);
          return {
            memberNumber: (f.myscout ?? f.consent2go)!.prepared.row.memberNumber,
            ...(auto.namesFromMyScout && auto.names ? { names: auto.names } : {}),
            ...(auto.photoConsent ? { photoConsent: auto.photoConsent } : {}),
            ...(auto.extra ? { extra: auto.extra } : {}),
          };
        })
        .filter((x) => Object.keys(x).length > 1);
      for (let i = 0; i < sync.length; i += 200) await api(`/events/${event.id}/intake/sync`, { body: { people: sync.slice(i, i + 200) } });
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

  /** Forget files: on this screen, and the server's record of who was in them. */
  async function clear(which: IntakeSource | 'all') {
    const ok = await confirm(
      which === 'all'
        ? {
            title: 'Start over?',
            body: (
              <p>
                Forgets both uploads and every check, so the list is empty. People already added to the roster stay there; remove them on the People page if they
                shouldn’t be.
              </p>
            ),
            confirm: 'Start over',
            danger: true,
          }
        : {
            title: `Clear the ${SOURCE_NAME[which]} upload?`,
            body: <p>Forgets who was in the {SOURCE_NAME[which]} file. Checks and the roster stay as they are. Upload the right file to bring people back.</p>,
            confirm: 'Clear',
            danger: true,
          },
    );
    if (!ok) return;
    setBusy(true);
    try {
      await api(`/events/${event.id}/intake/uploads?source=${which}`, { method: 'DELETE' });
      const drop = (src: IntakeSource) => which === 'all' || which === src;
      setRead((prev) => prev.filter((r) => !drop(r.source)));
      setFiles((prev) => {
        const next: Files = new Map();
        for (const [k, v] of prev) {
          const kept = Object.fromEntries(Object.entries(v).filter(([src]) => !drop(src as IntakeSource)));
          if (Object.keys(kept).length) next.set(k, kept);
        }
        return next;
      });
      await reload();
      toast(which === 'all' ? 'Started over' : `${SOURCE_NAME[which]} upload cleared`);
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
      summary="Upload the MyScout export once, and Consent2Go as often as you like. Check each person’s section, Scout group and dietary needs; everything else fills in by itself. Anyone checked is skipped next time, unless their section, group or dietary notes change, or their Consent2Go arrives."
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
                    {board.lastUpload[s] && (
                      <span>
                        <Button small kind="ghost" disabled={busy} onClick={() => void clear(s)}>
                          Clear {SOURCE_NAME[s]} upload
                        </Button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {(board.lastUpload.myscout || board.lastUpload.consent2go) && (
              <div className="intake-clear">
                <Button small kind="ghost" disabled={busy} onClick={() => void clear('all')}>
                  Start over
                </Button>
                <span className="meta">Forgets both uploads and every check. The roster stays as it is.</span>
              </div>
            )}
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
            {tile('myscout', 'No Consent2Go yet', counts.myscout ? 'warning' : 'success')}
            {tile('both', 'Done both')}
            {counts.consent2go > 0 && tile('consent2go', 'Not in MyScout', 'warning')}
            {counts.left_off > 0 && tile('left_off', 'Left off camp')}
            {counts.roster_only > 0 && tile('roster_only', 'In neither file')}
            {tile('all', 'Everyone')}
          </div>
          <div className="intake-tools">
            <SearchField id="intake-q" label="Find a person" value={q} onChange={setQ} placeholder="Name, membership number or group" />
            {shown.length > 0 && (
              <Button
                kind="ghost"
                onClick={() =>
                  downloadCsv(`${FILTER_FILE[filter]}.csv`, [
                    ['Name', 'Membership number', 'Section', 'Scout group', 'MyScout', 'Consent2Go', 'Status'],
                    ...shown.map((p) => [p.name, p.memberNumber, p.section, p.groupName, p.myscout ? 'Yes' : 'No', p.consent2go ? 'Yes' : 'No', STATE_BADGE[p.state].text]),
                  ])
                }
              >
                <Icon name="download" /> Download this list
              </Button>
            )}
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

const PHOTO: Record<string, string> = { yes: 'Yes', no: 'No', unknown: 'Not given' };

/** Consent2Go's class and tab say section and Scout group; MyScout only shows someone's highest appointment. */
function autoSection(cg: SourceRecord['prepared']['row'] | undefined, ms: SourceRecord['prepared']['row'] | undefined, now: IntakePerson['roster']): string {
  if (cg && cg.section !== 'Other') return cg.section;
  return ms?.section ?? now?.section ?? cg?.section ?? 'Other';
}
function autoGroup(cg: SourceRecord['prepared']['row'] | undefined, ms: SourceRecord['prepared']['row'] | undefined, now: IntakePerson['roster']): string {
  return cg?.groupName || ms?.groupName || now?.groupName || '';
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
  const loaded = !!(ms || cg);
  const auto = autoDetails(files);
  const recheck = person.state === 'changed';
  // Once checked, what's on the roster is what was chosen: start from it unless something changed.
  const [section, setSection] = useState(() => (now && person.check && !recheck ? now.section : autoSection(cg?.row, ms?.row, now)));
  const [group, setGroup] = useState(() => (now && person.check && !recheck ? now.groupName : autoGroup(cg?.row, ms?.row, now)));
  const notes = { myscout: ms?.dietaryText ?? '', consent2go: cg?.dietaryText ?? '' };
  const existingDiet = now?.dietary as DietaryEntryInput[] | undefined;
  const nothingNoted = [notes.myscout, notes.consent2go].every((t) => !t.trim() || saysNothing(t));
  const suggested = useMemo(() => suggestDietary(notes.myscout, notes.consent2go), [notes.myscout, notes.consent2go]);
  const [dietary, setDietary] = useState<DietaryEntryInput[] | undefined>(() => {
    if (existingDiet && existingDiet.length && !recheck) return existingDiet;
    if (nothingNoted) return existingDiet ?? [];
    // Suggestions from the notes, plus anything already recorded.
    const merged = [...(existingDiet ?? [])];
    for (const e of suggested) if (!merged.some((x) => x.category === e.category && x.item.toLowerCase() === e.item.toLowerCase())) merged.push(e);
    return merged.length ? merged : undefined;
  });
  const fromNotes = !nothingNoted && suggested.length > 0 && !(existingDiet && existingDiet.length && !recheck);
  const [checks, setChecks] = useState<Record<string, boolean>>(person.check && !recheck ? person.check.checklist : {});
  const [busy, setBusy] = useState<'save' | 'leave' | 'undo' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();
  const allTicked = board.checklist.every((c) => checks[c.key]);

  const sources = (pick: (r: SourceRecord['prepared']['row']) => string, cgLabel: string) =>
    [
      ms && { label: 'MyScout', value: pick(ms.row) },
      cg && { label: cgLabel, value: pick(cg.row) === 'Other' ? '' : pick(cg.row) },
      now && { label: 'CampCount now', value: pick(now as unknown as SourceRecord['prepared']['row']) },
    ].filter((x): x is { label: string; value: string } => !!x);

  async function save(leftOff: boolean) {
    setProblem(null);
    setBusy(leftOff ? 'leave' : 'save');
    try {
      let row: ImportRow | undefined;
      if (!leftOff) {
        if (!loaded && !now) throw new Error('Upload the files again to see what they say about this person.');
        if (!(SECTIONS as readonly string[]).includes(section)) throw new Error('Choose a section.');
        const names = auto.names ?? (now ? { firstName: now.firstName, preferredName: now.preferredName, lastName: now.lastName } : undefined);
        if (!names?.firstName || !names.lastName) throw new Error('This person has no name in either file.');
        const sec = section as ImportRow['section'];
        const kind: ImportRow['kind'] = sec === 'Leaders' ? 'adult' : sec === 'Rovers' ? (ms?.row.kind ?? now?.kind ?? 'youth') : 'youth';
        const text = [notes.myscout, notes.consent2go].filter(Boolean).join('\n');
        const key = await hmacKey(board.fingerprintKey);
        row = {
          memberNumber: ms?.row.memberNumber ?? cg?.row.memberNumber ?? person.memberNumber,
          ...names,
          kind,
          section: sec,
          groupName: group.trim().slice(0, 120),
          position: ms?.row.position ?? now?.position ?? '',
          roleLabel: ms?.row.roleLabel ?? now?.roleLabel ?? '',
          team: ms?.row.team ?? now?.team ?? '',
          sourceStatus: ms?.row.sourceStatus ?? now?.sourceStatus ?? '',
          photoConsent: auto.photoConsent ?? ((now?.photoConsent as ImportRow['photoConsent']) || 'unknown'),
          dietaryFingerprint: text ? await dietaryFingerprint(key, text) : null,
          ...(board.canEditDietary && dietary !== undefined ? { dietary } : {}),
          ...(auto.extra ? { extra: auto.extra } : {}),
        };
      }
      const res = await api<{ person: IntakePerson }>(`/events/${eventId}/intake/check`, {
        body: { memberNumber: person.memberNumber, leftOff, checklist: checks, ...(row ? { row } : {}) },
      });
      toast(leftOff ? `${person.name} left off this camp` : allTicked ? `${person.name} checked and on the roster` : `${person.name} saved for later`);
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

  const tick = (k: string) => (
    <div className="intake-tick">
      <Choice label={board.checklist.find((c) => c.key === k)?.label ?? k} checked={!!checks[k]} onChange={(e) => setChecks({ ...checks, [k]: e.target.checked })} disabled={!board.editable} />
    </div>
  );
  const st = STATE_BADGE[person.state];
  return (
    <>
      <button type="button" className="back-link intake-back" onClick={onBack}>
        <Icon name="back" />
        Everyone
      </button>
      <PageHeader title={person.name} summary={[person.memberNumber, auto.photoConsent ? `Photos: ${PHOTO[auto.photoConsent]}` : now?.photoConsent ? `Photos: ${PHOTO[now.photoConsent] ?? ''}` : null].filter(Boolean).join(' · ')} />
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
        {person.check && !recheck && (
          <p className="meta">
            {person.check.leftOff ? 'Left off this camp' : person.check.complete ? 'Checked' : 'Started'} {when(person.check.at)}
            {person.check.by ? ` by ${person.check.by}` : ''}.
          </p>
        )}
        {person.changed.length > 0 && (
          <Notice tone="warning" title="Look again: this changed since it was checked">
            <ul>
              {person.changed.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Notice>
        )}
        {!loaded && (
          <Notice title="Upload the files to see their details">
            <p>The files stay on the computer they were opened on. Upload them again on the Everyone page: anyone already checked is skipped.</p>
          </Notice>
        )}
        {problem && (
          <Notice tone="error">
            <p>{problem}</p>
          </Notice>
        )}

        <Section title="Section" id="section">
          <div className="intake-field">
            <select className="select" aria-label="Section" value={section} onChange={(e) => setSection(e.target.value)} disabled={!board.editable}>
              {SECTIONS.map((x) => (
                <option key={x} value={x}>
                  {x === 'Leaders' ? 'Leaders (adults)' : x}
                </option>
              ))}
            </select>
            <SourceHints items={sources((r) => r.section, `Consent2Go class${cg ? '' : ''}`)} current={section} onPick={setSection} />
            {tick('section')}
          </div>
        </Section>

        <Section title="Scout group" id="group">
          <div className="intake-field">
            <input className="input" aria-label="Scout group" value={group} maxLength={120} onChange={(e) => setGroup(e.target.value)} disabled={!board.editable} />
            <SourceHints items={sources((r) => r.groupName, 'Consent2Go tab')} current={group} onPick={setGroup} />
            {tick('group')}
          </div>
        </Section>

        <Section title="Dietary needs" id="dietary">
          <div className="intake-notes">
            <NoteBox title="MyScout" text={notes.myscout} present={!!ms} />
            <NoteBox title="Consent2Go" text={notes.consent2go} present={!!cg} missing={person.consent2go ? undefined : 'Not done Consent2Go yet.'} />
          </div>
          {fromNotes && <p className="meta">Filled in from the notes. Check each one, and add anything missed.</p>}
          {board.dietaryEnabled && board.canEditDietary ? (
            <DietaryEditor value={dietary} onChange={setDietary} labelPrefix={person.name} />
          ) : (
            <p className="meta">{board.dietaryEnabled ? 'Someone who can edit dietary needs records these.' : 'Dietary needs are switched off for this camp.'}</p>
          )}
          {existingDiet && existingDiet.length > 0 && recheck && <p className="meta">Recorded before: {existingDiet.map(describeEntry).join('; ')}</p>}
          {tick('dietary')}
        </Section>

        {board.editable && (
          <div className="btn-row intake-save">
            <Button kind="primary" busy={busy === 'save'} busyLabel="Saving…" disabled={busy !== null} onClick={() => void save(false)}>
              {allTicked ? 'Checked: add to roster' : 'Save for later'}
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
      </div>
    </>
  );
}

/** What each file says, as buttons that fill the box in. */
function SourceHints({ items, current, onPick }: { items: { label: string; value: string }[]; current: string; onPick: (v: string) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="intake-hints">
      {items.map((i) => (
        <li key={i.label}>
          <span className="meta">{i.label}:</span>{' '}
          {i.value ? (
            <button type="button" className={i.value.trim().toLowerCase() === current.trim().toLowerCase() ? 'intake-hint is-picked' : 'intake-hint'} onClick={() => onPick(i.value)}>
              {i.value}
            </button>
          ) : (
            <span className="meta">(blank)</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function NoteBox({ title, text, present, missing }: { title: string; text: string; present: boolean; missing?: string }) {
  return (
    <div className="intake-note">
      <h3>{title}</h3>
      {!present ? <p className="meta">{missing ?? 'Upload the file to see these notes.'}</p> : text ? <p className="intake-note-text">{text}</p> : <p className="meta">No notes.</p>}
    </div>
  );
}
