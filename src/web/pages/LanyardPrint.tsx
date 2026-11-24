import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { CardPerson, LanyardDesign, SideKey } from '../../shared/lanyardDesign';
import { CARD_FORMATS, cardSize, designWarnings } from '../../shared/lanyardDesign';
import { ApiFailure, api } from '../api';
import { loadFonts } from '../lanyards/fonts';
import type { PrintLayout, PrintSides } from '../lanyards/printPdf';
import { pageCount, sheetGrid } from '../lanyards/printPdf';
import type { RenderContext } from '../lanyards/render';
import { CanvasPainter, ImageCache, designFonts, drawSide } from '../lanyards/render';
import { fetchDesign } from '../lanyards/useDesign';
import { Banner, Button, ButtonLink, EmptyState, FilterChips, Icon, InfoTip, LoadError, Loading, Notice, PageHeader, Progress, SearchField, Segmented, Toggle, Toolbar, useRemembered, useToast } from '../ui';
import { useEvent } from './EventLayout';
import { CardThumb } from './LanyardDesigner';

interface Card extends CardPerson {
  registrationId: string;
  /** When this lanyard was issued (a reissued one is new). */
  issuedAt: string;
  /** When its PDF was last downloaded for printing, or null. */
  printedAt: string | null;
}

const stamp = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const day = (iso: string) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Design | Print, at the top of both lanyard pages. `end` sits at the right of the row (save status). */
export function LanyardTabs({ base, current, end }: { base: string; current: 'design' | 'print'; end?: ReactNode }) {
  const { can } = useEvent();
  return (
    <div className="ly-tabs-row">
      <nav className="tabs studio-tabs" aria-label="Lanyards">
        {can('event.configure') && (
          <Link to={`${base}/people/lanyards`} aria-current={current === 'design' ? 'page' : undefined}>
            Design
          </Link>
        )}
        {can('credentials.manage') && (
          <Link to={`${base}/people/lanyards/print`} aria-current={current === 'print' ? 'page' : undefined}>
            Print
          </Link>
        )}
      </nav>
      {end && <div className="ly-tabs-end">{end}</div>}
    </div>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

type Status = 'all' | 'unprinted' | 'printed';
type Sort = 'group' | 'newest' | 'oldest';

const SIDES_HELP: Record<PrintLayout, Record<PrintSides, string>> = {
  sheet: {
    both: 'Each page of fronts is followed by its backs. Print double-sided, flipping on the long edge, and they line up.',
    front: 'Only the fronts. Handy for reprinting on cards that already have a printed back.',
    back: 'Only the backs, in the same order. Print these first, then put the sheets back in for the fronts.',
  },
  cards: {
    both: 'Front, then back, for each person. Set your card printer to print both sides.',
    front: 'Only the fronts. Handy for reprinting on cards that already have a printed back.',
    back: 'Only the backs, in the same order. Print these first, then put the sheets back in for the fronts.',
  },
};

/** People › Lanyards › Print: choose who and how, then download a PDF. */
export function LanyardPrint() {
  const { event, can, base } = useEvent();
  const toast = useToast();
  const [design, setDesign] = useState<LanyardDesign | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [missing, setMissing] = useState(0);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  // How to print and who: remembered for this browser tab, per camp.
  const key = `lanyard-print:${event.id}`;
  const [layout, setLayout] = useRemembered<PrintLayout>(`${key}:layout`, 'sheet');
  const [sides, setSides] = useRemembered<PrintSides>(`${key}:sides`, 'both');
  const [cutLines, setCutLines] = useRemembered(`${key}:cut`, true);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useRemembered(`${key}:group`, '');
  const [level, setLevel] = useRemembered(`${key}:level`, '');
  const [onlyNoPhotos, setOnlyNoPhotos] = useRemembered(`${key}:nophoto`, false);
  const [status, setStatus] = useRemembered<Status>(`${key}:status`, 'all');
  const [sort, setSort] = useRemembered<Sort>(`${key}:sort`, 'group');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<number | null>(null);
  const [redraw, setRedraw] = useState(0);
  const images = useMemo(() => new ImageCache(event.id), [event.id]);
  const ctx: RenderContext = useMemo(() => ({ campName: event.name, marker: event.lanyard }), [event.name, event.lanyard]);

  const load = useCallback(async () => {
    try {
      const [d, res, roster] = await Promise.all([
        fetchDesign(event.id),
        api<{ cards: Card[] }>(`/events/${event.id}/credentials/print`, { body: {} }),
        api<{ registrations: { status: string; shortCode: string | null }[] }>(`/events/${event.id}/registrations`),
      ]);
      setDesign(d.design);
      setCards(res.cards);
      setMissing(roster.registrations.filter((r) => r.status === 'active' && !r.shortCode).length);
      setFailure(null);
      await Promise.all([loadFonts(designFonts(d.design)), images.loadAll(d.design)]);
      setRedraw((n) => n + 1);
    } catch (err) {
      setFailure(err instanceof ApiFailure ? err : new ApiFailure(0, 'offline', 'No connection.'));
    }
  }, [event.id, images]);

  useEffect(() => {
    void load();
  }, [load]);

  const all = useMemo(() => cards ?? [], [cards]);
  const levelWord = (c: Card) => c.style?.word || c.level;
  const groups = useMemo(() => [...new Set(all.map((c) => c.groupName))].filter(Boolean).sort(), [all]);
  const levels = useMemo(() => [...new Set(all.map(levelWord))].filter(Boolean).sort(), [all]);
  const countBy = (pick: (c: Card) => string) => all.reduce<Record<string, number>>((m, c) => ((m[pick(c)] = (m[pick(c)] ?? 0) + 1), m), {});
  const groupCounts = useMemo(() => countBy((c) => c.groupName), [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const levelCounts = useMemo(() => countBy(levelWord), [all]); // eslint-disable-line react-hooks/exhaustive-deps
  // Filters that no longer match anything (a group renamed, say) don't hide everyone.
  const activeGroup = groups.includes(group) ? group : '';
  const activeLevel = levels.includes(level) ? level : '';

  const shown = all
    .filter(
      (c) =>
        (!activeGroup || c.groupName === activeGroup) &&
        (!activeLevel || levelWord(c) === activeLevel) &&
        (!onlyNoPhotos || c.noPhotos) &&
        (status === 'all' || (status === 'unprinted' ? !c.printedAt : !!c.printedAt)) &&
        (!query || `${c.name} ${c.shortCode}`.toLowerCase().includes(query.toLowerCase())),
    )
    .sort((a, b) => (sort === 'group' ? 0 : (sort === 'newest' ? b.issuedAt.localeCompare(a.issuedAt) : a.issuedAt.localeCompare(b.issuedAt)) || a.name.localeCompare(b.name)));
  const unprintedCount = all.filter((c) => !c.printedAt).length;
  const selected = shown.filter((c) => !excluded.has(c.registrationId));
  const noPhotoCount = all.filter((c) => c.noPhotos).length;
  const filtered = !!(activeGroup || activeLevel || onlyNoPhotos || status !== 'all' || query);

  async function issueMissing() {
    try {
      const { issued } = await api<{ issued: number }>(`/events/${event.id}/credentials/issue`, { body: { mode: 'missing' } });
      toast(`Issued ${issued} new lanyard${issued === 1 ? '' : 's'}`);
      await load();
    } catch (err) {
      toast(err instanceof ApiFailure ? err.message : 'No connection. Try again.', { tone: 'error' });
    }
  }

  async function markPrinted(ids: string[], printed: boolean) {
    const res = await api<{ printedAt: string | null }>(`/events/${event.id}/credentials/printed`, { body: { registrationIds: ids, printed } });
    const set = new Set(ids);
    setCards((prev) => prev && prev.map((c) => (set.has(c.registrationId) ? { ...c, printedAt: res.printedAt } : c)));
  }

  async function markChosen(printed: boolean) {
    const ids = selected.filter((c) => !!c.printedAt !== printed).map((c) => c.registrationId);
    try {
      await markPrinted(ids, printed);
      toast(`${ids.length} marked as ${printed ? 'printed' : 'not printed'}`);
    } catch (err) {
      toast(err instanceof ApiFailure ? err.message : 'No connection. Try again.', { tone: 'error' });
    }
  }

  async function download() {
    if (!design) return;
    setProgress(0);
    try {
      const { buildPrintPdf } = await import('../lanyards/printPdf');
      const bytes = await buildPrintPdf(design, selected, images, { ...ctx, layout, sides, cutLines }, (n) => setProgress(n));
      const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug(event.name)}-lanyards-${layout === 'sheet' ? 'a4' : 'card-size'}${sides === 'both' ? '' : `-${sides}`}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      // Downloaded for printing: mark them printed, so later registrations stand out.
      const ids = selected.map((c) => c.registrationId);
      await markPrinted(ids, true).catch(() => undefined);
      toast(`PDF ready: ${selected.length} lanyard${selected.length === 1 ? '' : 's'}, marked as printed. Print at 100% (actual size).`);
    } catch {
      toast('The PDF couldn’t be made. Try fewer lanyards at a time.', { tone: 'error' });
    } finally {
      setProgress(null);
    }
  }

  const header = (
    <>
      <PageHeader
        title="Lanyards"
        back={{ to: `${base}/people`, label: 'People' }}
        summary={cards && cards.length > 0 ? `${plural(cards.length, 'lanyard')} · ${unprintedCount} not printed` : undefined}
        help={
          <>
            Choose who and how, then download a PDF. Print it at 100% (actual size). Downloading marks those lanyards as printed. A lanyard is enough to be scanned as that person, so keep spare ones secure.
          </>
        }
      />
      <LanyardTabs base={base} current="print" />
    </>
  );

  if (!can('credentials.manage'))
    return (
      <>
        {header}
        <Notice tone="error">
          <p>You don’t have permission to print lanyards.</p>
        </Notice>
      </>
    );
  if (failure && !cards)
    return (
      <>
        {header}
        <LoadError error={failure} onRetry={load} what="lanyards" />
      </>
    );
  if (!cards || !design)
    return (
      <>
        {header}
        <Loading what="lanyards" />
      </>
    );

  const grid = sheetGrid(design);
  const pages = pageCount(design, selected.length, { layout, sides });
  const errors = designWarnings(design).filter((w) => w.level === 'error');
  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const chooseAll = () => setExcluded(new Set());
  const chooseNone = () => setExcluded(new Set(shown.map((c) => c.registrationId)));
  const clearFilters = () => {
    setQuery('');
    setGroup('');
    setLevel('');
    setOnlyNoPhotos(false);
    setStatus('all');
  };
  const busy = progress !== null;
  const chosenPrinted = selected.filter((c) => c.printedAt).length;

  const banners = (missing > 0 || errors.length > 0) && (
    <div className="banners">
      {missing > 0 && (
        <Banner
          tone="warning"
          action={
            <Button small busyLabel="Issuing…" onAction={issueMissing}>
              Issue {missing} lanyard{missing === 1 ? '' : 's'}
            </Button>
          }
        >
          {missing} {missing === 1 ? 'person doesn’t' : 'people don’t'} have a lanyard yet
        </Banner>
      )}
      {errors.length > 0 && (
        <Banner
          tone="error"
          action={
            can('event.configure') && (
              <ButtonLink small to={`${base}/people/lanyards`}>
                Open designer
              </ButtonLink>
            )
          }
        >
          Fix the design before printing: <span className="meta">{errors[0]!.message}</span>
          {errors.length > 1 && <span className="meta"> (+{errors.length - 1} more)</span>}
        </Banner>
      )}
    </div>
  );

  if (cards.length === 0)
    return (
      <>
        {header}
        <div className="sections">
          {banners}
          <EmptyState title="No lanyards to print yet">Add people to the camp, then issue their lanyards here.</EmptyState>
        </div>
      </>
    );

  const allShownChosen = shown.length > 0 && selected.length === shown.length;

  return (
    <>
      {header}
      <div className="ly-print">
        {banners}
        <div className="ly-print-grid">
          {/* ---------- Who ---------- */}
          <section className="ly-who" aria-label="Who to print">
            <Toolbar label="Find people">
              <SearchField id="ly-q" label="Search name or code" placeholder="Name or code" value={query} onChange={setQuery} slash />
              {groups.length > 1 && (
                <select className="select" aria-label="Group" value={activeGroup} onChange={(e) => setGroup(e.target.value)}>
                  <option value="">All groups</option>
                  {groups.map((g) => (
                    <option key={g} value={g}>
                      {g} ({groupCounts[g] ?? 0})
                    </option>
                  ))}
                </select>
              )}
              {levels.length > 1 && (
                <select className="select" aria-label="Level" value={activeLevel} onChange={(e) => setLevel(e.target.value)}>
                  <option value="">All levels</option>
                  {levels.map((s) => (
                    <option key={s} value={s}>
                      {s} ({levelCounts[s] ?? 0})
                    </option>
                  ))}
                </select>
              )}
            </Toolbar>
            <div className="ly-chip-row">
              <FilterChips<Status>
                label="Printed"
                value={status}
                onChange={setStatus}
                options={[
                  { value: 'all', label: 'All', count: all.length },
                  { value: 'unprinted', label: 'Not printed', count: unprintedCount },
                  { value: 'printed', label: 'Printed', count: all.length - unprintedCount },
                ]}
              />
              {noPhotoCount > 0 && (
                <FilterChips<'nophoto'>
                  multi
                  label="Photo consent"
                  value={onlyNoPhotos ? ['nophoto'] : []}
                  onChange={(v) => setOnlyNoPhotos(v.length > 0)}
                  options={[{ value: 'nophoto', label: 'No photo consent', count: noPhotoCount }]}
                />
              )}
              {filtered && (
                <button type="button" className="link-button ly-clear" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>

            <div className="ly-list-card">
              <div className="ly-list-head">
                <label className="ly-check-all">
                  <input
                    type="checkbox"
                    checked={allShownChosen}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.length > 0 && !allShownChosen;
                    }}
                    disabled={shown.length === 0}
                    onChange={() => (allShownChosen ? chooseNone() : chooseAll())}
                  />
                  <span aria-live="polite">
                    <strong>{selected.length}</strong> of {shown.length} chosen
                  </span>
                </label>
                <div className="ly-list-head-actions">
                  <select className="select select-small ly-sort" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                    <option value="group">By group and name</option>
                    <option value="newest">Newest issued first</option>
                    <option value="oldest">Oldest issued first</option>
                  </select>
                  <Button small kind="ghost" onClick={chooseAll} disabled={allShownChosen}>
                    All
                  </Button>
                  <Button small kind="ghost" onClick={chooseNone} disabled={selected.length === 0}>
                    None
                  </Button>
                </div>
              </div>
              {shown.length === 0 ? (
                <div className="ly-list-empty">
                  <p>No one matches.</p>
                  <Button small onClick={clearFilters}>
                    Clear filters
                  </Button>
                </div>
              ) : (
                <ul className="ly-people scroll-list">
                  {shown.map((c) => (
                    <li key={c.registrationId}>
                      <label className="ly-person">
                        <input type="checkbox" checked={!excluded.has(c.registrationId)} onChange={() => toggle(c.registrationId)} />
                        <span className="ly-person-main">
                          <span className="ly-person-name">
                            {c.name}
                            {c.noPhotos && <Icon name="noPhoto" size={16} label="No photo consent" />}
                          </span>
                          <span className="ly-person-meta">
                            {[c.groupName, levelWord(c)].filter(Boolean).join(' · ')} · Issued {stamp(c.issuedAt)}
                          </span>
                        </span>
                        {c.printedAt ? (
                          <span className="ly-status ly-status-done" title={`Printed ${stamp(c.printedAt)}`}>
                            <Icon name="check" size={14} />
                            Printed {day(c.printedAt)}
                          </span>
                        ) : (
                          <span className="ly-status ly-status-new">Not printed</span>
                        )}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* ---------- How, and the preview ---------- */}
          <aside className="ly-how" aria-label="How to print">
            <div className="ly-panel">
              <div className="ly-field">
                <span className="ly-label" id="ly-layout-label">
                  Layout
                </span>
                <Segmented<PrintLayout>
                  label="Layout"
                  value={layout}
                  block
                  onChange={setLayout}
                  options={[
                    { value: 'sheet', label: 'A4 sheets' },
                    { value: 'cards', label: 'One per page' },
                  ]}
                />
                <span className="meta">
                  {layout === 'sheet'
                    ? `${grid.perPage} cards a page, to cut out. Any printer.`
                    : `Each page ${CARD_FORMATS[design.format].detail.split(',')[0]}. For card printers and print shops.`}
                </span>
              </div>
              <div className="ly-field">
                <span className="ly-label">
                  Sides <InfoTip label="About sides">{SIDES_HELP[layout][sides]}</InfoTip>
                </span>
                <Segmented<PrintSides>
                  label="Sides"
                  value={sides}
                  block
                  onChange={setSides}
                  options={[
                    { value: 'both', label: 'Both' },
                    { value: 'front', label: 'Front' },
                    { value: 'back', label: 'Back' },
                  ]}
                />
              </div>
              {layout === 'sheet' && <Toggle checked={cutLines} onChange={setCutLines} label="Dashed cut lines" />}
            </div>

            <div className="ly-panel ly-preview">
              <div className="ly-preview-head">
                <h2 className="ly-label">Preview</h2>
                <span className="meta">
                  {plural(pages, 'page')} · print at 100%
                </span>
              </div>
              {selected.length === 0 ? (
                <p className="meta">Choose who to print.</p>
              ) : layout === 'sheet' ? (
                <SheetPreview design={design} people={selected.slice(0, grid.perPage)} side={sides === 'back' ? 'back' : 'front'} ctx={ctx} images={images} redraw={redraw} cutLines={cutLines} />
              ) : (
                <div className="print-cards-preview">
                  {(sides === 'back' ? (['back'] as SideKey[]) : sides === 'front' ? (['front'] as SideKey[]) : (['front', 'back'] as SideKey[])).map((s) => (
                    <figure key={s}>
                      <CardThumb design={design} side={s} person={selected[0]!} ctx={ctx} images={images} redraw={redraw} width={cardSize(design.format, design.orientation).w > 60 ? 220 : 130} />
                      <figcaption className="meta">{s === 'front' ? 'Front' : 'Back'}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>

        {/* ---------- Always in reach: how many, and download ---------- */}
        <div className="selection-bar ly-actionbar" role="region" aria-label="Print">
          {busy ? (
            <span className="ly-actionbar-progress" aria-live="polite">
              Making PDF… {progress} of {selected.length}
              <Progress value={progress ?? 0} max={Math.max(1, selected.length)} />
            </span>
          ) : (
            <span className="selection-count" aria-live="polite">
              <strong>{selected.length}</strong> chosen · {plural(pages, 'page')}
            </span>
          )}
          <div className="selection-actions">
            {chosenPrinted < selected.length && !busy && (
              <Button small kind="ghost" className="ly-bar-ghost" onAction={() => markChosen(true)}>
                Mark printed
              </Button>
            )}
            {chosenPrinted > 0 && !busy && (
              <Button small kind="ghost" className="ly-bar-ghost" onAction={() => markChosen(false)}>
                Mark not printed
              </Button>
            )}
            <Button kind="primary" small disabled={selected.length === 0 || busy} busy={busy} busyLabel="Making PDF…" onAction={download}>
              <Icon name="download" size={18} />
              Download PDF ({selected.length})
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

/** The first A4 page, drawn with the same renderer as the PDF. */
function SheetPreview({ design, people, side, ctx, images, redraw, cutLines }: { design: LanyardDesign; people: CardPerson[]; side: SideKey; ctx: RenderContext; images: ImageCache; redraw: number; cutLines: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = 420;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const pxPerMm = (width / 210) * Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(210 * pxPerMm);
    c.height = Math.round(297 * pxPerMm);
    const g = c.getContext('2d')!;
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, c.width, c.height);
    const grid = sheetGrid(design);
    people.forEach((p, slot) => {
      const col = slot % grid.cols;
      const row = Math.floor(slot / grid.cols);
      const left = grid.left + col * (grid.w + grid.gap);
      const top = grid.top + row * (grid.h + grid.gap);
      drawSide(new CanvasPainter(g, pxPerMm, images, { x: left, y: top }), design, side, p, ctx);
      if (cutLines) {
        g.save();
        g.setLineDash([2 * pxPerMm * 0.35, 2 * pxPerMm * 0.35]);
        g.strokeStyle = '#9E9E9E';
        g.lineWidth = Math.max(1, pxPerMm * 0.14);
        g.strokeRect(left * pxPerMm, top * pxPerMm, grid.w * pxPerMm, grid.h * pxPerMm);
        g.restore();
      }
    });
  }, [design, people, side, ctx, images, redraw, cutLines]);
  return (
    <div className="sheet-preview-wrap" role="img" aria-label={`The first A4 page, showing ${people.length} ${side === 'front' ? 'fronts' : 'backs'}`}>
      <canvas ref={ref} className="sheet-preview" style={{ width, height: (width * 297) / 210 }} aria-hidden="true" />
    </div>
  );
}
