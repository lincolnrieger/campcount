import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Button, EmptyState, Icon, LoadError, Loading, Notice, PageHeader, Progress, SearchField, Segmented, useToast } from '../ui';
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

/** Design | Print, at the top of both lanyard pages. */
export function LanyardTabs({ base, current }: { base: string; current: 'design' | 'print' }) {
  const { can } = useEvent();
  return (
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
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** People › Lanyards › Print: choose who and how, then download a PDF. */
export function LanyardPrint() {
  const { event, can, base } = useEvent();
  const toast = useToast();
  const [design, setDesign] = useState<LanyardDesign | null>(null);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [missing, setMissing] = useState(0);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [layout, setLayout] = useState<PrintLayout>('sheet');
  const [sides, setSides] = useState<PrintSides>('both');
  const [cutLines, setCutLines] = useState(true);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [onlyNoPhotos, setOnlyNoPhotos] = useState(false);
  const [onlyUnprinted, setOnlyUnprinted] = useState(false);
  const [sort, setSort] = useState<'group' | 'newest' | 'oldest'>('group');
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

  const groups = useMemo(() => [...new Set((cards ?? []).map((c) => c.groupName))].filter(Boolean).sort(), [cards]);
  const shown = (cards ?? [])
    .filter(
      (c) =>
        (!group || c.groupName === group) &&
        (!onlyNoPhotos || c.noPhotos) &&
        (!onlyUnprinted || !c.printedAt) &&
        (!query || `${c.name} ${c.shortCode}`.toLowerCase().includes(query.toLowerCase())),
    )
    .sort((a, b) => (sort === 'group' ? 0 : (sort === 'newest' ? b.issuedAt.localeCompare(a.issuedAt) : a.issuedAt.localeCompare(b.issuedAt)) || a.name.localeCompare(b.name)));
  const unprintedCount = (cards ?? []).filter((c) => !c.printedAt).length;
  const selected = shown.filter((c) => !excluded.has(c.registrationId));
  const noPhotoCount = (cards ?? []).filter((c) => c.noPhotos).length;

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

  async function download() {
    if (!design) return;
    setProgress(0);
    try {
      const { buildPrintPdf, } = await import('../lanyards/printPdf');
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
        summary="Print every lanyard, or just the ones you need."
        primary={
          cards &&
          cards.length > 0 &&
          design && (
            <Button kind="primary" disabled={selected.length === 0 || progress !== null} busy={progress !== null} busyLabel="Making PDF…" onAction={download}>
              <Icon name="download" />
              Download PDF ({selected.length})
            </Button>
          )
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

  return (
    <>
      {header}
      <div className="sections">
        {missing > 0 && (
          <Notice tone="warning" title={`${missing} ${missing === 1 ? 'person doesn’t' : 'people don’t'} have a lanyard yet`}>
            <Button busyLabel="Issuing…" onAction={issueMissing}>
              Issue {missing} lanyard{missing === 1 ? '' : 's'}
            </Button>
          </Notice>
        )}
        {errors.map((w, i) => (
          <Notice key={i} tone="error" title="Fix the design before printing">
            <p>
              {w.message} {can('event.configure') && <Link to={`${base}/people/lanyards`}>Open the designer</Link>}
            </p>
          </Notice>
        ))}
        {progress !== null && (
          <div className="print-progress" aria-live="polite">
            <p>
              Making your PDF… {progress} of {selected.length}
            </p>
            <Progress value={progress} max={Math.max(1, selected.length)} />
          </div>
        )}
        {cards.length === 0 ? (
          <EmptyState title="No lanyards to print yet">Add people to the camp, then issue their lanyards here.</EmptyState>
        ) : (
          <div className="print-layout">
            <div className="print-options">
              <fieldset className="print-choice-group">
                <legend className="studio-heading">How to print</legend>
                <label className="print-choice">
                  <input type="radio" name="layout" checked={layout === 'sheet'} onChange={() => setLayout('sheet')} />
                  <span className="print-choice-art print-art-sheet" aria-hidden="true" />
                  <span className="choice-text">
                    Sheets to cut out
                    <span className="meta">
                      {grid.perPage} cards on each A4 page, with cut lines. Any printer; then cut them out or use a guillotine.
                    </span>
                  </span>
                </label>
                <label className="print-choice">
                  <input type="radio" name="layout" checked={layout === 'cards'} onChange={() => setLayout('cards')} />
                  <span className="print-choice-art print-art-card" aria-hidden="true" />
                  <span className="choice-text">
                    One card per page
                    <span className="meta">Each page is exactly {CARD_FORMATS[design.format].detail.split(',')[0]}. For card printers and print shops.</span>
                  </span>
                </label>
              </fieldset>

              <div className="print-field">
                <p className="studio-heading" id="sides-label">
                  Sides
                </p>
                <Segmented
                  label="Sides"
                  value={sides}
                  block
                  onChange={setSides}
                  options={[
                    { value: 'both', label: 'Both' },
                    { value: 'front', label: 'Front only' },
                    { value: 'back', label: 'Back only' },
                  ]}
                />
                <p className="meta">
                  {sides === 'both'
                    ? layout === 'sheet'
                      ? 'Each page of fronts is followed by its backs. Print double-sided, flipping on the long edge, and they line up.'
                      : 'Front, then back, for each person. Set your card printer to print both sides.'
                    : sides === 'front'
                      ? 'Only the fronts. Handy for reprinting on cards that already have a printed back.'
                      : 'Only the backs, in the same order. Print these first, then put the sheets back in for the fronts.'}
                </p>
              </div>

              {layout === 'sheet' && (
                <label className="choice">
                  <input type="checkbox" checked={cutLines} onChange={(e) => setCutLines(e.target.checked)} />
                  <span className="choice-text">Dashed cut lines around each card</span>
                </label>
              )}

              <div className="print-field">
                <p className="studio-heading">Who</p>
                <SearchField id="ly-q" label="Search name or code" value={query} onChange={setQuery} />
                {groups.length > 1 && (
                  <select className="select" aria-label="Scout group" value={group} onChange={(e) => setGroup(e.target.value)}>
                    <option value="">All groups</option>
                    {groups.map((g) => (
                      <option key={g}>{g}</option>
                    ))}
                  </select>
                )}
                <label className="choice">
                  <input type="checkbox" checked={onlyUnprinted} onChange={(e) => setOnlyUnprinted(e.target.checked)} />
                  <span className="choice-text">Only lanyards not printed yet ({unprintedCount})</span>
                </label>
                <select className="select" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                  <option value="group">Sort by group and name</option>
                  <option value="newest">Sort by issue date, newest first</option>
                  <option value="oldest">Sort by issue date, oldest first</option>
                </select>
                {noPhotoCount > 0 && (
                  <label className="choice">
                    <input type="checkbox" checked={onlyNoPhotos} onChange={(e) => setOnlyNoPhotos(e.target.checked)} />
                    <span className="choice-text">Only people without photo consent ({noPhotoCount})</span>
                  </label>
                )}
                <div className="print-select-row">
                  <p aria-live="polite">
                    <strong>{selected.length}</strong> of {shown.length} chosen
                  </p>
                  <Button small kind="ghost" onClick={() => setExcluded(new Set())}>
                    All
                  </Button>
                  <Button small kind="ghost" onClick={() => setExcluded(new Set(shown.map((c) => c.registrationId)))}>
                    None
                  </Button>
                </div>
                {selected.some((c) => c.printedAt) && (
                  <Button
                    small
                    kind="ghost"
                    onAction={async () => {
                      const ids = selected.filter((c) => c.printedAt).map((c) => c.registrationId);
                      await markPrinted(ids, false);
                      toast(`${ids.length} marked as not printed`);
                    }}
                  >
                    Mark chosen as not printed
                  </Button>
                )}
                <ul className="print-people">
                  {shown.map((c) => (
                    <li key={c.registrationId}>
                      <label className="print-person">
                        <input type="checkbox" checked={!excluded.has(c.registrationId)} onChange={() => toggle(c.registrationId)} />
                        <span className="print-person-main">
                          <span className="print-person-name">{c.name}</span>
                          <span className="print-person-dates">
                            Issued {stamp(c.issuedAt)} · {c.printedAt ? `Printed ${stamp(c.printedAt)}` : <strong className="print-new">Not printed</strong>}
                          </span>
                        </span>
                        <span className="meta">{c.groupName}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="print-preview">
              <div className="print-preview-head">
                <h2 className="studio-heading">Preview</h2>
                <p className="meta">
                  {selected.length} lanyard{selected.length === 1 ? '' : 's'} · {pages} page{pages === 1 ? '' : 's'} · print at 100% (actual size)
                </p>
              </div>
              {selected.length === 0 ? (
                <p className="meta">Choose who to print.</p>
              ) : layout === 'sheet' ? (
                <SheetPreview design={design} people={selected.slice(0, grid.perPage)} side={sides === 'back' ? 'back' : 'front'} ctx={ctx} images={images} redraw={redraw} cutLines={cutLines} />
              ) : (
                <div className="print-cards-preview">
                  {(sides === 'back' ? (['back'] as SideKey[]) : sides === 'front' ? (['front'] as SideKey[]) : (['front', 'back'] as SideKey[])).map((s) => (
                    <figure key={s}>
                      <CardThumb design={design} side={s} person={selected[0]!} ctx={ctx} images={images} redraw={redraw} width={cardSize(design.format, design.orientation).w > 60 ? 300 : 220} />
                      <figcaption className="meta">{s === 'front' ? 'Front' : 'Back'}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
              <p className="meta">A lanyard is enough to be scanned as that person, so keep spare ones secure.</p>
            </div>
          </div>
        )}
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
