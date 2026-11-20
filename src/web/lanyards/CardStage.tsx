import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CardPerson, DesignElement, LanyardDesign, SideKey } from '../../shared/lanyardDesign';
import { cardSize } from '../../shared/lanyardDesign';
import type { Guide } from './edit';
import { snapEdge, snapMove, updateElement } from './edit';
import type { CanvasImages, RenderContext } from './render';
import { renderToCanvas } from './render';

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

interface Drag {
  mode: 'move' | 'resize';
  handle?: Handle;
  id: string;
  startX: number;
  startY: number;
  orig: { x: number; y: number; w: number; h: number };
  others: { x: number; y: number; w: number; h: number }[];
  moved: boolean;
}

/**
 * The card on screen: drawn by the same renderer as the PDF, with an
 * overlay for selecting, moving (with snapping guides) and resizing.
 */
export function CardStage({
  design,
  side,
  person,
  ctx,
  images,
  redraw,
  zoom,
  selected,
  onSelect,
  onChange,
  onCommit,
  editable,
  label,
}: {
  design: LanyardDesign;
  side: SideKey;
  person: CardPerson;
  ctx: RenderContext;
  images: CanvasImages;
  /** Bumped when fonts or images finish loading. */
  redraw: number;
  zoom: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (d: LanyardDesign, live: boolean) => void;
  onCommit: () => void;
  editable: boolean;
  label: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [fit, setFit] = useState(4);
  const [guides, setGuides] = useState<Guide[]>([]);
  const drag = useRef<Drag | null>(null);
  const card = cardSize(design.format, design.orientation);
  const scale = fit * zoom; // CSS pixels per mm

  // Fit the card to the space available.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => {
      const pad = 56;
      const s = Math.min((el.clientWidth - pad) / card.w, (el.clientHeight - pad) / card.h);
      setFit(Math.max(1, s));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [card.w, card.h]);

  // Draw (sharp on high-density screens).
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const raf = requestAnimationFrame(() => renderToCanvas(c, design, side, person, ctx, images, scale * Math.min(3, window.devicePixelRatio || 1)));
    return () => cancelAnimationFrame(raf);
  }, [design, side, person, ctx, images, scale, redraw]);

  const elements = design[side].elements;

  function begin(e: ReactPointerEvent, el: DesignElement, handle?: Handle) {
    e.stopPropagation();
    onSelect(el.id);
    if (!editable || el.locked || e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = {
      mode: handle ? 'resize' : 'move',
      handle,
      id: el.id,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: el.x, y: el.y, w: el.w, h: el.h },
      others: elements.filter((o) => o.id !== el.id),
      moved: false,
    };
  }

  function move(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    if (!d.moved && Math.hypot(dx, dy) * scale < 3) return;
    d.moved = true;
    const threshold = 6 / scale;
    const el = elements.find((x) => x.id === d.id);
    if (!el) return;
    let next: { x: number; y: number; w: number; h: number };
    const lines: Guide[] = [];
    if (d.mode === 'move') {
      const raw = { ...d.orig, x: d.orig.x + dx, y: d.orig.y + dy };
      const snapped = e.altKey ? { x: raw.x, y: raw.y, guides: [] } : snapMove(raw, d.others, card, threshold);
      next = { ...raw, x: snapped.x, y: snapped.y };
      lines.push(...snapped.guides);
    } else {
      const h = d.handle!;
      let { x, y, w, h: hh } = d.orig;
      const right = x + w;
      const bottom = y + hh;
      let L = h.includes('w') ? x + dx : x;
      let R = h.includes('e') ? right + dx : right;
      let T = h.includes('n') ? y + dy : y;
      let B = h.includes('s') ? bottom + dy : bottom;
      if (!e.altKey) {
        const snapX = (v: number) => {
          const r = snapEdge(v, 'x', d.others, card, threshold);
          if (r.guide) lines.push(r.guide);
          return r.value;
        };
        const snapY = (v: number) => {
          const r = snapEdge(v, 'y', d.others, card, threshold);
          if (r.guide) lines.push(r.guide);
          return r.value;
        };
        if (h.includes('w')) L = snapX(L);
        if (h.includes('e')) R = snapX(R);
        if (h.includes('n')) T = snapY(T);
        if (h.includes('s')) B = snapY(B);
      }
      const min = 2;
      if (R - L < min) {
        if (h.includes('w')) L = R - min;
        else R = L + min;
      }
      if (B - T < min) {
        if (h.includes('n')) T = B - min;
        else B = T + min;
      }
      x = L;
      y = T;
      w = R - L;
      hh = B - T;
      // QR codes and marks stay square; Shift keeps any shape's proportions.
      const square = el.type === 'qr' || el.type === 'marker';
      if (square || e.shiftKey) {
        const ratio = square ? 1 : d.orig.w / d.orig.h;
        const corner = h.length === 2;
        if (corner || h === 'e' || h === 'w') hh = w / ratio;
        else w = hh * ratio;
        if (h.includes('n')) y = d.orig.y + d.orig.h - hh;
        if (h.includes('w')) x = d.orig.x + d.orig.w - w;
        if (h === 'n' || h === 's') x = d.orig.x + (d.orig.w - w) / 2;
        if (h === 'e' || h === 'w') y = d.orig.y + (d.orig.h - hh) / 2;
      }
      next = { x, y, w, h: hh };
    }
    const round = (v: number) => Math.round(v * 10) / 10;
    setGuides(lines);
    onChange(updateElement(design, side, d.id, { x: round(next.x), y: round(next.y), w: round(next.w), h: round(next.h) }), true);
  }

  function end() {
    if (drag.current?.moved) onCommit();
    drag.current = null;
    setGuides([]);
  }

  const sel = elements.find((e) => e.id === selected);
  return (
    <div ref={wrap} className="studio-stage" onPointerDown={() => onSelect(null)}>
      <div className="studio-card" style={{ width: card.w * scale, height: card.h * scale }} role="img" aria-label={label}>
        <canvas ref={canvas} className="studio-canvas" style={{ width: card.w * scale, height: card.h * scale }} />
        <div className="studio-overlay">
          {elements.map((el) => (
            // Pointer-only hit area. Keyboard users pick items in the Layers list and move them with the arrow keys.
            // eslint-disable-next-line jsx-a11y/no-static-element-interactions
            <div
              key={el.id}
              className={['studio-hit', el.id === selected && 'is-selected', el.locked && 'is-locked'].filter(Boolean).join(' ')}
              style={{ left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale }}
              onPointerDown={(e) => begin(e, el)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onDoubleClick={() => document.getElementById('prop-text')?.focus()}
              title={el.name ?? el.type}
            />
          ))}
          {sel && editable && !sel.locked && (
            <div className="studio-selection" style={{ left: sel.x * scale, top: sel.y * scale, width: sel.w * scale, height: sel.h * scale }}>
              {HANDLES.map((h) => (
                <span key={h} className={`studio-handle studio-handle-${h}`} onPointerDown={(e) => begin(e, sel, h)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
              ))}
            </div>
          )}
          {guides.map((g, i) => (
            <span key={i} className={`studio-guide studio-guide-${g.axis}`} style={g.axis === 'x' ? { left: g.at * scale } : { top: g.at * scale }} />
          ))}
        </div>
      </div>
    </div>
  );
}
