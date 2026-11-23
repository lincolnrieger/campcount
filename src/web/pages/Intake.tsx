import { useEffect, useMemo, useState } from 'react';
import { csvCell } from '../../shared/csv';
import { suggestDietary } from '../../shared/dietarySuggest';
import type { Linked, RosterPerson, Section as SectionName } from '../../shared/localIntake';
import {
  autoSection,
  buildRow,
  detailChanges,
  dietaryIsDone,
  dietaryNotes,
  dietarySignature,
  displayName,
  hasDietaryNotes,
  linkPeople,
  memberKey,
  mergeChanges,
  needsSection,
  newDietarySources,
} from '../../shared/localIntake';
import type { DietaryEntryInput, ImportRow } from '../../shared/schemas';
import { ApiFailure, api } from '../api';
import { DietaryEditor } from '../components/DietaryEditor';
import type { LocalImport, ReadFile, Source } from '../import/intakeFiles';
import { SOURCE_NAME, clearLocal, emptyLocal, loadLocal, readIntakeFile, saveLocal } from '../import/intakeFiles';
import { useApi } from '../useApi';
import { Badge, Button, CountTile, EmptyState, Icon, LoadError, Loading, Notice, PageHeader, Section, plural, useConfirm, useToast } from '../ui';
import { useEvent } from './EventLayout';

interface Registration {
  id: string;
  memberNumber: string;
  firstName: string;
  preferredName: string;
  lastName: string;
  section: string;
  groupName: string;
  position: string;
  status: string;
  dietary?: DietaryEntryInput[];
}

const fail = (err: unknown) => (err instanceof ApiFailure || err instanceof Error ? err.message : 'No connection. Check your signal and try again.');
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

function downloadCsv(filename: string, rows: string[][]) {
  const text = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * People › Import & check. Upload the MyScout and Consent2Go exports (as
 * often as you like). Everyone goes onto the roster straight away; sections
 * come from the MyScout position, and anyone whose position isn't a plain
 * section gets one chosen here. Dietary notes from both files are then read
 * one person at a time. The files, and what's been done, stay in this
 * browser only: nothing about them is kept on the server.
 */
export function Intake() {
  const { event, base } = useEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const context = useApi<{ dietaryEnabled: boolean; canEditDietary: boolean }>(`/events/${event.id}/import/context`);
  const registrations = useApi<{ registrations: Registration[] }>(`/events/${event.id}/registrations`);
  const [local, setLocalState] = useState<LocalImport | null>(null);
  useEffect(() => {
    let live = true;
    void loadLocal(event.id).then((l) => live && setLocalState(l));
    return () => {
      live = false;
    };
  }, [event.id]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  /** People put off for now (this visit only): they go to the back of the dietary queue. */
  const [later, setLater] = useState<string[]>([]);
  const update = (fn: (l: LocalImport) => LocalImport) =>
    setLocalState((prev) => {
      const next = fn(prev ?? emptyLocal());
      saveLocal(event.id, next);
      return next;
    });

  const regs = useMemo(() => registrations.data?.registrations ?? [], [registrations.data]);
  const roster: RosterPerson[] = useMemo(
    () =>
      regs.map((r) => ({
        id: r.id,
        memberNumber: r.memberNumber,
        firstName: r.firstName,
        preferredName: r.preferredName,
        lastName: r.lastName,
        section: r.section,
        groupName: r.groupName,
        position: r.position,
        status: r.status,
      })),
    [regs],
  );
  const files = local?.files;
  const { people, unmatched } = useMemo(() => linkPeople(files?.myscout?.people ?? [], files?.consent2go?.people ?? [], roster), [files, roster]);
  const regByKey = useMemo(() => new Map(regs.map((r) => [memberKey(r.memberNumber), r])), [regs]);

  async function sendToRoster(files: LocalImport['files'], chosen: LocalImport['chosen']) {
    const { people: linked } = linkPeople(files.myscout?.people ?? [], files.consent2go?.people ?? [], roster);
    const rows = linked.map((p) => buildRow(p, chosen[p.key] as SectionName | undefined)).filter((r): r is ImportRow => r !== null);
    const totals = { create: 0, update: 0, unchanged: 0 };
    for (let i = 0; i < rows.length; i += 1000) {
      const res = await api<{ counts: typeof totals }>(`/events/${event.id}/import/commit`, {
        body: {
          rows: rows.slice(i, i + 1000),
          withdrawMissing: false,
          sourceLabel: 'Import & check',
          source: 'myscout',
        },
      });
      totals.create += res.counts.create;
      totals.update += res.counts.update;
      totals.unchanged += res.counts.unchanged;
    }
    return totals;
  }

  async function upload(list: FileList) {
    setProblem(null);
    setSummary(null);
    setBusy(true);
    try {
      const results: ReadFile[] = [];
      for (const f of [...list]) results.push(await readIntakeFile(f));
      const old = local ?? emptyLocal();
      const next = { ...old.files };
      for (const r of results)
        next[r.source] = {
          fileName: r.fileName,
          at: new Date().toISOString(),
          people: r.people,
          problems: r.problems,
        };
      const at = new Date().toISOString();
      const before = linkPeople(old.files.myscout?.people ?? [], old.files.consent2go?.people ?? [], roster).people;
      const after = linkPeople(next.myscout?.people ?? [], next.consent2go?.people ?? [], roster).people;

      // What's different from the last upload of each file, for review (merged with anything not looked at yet).
      const beforeByKey = new Map(before.map((p) => [p.key, p]));
      const changes = { ...(old.changes ?? {}) };
      let changed = 0;
      for (const p of after) {
        const b = beforeByKey.get(p.key);
        const items = b ? detailChanges(b, p) : [];
        if (!items.length) continue;
        const merged = mergeChanges(changes[p.key]?.items ?? [], items);
        if (merged.length) {
          changes[p.key] = { name: displayName(p), memberNumber: p.memberNumber, at, items: merged };
          changed++;
        } else delete changes[p.key];
      }

      const totals = await sendToRoster(next, old.chosen);

      // Anyone who was in a file before, but is in neither now, comes off the roster (and onto the removed list).
      const seen = new Set([...(old.seen ?? []), ...before.map((p) => p.key), ...after.map((p) => p.key)]);
      const inFiles = new Set(after.map((p) => p.key));
      const keep = new Set(old.keep ?? []);
      const fresh = (await api<{ registrations: Registration[] }>(`/events/${event.id}/registrations`)).registrations;
      const active = fresh.filter((r) => r.status === 'active');
      let gone = active.filter((r) => {
        const k = memberKey(r.memberNumber);
        return seen.has(k) && !inFiles.has(k) && !keep.has(k);
      });
      // A lot at once usually means the wrong file: check first.
      if (gone.length > 10 && gone.length > active.length * 0.1) {
        const ok = await confirm({
          title: `Take ${gone.length} people off the roster?`,
          body: <p>They were in an earlier upload but aren’t in either file now. If this is the wrong file, cancel (nobody is taken off) and upload the right one.</p>,
          confirm: 'Take them off',
          danger: true,
        });
        if (!ok) gone = [];
      }
      const removed = { ...(old.removed ?? {}) };
      for (const k of Object.keys(removed)) if (inFiles.has(k)) delete removed[k]; // back in a file: back on the roster
      for (const r of gone) {
        await api(`/events/${event.id}/registrations/${r.id}`, { method: 'PATCH', body: { status: 'withdrawn' } });
        removed[memberKey(r.memberNumber)] = {
          name: `${r.preferredName || r.firstName} ${r.lastName}`.trim(),
          memberNumber: r.memberNumber,
          registrationId: r.id,
          at,
        };
      }

      update((l) => ({ ...l, files: next, changes, seen: [...seen], removed }));
      await registrations.reload();
      setSummary(
        [
          `${results.map((r) => `${SOURCE_NAME[r.source]}: ${plural(r.people.length, 'person', 'people')}`).join(' · ')}.`,
          `${totals.create} added, ${totals.unchanged + totals.update} already on the roster.`,
          changed ? `${plural(changed, 'person has', 'people have')} changed details to review.` : '',
          gone.length ? `${plural(gone.length, 'person', 'people')} taken off (in neither file now).` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
    } catch (err) {
      setProblem(fail(err));
    } finally {
      setBusy(false);
    }
  }

  async function putBack(key: string) {
    const r = local?.removed?.[key];
    if (!r) return;
    try {
      await api(`/events/${event.id}/registrations/${r.registrationId}`, { method: 'PATCH', body: { status: 'active' } });
      update((l) => {
        const removed = { ...(l.removed ?? {}) };
        delete removed[key];
        return { ...l, removed, keep: [...new Set([...(l.keep ?? []), key])] };
      });
      await registrations.reload();
      toast(`${r.name} is back on the roster`);
    } catch (err) {
      toast(fail(err), { tone: 'error' });
    }
  }

  const reviewed = (keys: string[]) =>
    update((l) => {
      const changes = { ...(l.changes ?? {}) };
      for (const k of keys) delete changes[k];
      return { ...l, changes };
    });

  async function chooseSection(p: Linked, section: SectionName) {
    const reg = regByKey.get(p.key);
    if (!reg) return;
    try {
      await api(`/events/${event.id}/registrations/${reg.id}`, {
        method: 'PATCH',
        body: { section },
      });
      update((l) => ({ ...l, chosen: { ...l.chosen, [p.key]: section } }));
      await registrations.reload();
      toast(`${displayName(p)}: ${section}`);
    } catch (err) {
      toast(fail(err), { tone: 'error' });
    }
  }

  async function forget() {
    const ok = await confirm({
      title: 'Clear from this computer?',
      body: <p>Forgets the uploaded files, the sections you chose and which dietary notes you’ve done, on this computer. The roster stays as it is.</p>,
      confirm: 'Clear',
      danger: true,
    });
    if (!ok) return;
    await clearLocal(event.id);
    setLocalState(emptyLocal());
    setSummary(null);
  }

  const header = (
    <PageHeader
      title="Import & check"
      back={{ to: `${base}/people`, label: 'People' }}
      summary="Upload the MyScout and Consent2Go exports as often as you like. New people go onto the roster; people already checked are skipped. Anything that changed since the last upload is listed to check, and anyone in neither file is taken off. The files stay on this computer."
      menu={[
        {
          label: 'Import with column matching',
          to: `${base}/people/import/columns`,
        },
      ]}
    />
  );
  if (!local || (context.loading && !context.data) || (registrations.loading && !registrations.data))
    return (
      <>
        {header}
        <Loading what="the import" rows={6} />
      </>
    );
  const loadError = context.error ?? registrations.error;
  if (loadError)
    return (
      <>
        {header}
        <LoadError
          error={loadError}
          onRetry={() => {
            void context.reload();
            void registrations.reload();
          }}
          what="the import"
        />
      </>
    );

  const sectionNames = event.sections.map((x) => x.name);
  const onRoster = (p: Linked) => regByKey.has(p.key);
  const chosenMap = local.chosen as Record<string, SectionName>;
  const toChoose = people.filter((p) => onRoster(p) && needsSection(p, chosenMap));
  const chosen = people.filter((p) => onRoster(p) && autoSection(p) === null && chosenMap[p.key]);
  const dietaryTodo = people
    .filter((p) => onRoster(p) && hasDietaryNotes(p) && !dietaryIsDone(p, local.dietaryDone[p.key]))
    .sort((a, b) => later.indexOf(a.key) - later.indexOf(b.key));
  const dietaryDone = people.filter((p) => onRoster(p) && hasDietaryNotes(p) && dietaryIsDone(p, local.dietaryDone[p.key]));
  const changes = Object.entries(local.changes ?? {}).sort(([, a], [, b]) => a.name.localeCompare(b.name));
  // Only people still off the roster.
  const removed = Object.entries(local.removed ?? {})
    .filter(([k]) => regByKey.get(k)?.status !== 'active')
    .sort(([, a], [, b]) => a.name.localeCompare(b.name));
  const noC2G = people.filter((p) => p.ms && !p.cg);
  const notInMyScout = people.filter((p) => !p.ms && p.cg);
  const nameMatched = people.filter((p) => p.ms && p.link === 'name');
  const problems = (['myscout', 'consent2go'] as const).flatMap((s) => (local.files[s]?.problems ?? []).map((pr) => ({ source: s, ...pr })));
  const anyFile = !!(local.files.myscout || local.files.consent2go);
  const current = dietaryTodo[0];
  const canDiet = !!(context.data?.dietaryEnabled && context.data.canEditDietary);

  return (
    <>
      {header}
      <div className="sections intake">
        {problem && (
          <Notice tone="error" title="That file couldn’t be used">
            <p>{problem}</p>
          </Notice>
        )}
        {summary && (
          <Notice tone="success">
            <p>{summary}</p>
          </Notice>
        )}

        <Section title="Upload" id="upload">
          <label className="dropzone">
            <Icon name="download" size={24} />
            <strong>{busy ? 'Reading and updating the roster…' : 'Choose the MyScout and Consent2Go files'}</strong>
            <span className="meta">One or both. Each is recognised by its columns, and read on this computer.</span>
            <input
              type="file"
              multiple
              accept=".xlsx,.csv,.tsv,.txt,text/csv"
              disabled={busy}
              onChange={(e) => e.target.files?.length && void upload(e.target.files)}
            />
          </label>
          <ul className="intake-sources">
            {(['myscout', 'consent2go'] as Source[]).map((s) => {
              const f = local.files[s];
              return (
                <li key={s}>
                  <strong>{SOURCE_NAME[s]}</strong>
                  <span className="meta">
                    {f ? `${f.fileName}: ${plural(f.people.length, 'person', 'people')} · uploaded ${when(f.at)}` : 'Not uploaded on this computer yet'}
                  </span>
                </li>
              );
            })}
          </ul>
          {anyFile && (
            <div className="intake-clear">
              <Button small kind="ghost" onClick={() => void forget()}>
                Clear from this computer
              </Button>
              <span className="meta">The files are kept in this browser only, so you can come back to them.</span>
            </div>
          )}
          {problems.length > 0 && (
            <Notice tone="warning" title="Rows that couldn’t be read">
              <ul>
                {problems.map((p, i) => (
                  <li key={i}>
                    {SOURCE_NAME[p.source]}, {p.where}: {p.errors.join('; ')}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
        </Section>

        {!anyFile ? (
          <EmptyState title="Nothing uploaded yet">Choose the MyScout export, the Consent2Go export, or both.</EmptyState>
        ) : (
          <>
            <div className="tiles intake-tiles">
              <CountTile value={canDiet ? dietaryTodo.length : '–'} label="Dietary to read" tone={canDiet && dietaryTodo.length ? 'warning' : 'success'} />
              <CountTile value={toChoose.length} label="Section to choose" tone={toChoose.length ? 'warning' : 'success'} />
              <CountTile value={changes.length} label="Changed details" tone={changes.length ? 'warning' : 'success'} />
              <CountTile value={removed.length} label="Taken off" />
              <CountTile value={local.files.consent2go ? noC2G.length : '–'} label="No Consent2Go yet" />
              <CountTile value={people.length} label="Everyone in the files" />
            </div>

            <Section title="Dietary notes" id="dietary">
              {!context.data?.dietaryEnabled ? (
                <p className="meta">Dietary needs are switched off for this camp (Settings › Event details).</p>
              ) : !context.data.canEditDietary ? (
                <p className="meta">Someone who can edit dietary needs reads these.</p>
              ) : !current ? (
                <p className="meta">
                  {dietaryDone.length === 1 ? 'The 1 person with dietary notes is done.' : dietaryDone.length ? `All ${dietaryDone.length} people with dietary notes are done.` : 'No one has dietary notes.'} New
                  or changed notes show here after each upload.
                </p>
              ) : (
                <DietaryReview
                  key={current.key}
                  eventId={event.id}
                  person={current}
                  reg={regByKey.get(current.key)!}
                  fresh={newDietarySources(current, local.dietaryDone[current.key])}
                  left={dietaryTodo.length}
                  onDone={async (p) => {
                    update((l) => ({
                      ...l,
                      dietaryDone: {
                        ...l.dietaryDone,
                        [p.key]: dietarySignature(p),
                      },
                    }));
                    await registrations.reload();
                  }}
                  onLater={dietaryTodo.length > 1 ? (p) => setLater((l) => [...l.filter((k) => k !== p.key), p.key]) : undefined}
                />
              )}
            </Section>

            {changes.length > 0 && (
              <Section title={`Changed since the last upload (${changes.length})`} id="changes">
                <p className="meta">The roster has been updated to match. Check these look right.</p>
                <div>
                  <Button small kind="ghost" onClick={() => reviewed(changes.map(([k]) => k))}>
                    Mark all as checked
                  </Button>
                </div>
                <ul className="list">
                  {changes.map(([k, c]) => (
                    <li key={k} className="row intake-change">
                      <span className="row-main">
                        <span className="row-title">{c.name}</span>
                        <span className="row-meta">{c.memberNumber}</span>
                        <ul className="intake-change-items">
                          {c.items.map((i) => (
                            <li key={i.label}>
                              <span className="meta">{i.label}:</span> <s>{i.before}</s> → <strong>{i.after}</strong>
                            </li>
                          ))}
                        </ul>
                      </span>
                      <span className="row-side">
                        <Button small onClick={() => reviewed([k])}>
                          Checked
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {removed.length > 0 && (
              <Section title={`Taken off the roster (${removed.length})`} id="removed">
                <p className="meta">They were in an earlier upload but aren’t in MyScout or Consent2Go any more. Put someone back if that’s a mistake; they won’t be taken off again.</p>
                <div>
                  <Button
                    small
                    kind="ghost"
                    onClick={() =>
                      downloadCsv('Taken off the roster.csv', [['Name', 'Membership number', 'Taken off'], ...removed.map(([, r]) => [r.name, r.memberNumber, when(r.at)])])
                    }
                  >
                    <Icon name="download" /> Download the list
                  </Button>
                </div>
                <ul className="list">
                  {removed.map(([k, r]) => (
                    <li key={k} className="row">
                      <span className="row-main">
                        <span className="row-title">{r.name}</span>
                        <span className="row-meta">
                          {r.memberNumber} · taken off {when(r.at)}
                        </span>
                      </span>
                      <span className="row-side">
                        <Button small kind="ghost" onClick={() => void putBack(k)}>
                          Put back
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title={`Choose a section${toChoose.length ? ` (${toChoose.length})` : ''}`} id="sections">
              <p className="meta">
                Joeys, Cubs, Scouts, Venturers, Rovers and Adult Helpers get their section from their MyScout position. Choose one for everyone else. Their
                MyScout position stays on their profile.
              </p>
              {toChoose.length === 0 ? (
                <p className="meta">Nothing to choose.</p>
              ) : (
                <ul className="list">
                  {toChoose.map((p) => (
                    <SectionRow key={p.key} person={p} options={sectionNames} current="" onChoose={(s) => void chooseSection(p, s)} />
                  ))}
                </ul>
              )}
              {chosen.length > 0 && (
                <details className="intake-more">
                  <summary>Chosen already ({chosen.length})</summary>
                  <ul className="list">
                    {chosen.map((p) => (
                      <SectionRow key={p.key} person={p} options={sectionNames} current={chosenMap[p.key] ?? ''} onChoose={(s) => void chooseSection(p, s)} />
                    ))}
                  </ul>
                </details>
              )}
            </Section>

            <Section title="No Consent2Go yet" id="noc2g">
              {!local.files.consent2go ? (
                <p className="meta">Upload the Consent2Go export to see who hasn’t done it.</p>
              ) : noC2G.length === 0 ? (
                <p className="meta">Everyone in MyScout has done Consent2Go.</p>
              ) : (
                <>
                  <div>
                    <Button
                      small
                      kind="ghost"
                      onClick={() =>
                        downloadCsv('No Consent2Go yet.csv', [
                          ['Name', 'Membership number', 'Position', 'Group'],
                          ...noC2G.map((p) => [displayName(p), p.memberNumber, p.ms?.position ?? '', p.ms?.groupName ?? '']),
                        ])
                      }
                    >
                      <Icon name="download" /> Download the list ({noC2G.length})
                    </Button>
                  </div>
                  <details className="intake-more">
                    <summary>Show names ({noC2G.length})</summary>
                    <ul className="list">
                      {noC2G.map((p) => (
                        <li key={p.key} className="row">
                          <span className="row-main">
                            <span className="row-title">{displayName(p)}</span>
                            <span className="row-meta">{[p.memberNumber, p.ms?.position, p.ms?.groupName].filter(Boolean).join(' · ')}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              )}
            </Section>

            {(notInMyScout.length > 0 || unmatched.length > 0 || nameMatched.length > 0) && (
              <Section title="Matching Consent2Go to MyScout" id="matching">
                {nameMatched.length > 0 && (
                  <>
                    <h3 className="intake-subhead">Matched by name ({nameMatched.length})</h3>
                    <p className="meta">Their Consent2Go Student ID didn’t match a MyScout membership number, but their name did.</p>
                    <ul className="list">
                      {nameMatched.map((p) => (
                        <li key={p.key} className="row">
                          <span className="row-main">
                            <span className="row-title">{displayName(p)}</span>
                            <span className="row-meta">
                              MyScout {p.memberNumber} · Consent2Go Student ID {p.cg?.memberNumber || '(blank)'} · {p.cg?.where}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {notInMyScout.length > 0 && (
                  <>
                    <h3 className="intake-subhead">In Consent2Go but not MyScout ({notInMyScout.length})</h3>
                    <p className="meta">Added to the roster from Consent2Go. Check they’ve registered.</p>
                    <ul className="list">
                      {notInMyScout.map((p) => (
                        <li key={p.key} className="row">
                          <span className="row-main">
                            <span className="row-title">{displayName(p)}</span>
                            <span className="row-meta">{[p.memberNumber, p.cg?.where].filter(Boolean).join(' · ')}</span>
                          </span>
                          {p.link === 'name' && <Badge>Matched to the roster by name</Badge>}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {unmatched.length > 0 && (
                  <>
                    <h3 className="intake-subhead">Couldn’t be matched ({unmatched.length})</h3>
                    <p className="meta">No usable Student ID, and no one in MyScout or on the roster with this name. Not added.</p>
                    <ul className="list">
                      {unmatched.map((c, i) => (
                        <li key={i} className="row">
                          <span className="row-main">
                            <span className="row-title">
                              {c.firstName} {c.lastName}
                            </span>
                            <span className="row-meta">{c.where}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Section>
            )}
          </>
        )}
      </div>
    </>
  );
}

function SectionRow({ person, options, current, onChoose }: { person: Linked; options: string[]; current: string; onChoose: (s: SectionName) => void }) {
  const id = `section-${person.key}`;
  return (
    <li className="row intake-section-row">
      <span className="row-main">
        <label htmlFor={id} className="row-title">
          {displayName(person)}
        </label>
        <span className="row-meta">
          {[
            person.memberNumber,
            person.ms?.position ? `MyScout position: ${person.ms.position}` : 'No MyScout position',
            person.cg?.groupName || person.ms?.groupName,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      <select id={id} className="select intake-section-select" value={current} onChange={(e) => e.target.value && onChoose(e.target.value as SectionName)}>
        {!current && <option value="">Choose…</option>}
        {(current && !options.includes(current) ? [current, ...options] : options).map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </li>
  );
}

/** One person's dietary notes from both files, side by side, and what to record. */
function DietaryReview({
  eventId,
  person,
  reg,
  fresh,
  left,
  onDone,
  onLater,
}: {
  eventId: string;
  person: Linked;
  reg: Registration;
  /** Notes that are new since this person was last done. */
  fresh: ('myscout' | 'consent2go')[];
  left: number;
  onDone: (p: Linked) => Promise<void>;
  onLater?: (p: Linked) => void;
}) {
  const notes = dietaryNotes(person);
  const [entries, setEntries] = useState<DietaryEntryInput[] | undefined>(() => {
    const merged = [...(reg.dietary ?? [])];
    for (const e of suggestDietary(notes.myscout, notes.consent2go))
      if (!merged.some((x) => x.category === e.category && x.item.toLowerCase() === e.item.toLowerCase())) merged.push(e);
    return merged.length ? merged : undefined;
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const toast = useToast();

  async function save() {
    if (entries === undefined) return setProblem('Add what they need, or choose “No dietary needs”.');
    setBusy(true);
    setProblem(null);
    try {
      await api(`/events/${eventId}/registrations/${reg.id}/dietary`, {
        method: 'PUT',
        body: { entries },
      });
      toast(`${displayName(person)} done`);
      await onDone(person);
    } catch (err) {
      setProblem(fail(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="intake-diet">
      <div className="intake-diet-head">
        <h3>{displayName(person)}</h3>
        <span className="meta">
          {[person.memberNumber, reg.section].filter(Boolean).join(' · ')} · {plural(left, 'person', 'people')} to go
        </span>
      </div>
      <div className="intake-notes">
        <div className="intake-note">
          <h4>MyScout {fresh.includes('myscout') && <Badge tone="warning">New</Badge>}</h4>
          {!person.ms ? (
            <p className="meta">Not in MyScout.</p>
          ) : notes.myscout ? (
            <p className="intake-note-text">{notes.myscout}</p>
          ) : (
            <p className="meta">Nothing written.</p>
          )}
        </div>
        <div className="intake-note">
          <h4>Consent2Go {fresh.includes('consent2go') && <Badge tone="warning">New</Badge>}</h4>
          {!person.cg ? (
            <p className="meta">Not done Consent2Go yet.</p>
          ) : notes.consent2go ? (
            <p className="intake-note-text">{notes.consent2go}</p>
          ) : (
            <p className="meta">Nothing written.</p>
          )}
        </div>
      </div>
      {fresh.length > 0 && (reg.dietary ?? []).length > 0 && (
        <p className="meta">Done before. Back because {fresh.map((f) => (f === 'myscout' ? 'MyScout' : 'Consent2Go')).join(' and ')} has something new. What’s already recorded is below: add anything the new note says.</p>
      )}
      {entries && entries.length > 0 && !(reg.dietary ?? []).length && <p className="meta">Filled in from the notes. Check them against what’s written.</p>}
      {problem && (
        <Notice tone="error">
          <p>{problem}</p>
        </Notice>
      )}
      <DietaryEditor value={entries} onChange={setEntries} labelPrefix={displayName(person)} />
      <div className="btn-row">
        <Button kind="primary" busy={busy} busyLabel="Saving…" onClick={() => void save()}>
          Save, next person
        </Button>
        {onLater && (
          <Button kind="ghost" disabled={busy} onClick={() => onLater(person)}>
            Skip for now
          </Button>
        )}
      </div>
    </div>
  );
}
