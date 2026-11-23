import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { matchesSearch } from '../../shared/search';
import { ApiFailure, api } from '../api';
import { useApi } from '../useApi';
import {
  Badge,
  Banner,
  Button,
  EmptyState,
  FilterChips,
  LoadError,
  Loading,
  PageHeader,
  SearchField,
  Segmented,
  SelectionBar,
  Sheet,
  StatStrip,
  Toolbar,
  useConfirm,
  useRemembered,
  useToast,
} from '../ui';
import { useEvent } from './EventLayout';

interface Person {
  id: string;
  name: string;
  section: string;
  groupName: string;
  kind: string;
  active: boolean;
}
interface Collection {
  collectorId: string;
  collectedId: string;
  at: string;
}
interface Data {
  enabled: boolean;
  canRemove: boolean;
  players: number;
  people: Person[];
  collections: Collection[];
}

/** Six or more collections by one person within a minute: usually a stack of lanyards or a photo of one, not friends. */
const RAPID_COUNT = 6;
const RAPID_WINDOW_MS = 60_000;

const pairKey = (c: { collectorId: string; collectedId: string }) => `${c.collectorId}>${c.collectedId}`;

function stamp(iso: string, tz: string) {
  return new Date(iso).toLocaleString('en-AU', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

/**
 * Side Quest: who's winning, who has collected whom, and taking away the
 * collections that shouldn't count. Full names here (staff only); campers
 * only ever see first names and an initial.
 */
export function SideQuest() {
  const { event, can, base } = useEvent();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, loading, reload } = useApi<Data>(`/events/${event.id}/side-quest/collections`);
  const [view, setView] = useRemembered<'board' | 'friends'>(`sq:${event.id}:view`, 'board');
  const [filter, setFilter] = useRemembered<'all' | 'mutual' | 'rapid'>(`sq:${event.id}:filter`, 'all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const model = useMemo(() => {
    if (!data) return null;
    const people = new Map(data.people.map((p) => [p.id, p]));
    const keys = new Set(data.collections.map(pairKey));
    const mutual = (c: Collection) => keys.has(`${c.collectedId}>${c.collectorId}`);
    // Rapid: part of a burst of collections by the same person.
    const rapid = new Set<string>();
    const byCollector = new Map<string, Collection[]>();
    for (const c of data.collections) byCollector.set(c.collectorId, [...(byCollector.get(c.collectorId) ?? []), c]);
    for (const list of byCollector.values()) {
      const times = list.map((c) => Date.parse(c.at));
      list.forEach((c, i) => {
        const near = times.filter((t) => Math.abs(t - times[i]!) <= RAPID_WINDOW_MS).length;
        if (near >= RAPID_COUNT) rapid.add(pairKey(c));
      });
    }
    const collectedBy = new Map<string, number>();
    for (const c of data.collections) collectedBy.set(c.collectedId, (collectedBy.get(c.collectedId) ?? 0) + 1);
    const board = [...byCollector.entries()]
      .map(([id, list]) => ({ id, person: people.get(id), collected: list.length, rapid: list.filter((c) => rapid.has(pairKey(c))).length, by: collectedBy.get(id) ?? 0, last: list[list.length - 1]!.at }))
      .sort((a, b) => b.collected - a.collected || (a.person?.name ?? '').localeCompare(b.person?.name ?? ''));
    const placed = board.map((r) => ({ ...r, place: 1 + board.filter((x) => x.collected > r.collected).length }));
    const mutualPairs = data.collections.filter((c) => mutual(c) && c.collectorId < c.collectedId).length;
    return { people, mutual, rapid, board: placed, mutualPairs, byCollector, collectedBy };
  }, [data]);

  if (!can('reports.view')) return <Navigate to={base || '/'} replace />;
  const header = (
    <PageHeader
      title="Side Quest"
      summary={model && data ? `${model.board.length} playing · ${data.collections.length} collected` : undefined}
      help="Campers collect each other by scanning lanyards with their own phone. Take away collections that shouldn’t count, such as a stack of spare lanyards or a photo of one."
    />
  );
  if (loading && !data) return (<>{header}<Loading what="the Side Quest" rows={6} /></>);
  if (error || !data || !model) return (<>{header}<LoadError error={error!} onRetry={reload} what="the Side Quest" /></>);

  const nameOf = (id: string) => model.people.get(id)?.name ?? 'Someone removed';
  const tz = event.timezone;

  async function remove(pairs: Collection[], what: string) {
    if (pairs.length > 1 && !(await confirm({ title: `Take away ${pairs.length} collections?`, body: <p>They stop counting towards {what}. You can undo straight after.</p>, confirm: 'Take away', danger: true }))) return;
    setBusy(true);
    try {
      const all: Collection[] = [];
      for (let i = 0; i < pairs.length; i += 500) {
        const res = await api<{ removed: Collection[] }>(`/events/${event.id}/side-quest/collections/remove`, {
          body: { pairs: pairs.slice(i, i + 500).map(({ collectorId, collectedId }) => ({ collectorId, collectedId })) },
        });
        all.push(...res.removed);
      }
      setSelected(new Set());
      await reload();
      toast(`${all.length === 1 ? '1 collection' : `${all.length} collections`} taken away`, {
        undo: async () => {
          for (let i = 0; i < all.length; i += 500) await api(`/events/${event.id}/side-quest/collections/restore`, { body: { items: all.slice(i, i + 500) } });
          await reload();
        },
      });
    } catch (err) {
      toast(err instanceof ApiFailure ? err.message : 'No connection. Try again.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const rapidCount = model.rapid.size;
  const top = model.board[0];

  const friends = data.collections
    .filter((c) => (filter === 'mutual' ? model.mutual(c) : filter === 'rapid' ? model.rapid.has(pairKey(c)) : true))
    .filter((c) => !q || matchesSearch(q, nameOf(c.collectorId), nameOf(c.collectedId)))
    .slice()
    .reverse();
  const board = model.board.filter((r) => !q || matchesSearch(q, r.person?.name ?? '', r.person?.groupName ?? ''));
  const chosen = friends.filter((c) => selected.has(pairKey(c)));
  const toggle = (k: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const person = open ? model.people.get(open) : null;
  const theirs = open ? (model.byCollector.get(open) ?? []).slice().reverse() : [];
  const collectedThem = open ? data.collections.filter((c) => c.collectedId === open) : [];

  return (
    <>
      {header}
      <div className="sections sq">
        {!data.enabled && (
          <Banner
            tone="warning"
            action={
              can('event.configure') && (
                <Link className="btn btn-secondary btn-small" to={`${base}/settings/event`}>
                  Event details
                </Link>
              )
            }
          >
            The Side Quest is switched off. Nothing new is collected.
          </Banner>
        )}
        <StatStrip
          items={[
            { label: 'Playing', value: model.board.length, hint: `of ${data.players} at camp` },
            { label: 'Collected', value: data.collections.length },
            { label: 'In the lead', value: top ? `${top.collected}` : '–', hint: top?.person?.name },
            { label: 'Both ways', value: model.mutualPairs, onPress: () => (setView('friends'), setFilter('mutual')), pressed: view === 'friends' && filter === 'mutual', hint: 'Pairs who collected each other' },
            {
              label: 'Rapid',
              value: rapidCount,
              tone: rapidCount ? 'warning' : undefined,
              onPress: () => (setView('friends'), setFilter('rapid')),
              pressed: view === 'friends' && filter === 'rapid',
              hint: `${RAPID_COUNT} or more by one person within a minute`,
            },
          ]}
        />
        {rapidCount > 0 && filter !== 'rapid' && (
          <Banner tone="warning" action={<Button small onClick={() => (setView('friends'), setFilter('rapid'))}>Review</Button>}>
            {rapidCount} collection{rapidCount === 1 ? '' : 's'} came in bursts, which usually means a stack of lanyards or a photo.
          </Banner>
        )}

        <Toolbar sticky label="Side Quest">
          <Segmented
            label="View"
            value={view}
            onChange={(v) => (setView(v), setSelected(new Set()))}
            options={[
              { value: 'board', label: 'Leaderboard' },
              { value: 'friends', label: 'Who collected who' },
            ]}
          />
          <SearchField id="sq-q" label="Search names" value={q} onChange={setQ} slash />
          {view === 'friends' && (
            <FilterChips
              label="Show"
              value={filter}
              onChange={(v) => (setFilter(v), setSelected(new Set()))}
              options={[
                { value: 'all', label: 'All', count: data.collections.length },
                { value: 'mutual', label: 'Both ways', count: data.collections.filter(model.mutual).length },
                { value: 'rapid', label: 'Rapid', count: rapidCount },
              ]}
            />
          )}
        </Toolbar>

        {data.collections.length === 0 ? (
          <EmptyState title="No one has found it yet">Collections show here as campers scan each other’s lanyards.</EmptyState>
        ) : view === 'board' ? (
          <div className="table-wrap scroll-list">
            <table className="table sq-board">
              <thead>
                <tr>
                  <th scope="col" className="cell-num">
                    Place
                  </th>
                  <th scope="col">Name</th>
                  <th scope="col">Section · group</th>
                  <th scope="col" className="cell-num">
                    Collected
                  </th>
                  <th scope="col" className="cell-num">
                    Collected by
                  </th>
                  <th scope="col">
                    <span className="visually-hidden">Flags</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {board.map((r) => (
                  <tr key={r.id} className={r.place <= 3 ? `sq-top sq-top-${r.place}` : undefined}>
                    <td className="cell-num">
                      <span className="sq-place">{r.place}</span>
                    </td>
                    <td>
                      <button type="button" className="link-button sq-name" onClick={() => setOpen(r.id)}>
                        {r.person?.name ?? 'Someone removed'}
                      </button>
                    </td>
                    <td className="meta">{[r.person?.section, r.person?.groupName].filter(Boolean).join(' · ')}</td>
                    <td className="cell-num">
                      <strong>{r.collected}</strong>
                    </td>
                    <td className="cell-num">{r.by}</td>
                    <td>{r.rapid > 0 && <Badge tone="warning">{r.rapid} rapid</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : friends.length === 0 ? (
          <EmptyState title="Nothing matches">Try another name or filter.</EmptyState>
        ) : (
          <>
            <div className="table-wrap scroll-list">
              <table className="table sq-friends">
                <thead>
                  <tr>
                    {data.canRemove && (
                      <th scope="col" className="cell-check">
                        <input
                          type="checkbox"
                          aria-label="Choose all shown"
                          checked={chosen.length > 0 && chosen.length === friends.length}
                          onChange={(e) => setSelected(e.target.checked ? new Set(friends.map(pairKey)) : new Set())}
                        />
                      </th>
                    )}
                    <th scope="col">When</th>
                    <th scope="col">Collector</th>
                    <th scope="col">Collected</th>
                    <th scope="col">
                      <span className="visually-hidden">Flags</span>
                    </th>
                    {data.canRemove && (
                      <th scope="col">
                        <span className="visually-hidden">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {friends.map((c) => {
                    const k = pairKey(c);
                    return (
                      <tr key={k} className={model.rapid.has(k) ? 'sq-rapid' : undefined}>
                        {data.canRemove && (
                          <td className="cell-check">
                            <input type="checkbox" aria-label={`Choose ${nameOf(c.collectorId)} collecting ${nameOf(c.collectedId)}`} checked={selected.has(k)} onChange={() => toggle(k)} />
                          </td>
                        )}
                        <td className="meta sq-when">{stamp(c.at, tz)}</td>
                        <td>
                          <button type="button" className="link-button" onClick={() => setOpen(c.collectorId)}>
                            {nameOf(c.collectorId)}
                          </button>
                        </td>
                        <td>
                          <button type="button" className="link-button" onClick={() => setOpen(c.collectedId)}>
                            {nameOf(c.collectedId)}
                          </button>
                        </td>
                        <td>
                          <span className="sq-flags">
                            {model.mutual(c) && <Badge tone="success">Both ways</Badge>}
                            {model.rapid.has(k) && <Badge tone="warning">Rapid</Badge>}
                          </span>
                        </td>
                        {data.canRemove && (
                          <td className="cell-actions">
                            <Button small kind="ghost" disabled={busy} onClick={() => void remove([c], 'the leaderboard')}>
                              Take away
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data.canRemove && (
              <SelectionBar count={chosen.length} noun={chosen.length === 1 ? 'collection chosen' : 'collections chosen'} onClear={() => setSelected(new Set())}>
                <Button small kind="danger" busy={busy} busyLabel="Taking away…" onClick={() => void remove(chosen, 'the leaderboard')}>
                  Take away {chosen.length}
                </Button>
              </SelectionBar>
            )}
          </>
        )}
      </div>

      <Sheet open={!!open} title={person?.name ?? 'Side Quest'} onClose={() => setOpen(null)}>
        {open && (
          <div className="sq-person">
            <p className="meta">{[person?.section, person?.groupName].filter(Boolean).join(' · ')}</p>
            <StatStrip
              items={[
                { label: 'Collected', value: theirs.length },
                { label: 'Collected by', value: collectedThem.length },
                { label: 'Rapid', value: theirs.filter((c) => model.rapid.has(pairKey(c))).length, tone: theirs.some((c) => model.rapid.has(pairKey(c))) ? 'warning' : undefined },
              ]}
            />
            {theirs.length > 0 && (
              <section className="sq-person-list">
                <div className="section-head">
                  <h3>Collected</h3>
                  {data.canRemove && (
                    <Button small kind="ghost" disabled={busy} onClick={() => void remove(theirs, `${person?.name ?? 'their'} score`)}>
                      Take all away
                    </Button>
                  )}
                </div>
                <ul className="list">
                  {theirs.map((c) => (
                    <li key={pairKey(c)} className="row">
                      <span className="row-main">
                        <span className="row-title">{nameOf(c.collectedId)}</span>
                        <span className="row-meta">{stamp(c.at, tz)}</span>
                      </span>
                      <span className="row-side">
                        {model.mutual(c) && <Badge tone="success">Both ways</Badge>}
                        {model.rapid.has(pairKey(c)) && <Badge tone="warning">Rapid</Badge>}
                        {data.canRemove && (
                          <Button small kind="ghost" disabled={busy} onClick={() => void remove([c], `${person?.name ?? 'their'} score`)}>
                            Take away
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {collectedThem.length > 0 && (
              <section className="sq-person-list">
                <h3>Collected by</h3>
                <ul className="list">
                  {collectedThem.map((c) => (
                    <li key={pairKey(c)} className="row">
                      <span className="row-main">
                        <span className="row-title">{nameOf(c.collectorId)}</span>
                        <span className="row-meta">{stamp(c.at, tz)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
