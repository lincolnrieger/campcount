import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode, RefObject } from 'react';
import { useRef } from 'react';
import { QrCode } from './QrCode';
import type { Box, Card, CardSize, LayoutTextKey, PhotoMarkerStyle } from '../lanyards/pdf';
import { CARD_LAYOUT, CARD_SIZES, PT_MM, bandColours, bandLabel, clampToCard, fitPt, layoutTexts } from '../lanyards/pdf';
import type { CardTextLayout } from '../../shared/schemas';

/** The crossed-out camera printed on cards of people without photo consent. */
export function NoCameraIcon({ size = '1em' }: { size?: string }) {
  return (
    <svg className="no-camera" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#fff" />
      <rect x="5" y="8" width="14" height="10" rx="1.5" fill="#000" />
      <rect x="9" y="6" width="6" height="3" rx="1" fill="#000" />
      <circle cx="12" cy="13" r="2.6" fill="#fff" />
      <path d="M4 20 20 4" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      <path d="M4 20 20 4" stroke="#000" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** The marker for someone without photo consent, for the band. */
function Marker({ card, marker }: { card: Card; marker: PhotoMarkerStyle }) {
  if (!card.noPhotos) return null;
  const badge = marker.photoMarker === 'red_dot' ? <span className="card-dot" aria-hidden="true" /> : marker.photoMarker === 'camera_icon' ? <NoCameraIcon /> : null;
  if (!badge && !marker.photoMarkerLabel) return null;
  return (
    <span className="card-marker">
      {marker.photoMarkerLabel ? <span className="card-marker-text">No photos</span> : <span className="visually-hidden">No photos</span>}
      {badge}
    </span>
  );
}

function frameStyle(card: Card, marker: PhotoMarkerStyle): { className: string; style?: CSSProperties } {
  if (!card.noPhotos) return { className: '' };
  if (marker.photoMarker === 'black_border') return { className: ' has-frame', style: { '--frame': '#000' } as CSSProperties };
  if (marker.photoMarker === 'colour_border') return { className: ' has-frame', style: { '--frame': marker.photoMarkerColour } as CSSProperties };
  return { className: '' };
}

/** A layout box as percentages of the card, for absolutely placed overlays. */
function place(box: Box, size: CardSize): CSSProperties {
  const spec = CARD_SIZES[size];
  return { left: `${(box.x / spec.w) * 100}%`, top: `${(box.y / spec.h) * 100}%`, width: `${(box.w / spec.w) * 100}%`, height: `${(box.h / spec.h) * 100}%` };
}

/** A card front on the event's own artwork: what CampCount prints, placed where the PDF puts it. */
function ArtworkFront({ card, size, marker, artwork, printBand }: { card: Card; size: CardSize; marker: PhotoMarkerStyle; artwork: string; printBand: boolean }) {
  const L = CARD_LAYOUT[size];
  const colours = bandColours(card);
  const frame = frameStyle(card, marker);
  return (
    <article className={`card-preview card-art card-art-${size}${frame.className}`} style={frame.style}>
      <img src={artwork} alt="" className="card-art-image" />
      <div className={printBand ? 'card-band card-art-band' : 'card-art-band is-tag'} style={{ ...place(L.band, size), ...(printBand ? { background: colours.bg, color: colours.fg } : {}) }}>
        <span className={printBand ? undefined : 'card-art-tag'}>{bandLabel(card)}</span>
        <Marker card={card} marker={marker} />
      </div>
      <p className="card-name card-art-text" style={place(L.name, size)}>
        {card.name}
      </p>
      <p className="card-group card-art-text" style={place(L.group, size)}>
        {card.groupName}
      </p>
      <div className="card-art-qr" style={place(L.qr, size)}>
        <QrCode value={card.qr} size="100%" label={`Scan code for ${card.name}`} />
      </div>
      <p className="card-art-text card-art-code" style={place(L.code, size)}>
        <span>{card.shortCode}</span>
      </p>
    </article>
  );
}

const FONT = 'Helvetica, Arial, sans-serif';
let measurer: CanvasRenderingContext2D | null = null;
/** Text width in mm at a point size, measured with the same font family the PDF uses. */
function widthMm(text: string, pt: number, bold: boolean): number {
  measurer ??= document.createElement('canvas').getContext('2d');
  if (!measurer) return 0;
  measurer.font = `${bold ? 'bold ' : ''}100px ${FONT}`;
  return (measurer.measureText(text).width / 100) * pt * PT_MM;
}

export type LayoutPart = LayoutTextKey | 'qr';

/** Turns pointer drags and arrow keys on the preview into new positions (mm). */
export interface LayoutEditing {
  selected: LayoutPart | null;
  onSelect: (part: LayoutPart) => void;
  onMove: (part: LayoutPart, x: number, y: number) => void;
}

const PART_WORDS: Record<LayoutPart, string> = { name: 'Name', role: 'Leader or youth', group: 'Group', code: 'Typed code', qr: 'QR code' };

/** One thing on a custom card. When editing: drag it, or select it and use the arrow keys. */
function Part({
  as: Tag,
  part,
  edit,
  size,
  cardRef,
  box,
  className,
  style,
  children,
}: {
  as: 'div' | 'p';
  part: LayoutPart;
  edit?: LayoutEditing;
  size: CardSize;
  cardRef: RefObject<HTMLElement | null>;
  box: { x: number; y: number; w: number; h: number };
  className: string;
  style: CSSProperties;
  children: ReactNode;
}) {
  const drag = useRef<{ startX: number; startY: number; id: number } | null>(null);
  if (!edit) return <Tag className={className} style={style}>{children}</Tag>;
  const spec = CARD_SIZES[size];
  return (
    <Tag
      className={className}
      style={style}
      tabIndex={0}
      role="button"
      aria-label={`${PART_WORDS[part]}. Drag, or use the arrow keys, to move it.`}
      aria-pressed={edit.selected === part}
      onPointerDown={(e: PointerEvent<HTMLElement>) => {
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        edit.onSelect(part);
        drag.current = { startX: e.clientX, startY: e.clientY, id: e.pointerId };
        e.currentTarget.dataset.x = String(box.x);
        e.currentTarget.dataset.y = String(box.y);
      }}
      onPointerMove={(e: PointerEvent<HTMLElement>) => {
        const d = drag.current;
        const rect = cardRef.current?.getBoundingClientRect();
        if (!d || d.id !== e.pointerId || !rect) return;
        const perMm = rect.width / spec.w;
        const x0 = Number(e.currentTarget.dataset.x);
        const y0 = Number(e.currentTarget.dataset.y);
        const next = clampToCard(size, x0 + (e.clientX - d.startX) / perMm, y0 + (e.clientY - d.startY) / perMm, box.w, box.h);
        edit.onMove(part, Math.round(next.x * 2) / 2, Math.round(next.y * 2) / 2);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onKeyDown={(e: KeyboardEvent<HTMLElement>) => {
        const step = e.shiftKey ? 5 : 0.5;
        const delta = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, [number, number]>)[e.key];
        if (!delta) return;
        e.preventDefault();
        edit.onSelect(part);
        const next = clampToCard(size, box.x + delta[0], box.y + delta[1], box.w, box.h);
        edit.onMove(part, next.x, next.y);
      }}
    >
      {children}
    </Tag>
  );
}

/** A card front laid out by the event's own text settings, on its artwork (or plain white). Editable when `edit` is given. */
export function CustomFront({
  card,
  size,
  marker,
  artwork,
  layout,
  edit,
}: {
  card: Card;
  size: CardSize;
  marker: PhotoMarkerStyle;
  artwork?: string | null;
  layout: CardTextLayout;
  edit?: LayoutEditing;
}) {
  const spec = CARD_SIZES[size];
  const frame = frameStyle(card, marker);
  const ref = useRef<HTMLElement>(null);
  const pctX = (mm: number) => `${(mm / spec.w) * 100}%`;
  const pctY = (mm: number) => `${(mm / spec.h) * 100}%`;
  const cqw = (mm: number) => `${(mm / spec.w) * 100}cqw`;

  const boxOf = (part: LayoutPart) => (part === 'qr' ? { x: layout.qr.x, y: layout.qr.y, w: layout.qr.size, h: layout.qr.size } : { ...layout[part], h: layout[part].size * PT_MM });

  const cls = (part: LayoutPart, base: string) => [base, edit ? 'is-editable' : '', edit?.selected === part ? 'is-selected' : ''].filter(Boolean).join(' ');
  const showBadge = card.noPhotos && (marker.photoMarker === 'red_dot' || marker.photoMarker === 'camera_icon');
  const showLabel = card.noPhotos && marker.photoMarkerLabel;
  const safe = CARD_LAYOUT[size].safe;

  return (
    <article ref={ref} className={`card-preview card-art card-art-${size} card-custom${frame.className}`} style={frame.style}>
      {artwork && <img src={artwork} alt="" className="card-art-image" />}
      <Part
        as="div"
        part="qr"
        edit={edit}
        size={size}
        cardRef={ref}
        box={boxOf('qr')}
        className={cls('qr', 'card-art-qr card-custom-qr')}
        style={{ left: pctX(layout.qr.x), top: pctY(layout.qr.y), width: pctX(layout.qr.size) }}
      >
        <QrCode value={card.qr} size="100%" label={`Scan code for ${card.name}`} />
      </Part>
      {layoutTexts(layout, card).map(({ key, text, p }) => {
        const pt = fitPt(text, p, widthMm);
        return (
          <Part
            as="p"
            key={key}
            part={key}
            edit={edit}
            size={size}
            cardRef={ref}
            box={boxOf(key)}
            className={cls(key, `card-custom-text${key === 'code' ? ' card-custom-code' : ''}`)}
            style={{
              left: pctX(p.x),
              top: pctY(p.y),
              width: pctX(p.w),
              height: pctY(p.size * PT_MM),
              justifyContent: p.align === 'left' ? 'flex-start' : p.align === 'right' ? 'flex-end' : 'center',
              fontSize: cqw(pt * PT_MM),
              fontWeight: p.bold ? 700 : 400,
              color: p.colour,
            }}
          >
            <span>{text}</span>
          </Part>
        );
      })}
      {(showBadge || showLabel) && (
        <span className="card-marker card-custom-marker" style={{ top: pctY(safe), right: pctX(safe) }}>
          {showLabel ? <span className="card-marker-text">No photos</span> : <span className="visually-hidden">No photos</span>}
          {marker.photoMarker === 'red_dot' ? <span className="card-dot" aria-hidden="true" /> : marker.photoMarker === 'camera_icon' ? <NoCameraIcon /> : null}
        </span>
      )}
    </article>
  );
}

/** On-screen preview of one card's front, drawn to the same layout as the PDF. */
export function LanyardCard({
  card,
  size = 'lanyard',
  marker,
  artwork,
  printBand = true,
  layout,
}: {
  card: Card;
  size?: CardSize;
  marker: PhotoMarkerStyle;
  /** The event's uploaded front artwork, if any. */
  artwork?: string | null;
  printBand?: boolean;
  /** Text the event placed itself for this size. */
  layout?: CardTextLayout | null;
}) {
  if (layout) return <CustomFront card={card} size={size} marker={marker} artwork={artwork} layout={layout} />;
  if (artwork) return <ArtworkFront card={card} size={size} marker={marker} artwork={artwork} printBand={printBand} />;
  const colours = bandColours(card);
  const band = { background: colours.bg, color: colours.fg };
  const frame = frameStyle(card, marker);
  if (size === 'badge') {
    return (
      <article className={`card-preview card-badge${frame.className}`} style={frame.style}>
        <div className="card-band" style={band}>
          <span>{bandLabel(card)}</span>
          <Marker card={card} marker={marker} />
        </div>
        <div className="card-badge-body">
          <div>
            <p className="card-name">{card.name}</p>
            <p className="card-group">{card.groupName}</p>
            <p className="card-code">{card.shortCode}</p>
          </div>
          <QrCode value={card.qr} size="100%" label={`Scan code for ${card.name}`} />
        </div>
      </article>
    );
  }
  return (
    <article className={`card-preview card-lanyard${frame.className}`} style={frame.style}>
      <div className="card-band" style={band}>
        <span>{bandLabel(card)}</span>
        <Marker card={card} marker={marker} />
      </div>
      <div className="card-body">
        <p className="card-name">{card.name}</p>
        <p className="card-group">{card.groupName}</p>
        <div className="card-qr">
          <QrCode value={card.qr} size="100%" label={`Scan code for ${card.name}`} />
        </div>
        <p className="card-code">{card.shortCode}</p>
      </div>
    </article>
  );
}

/** The back of a card: the camp's logo, its name and what to do if found. */
export function LanyardBack({
  card,
  size = 'lanyard',
  marker,
  eventName,
  logoUrl,
  artwork,
}: {
  card: Card;
  size?: CardSize;
  marker: PhotoMarkerStyle;
  eventName: string;
  logoUrl: string | null;
  /** The event's uploaded back artwork, if any: it fills the back. */
  artwork?: string | null;
}) {
  const frame = frameStyle(card, marker);
  if (artwork)
    return (
      <article className={`card-preview card-art card-art-${size}${frame.className}`} style={frame.style} aria-label={`Back of ${card.name}'s card`}>
        <img src={artwork} alt="" className="card-art-image" />
      </article>
    );
  return (
    <article className={`card-preview card-back card-back-${size}${frame.className}`} style={frame.style} aria-label={`Back of ${card.name}'s card`}>
      <div className="card-back-inner">
        {logoUrl && <img src={logoUrl} alt="" className="card-back-logo" />}
        <div>
          <p className="card-back-name">{eventName}</p>
          <p className="card-back-note">If found, please hand to a camp leader.</p>
        </div>
      </div>
    </article>
  );
}
