import qrcode from 'qrcode-generator';
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';
import type { CardTextLayout, TextPlacement } from '../../shared/schemas';

export interface Card {
  registrationId: string;
  name: string;
  kind: 'youth' | 'adult';
  section: string;
  groupName: string;
  shortCode: string;
  qr: string;
  /** No photo consent on file (only sent when the event uses photo consent). */
  noPhotos?: boolean;
}

export type CardSize = 'lanyard' | 'badge';

export const CARD_SIZES: Record<CardSize, { label: string; w: number; h: number; cols: number; rows: number }> = {
  lanyard: { label: 'Lanyard, 90×120 mm, 4 per A4', w: 90, h: 120, cols: 2, rows: 2 },
  badge: { label: 'Wallet, 86×54 mm, 10 per A4', w: 86, h: 54, cols: 2, rows: 5 },
};

/** Scouts Australia section colours; the word is always printed too. */
export const SECTION_COLOURS: Record<string, { bg: string; fg: string }> = {
  Scout: { bg: '#00843d', fg: '#ffffff' },
  Venturer: { bg: '#7a1f3d', fg: '#ffffff' },
  Rover: { bg: '#c8102e', fg: '#ffffff' },
  Leader: { bg: '#1f4d3f', fg: '#ffffff' },
};

/** The one word on the card's band: Scout, Venturer, Rover or Leader, nothing else. */
export function bandLabel(card: Pick<Card, 'kind' | 'section'>): string {
  if (card.kind === 'adult') return 'Leader';
  const s = card.section.toLowerCase();
  if (s.startsWith('rover')) return 'Rover';
  if (s.startsWith('venturer')) return 'Venturer';
  // Only four words ever print: every other young person is a Scout.
  return 'Scout';
}

export function bandColours(card: Pick<Card, 'kind' | 'section'>) {
  return SECTION_COLOURS[bandLabel(card)]!;
}

/** How someone without photo consent is marked, from the event's lanyard settings. */
export interface PhotoMarkerStyle {
  photoMarker: 'black_border' | 'colour_border' | 'red_dot' | 'camera_icon' | 'none';
  photoMarkerColour: string;
  photoMarkerLabel: boolean;
}

/** Uploaded artwork for one side of the card: PNG or JPEG bytes. */
export interface Artwork {
  bytes: Uint8Array;
  type: 'image/png' | 'image/jpeg';
}

export interface PdfOptions {
  marker: PhotoMarkerStyle;
  /** Print a back for every card (for double-sided printing, flip on the long edge). */
  doubleSided: boolean;
  /** The camp's logo as PNG bytes, for the built-in back. */
  logoPng: Uint8Array | null;
  /** The event's own artwork, drawn behind what CampCount prints. */
  artwork?: { front?: Artwork | null; back?: Artwork | null };
  /** With front artwork: print the coloured section band over it, or only the section word. */
  printBand?: boolean;
  /** Text the event placed itself for this card size. Replaces the built-in front layout (and the band). */
  layout?: CardTextLayout | null;
}

/** A box on the card, in millimetres from the top-left corner. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where CampCount prints each thing, in mm from the card's top-left corner.
 * The PDF, the on-screen preview and the blank template all use these, so
 * artwork made on the template lines up with what's printed.
 */
export const CARD_LAYOUT: Record<CardSize, { band: Box; punch: Box | null; name: Box; group: Box; qr: Box; code: Box; safe: number; frame: number }> = {
  lanyard: {
    band: { x: 0, y: 0, w: 90, h: 20 },
    punch: { x: 38, y: 3, w: 14, h: 3 },
    name: { x: 5, y: 25, w: 80, h: 10 },
    group: { x: 5, y: 36.5, w: 80, h: 4.5 },
    qr: { x: 17, y: 49, w: 56, h: 56 },
    code: { x: 5, y: 109, w: 80, h: 6 },
    safe: 4,
    frame: 3.5,
  },
  badge: {
    band: { x: 0, y: 0, w: 86, h: 9 },
    punch: null,
    name: { x: 4, y: 11, w: 38, h: 8 },
    group: { x: 4, y: 20, w: 38, h: 4 },
    qr: { x: 48, y: 15, w: 34, h: 34 },
    code: { x: 4, y: 44, w: 38, h: 5 },
    safe: 3,
    frame: 2.5,
  },
};

// ---------------------------------------------------------------- text the event places itself

/** Millimetres per point. */
export const PT_MM = 25.4 / 72;
/** Where the baseline sits below the top of a 1 em line (Helvetica / Arial with line-height 1). */
const BASELINE_EM = 0.847;

/** Starting point for "Place the text myself": the built-in positions, as editable settings. */
export function defaultTextLayout(size: CardSize): CardTextLayout {
  const L = CARD_LAYOUT[size];
  const lanyard = size === 'lanyard';
  const align = lanyard ? ('centre' as const) : ('left' as const);
  const text = (box: Box, pt: number, bold: boolean, a = align): TextPlacement => ({
    show: true,
    x: box.x,
    // Centre the line in the old box.
    y: Math.max(0, +(box.y + (box.h - pt * PT_MM) / 2).toFixed(1)),
    w: box.w,
    size: pt,
    colour: '#000000',
    align: a,
    bold,
  });
  return {
    name: text(L.name, lanyard ? 26 : 17, true),
    role: {
      ...text({ x: L.name.x, y: lanyard ? 6 : 1.5, w: L.name.w, h: lanyard ? 8 : 6 }, lanyard ? 18 : 11, true, 'left'),
      adultColour: '#1F4D3F',
      colour: '#00843D',
      adultWord: 'Leader',
      youthWord: 'Youth',
      youthUsesSection: false,
    },
    group: text(L.group, lanyard ? 10 : 7.5, false),
    qr: { x: L.qr.x, y: L.qr.y, size: L.qr.w },
    code: text(L.code, lanyard ? 12 : 10, true),
  };
}

export type LayoutTextKey = 'name' | 'role' | 'group' | 'code';

/** The word printed for someone's role: the leader word for adults, otherwise the youth word or their section. */
export function roleWord(card: Pick<Card, 'kind' | 'section'>, role: CardTextLayout['role']): string {
  if (card.kind === 'adult') return role.adultWord;
  return role.youthUsesSection ? bandLabel(card) : role.youthWord;
}

/** Each line of text on a card under a custom layout, with its colour worked out. */
export function layoutTexts(layout: CardTextLayout, card: Card): { key: LayoutTextKey; text: string; p: TextPlacement }[] {
  const role = { ...layout.role, colour: card.kind === 'adult' ? layout.role.adultColour : layout.role.colour };
  const all: { key: LayoutTextKey; text: string; p: TextPlacement }[] = [
    { key: 'role', text: roleWord(card, layout.role), p: role },
    { key: 'name', text: card.name, p: layout.name },
    { key: 'group', text: card.groupName, p: layout.group },
    { key: 'code', text: card.shortCode, p: { ...layout.code, show: true } },
  ];
  return all.filter((t) => t.p.show && t.text);
}

/** Font size that fits the text in its box: shrinks long names down to just over half the chosen size. */
export function fitPt(text: string, p: TextPlacement, widthMm: (text: string, pt: number, bold: boolean) => number): number {
  let pt = p.size;
  const min = Math.max(4, p.size * 0.55);
  while (pt > min && widthMm(text, pt, p.bold) > p.w) pt -= 0.5;
  return pt;
}

/** Keep a box on the card. */
export function clampToCard(size: CardSize, x: number, y: number, w: number, h: number): { x: number; y: number } {
  const spec = CARD_SIZES[size];
  return { x: Math.min(Math.max(0, x), Math.max(0, spec.w - w)), y: Math.min(Math.max(0, y), Math.max(0, spec.h - h)) };
}

/** The camp logo, redrawn as a PNG (the PDF library can't read WebP). Null if there isn't one or it won't load. */
export async function loadLogoPng(url: string | null): Promise<Uint8Array | null> {
  if (!url) return null;
  try {
    const blob = await (await fetch(url, { credentials: 'same-origin' })).blob();
    const bitmap = await createImageBitmap(blob);
    const side = Math.min(1024, Math.max(bitmap.width, bitmap.height));
    const scale = side / Math.max(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return png ? new Uint8Array(await png.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

const MM = 72 / 25.4;
const A4 = { w: 210 * MM, h: 297 * MM };

/** Standard PDF fonts only cover Western European characters; map the rest to close equivalents. */
function pdfSafe(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
}

function fit(font: PDFFont, text: string, max: number, size: number, min: number): number {
  let s = size;
  while (s > min && font.widthOfTextAtSize(text, s) > max) s -= 0.5;
  return s;
}

function truncate(font: PDFFont, text: string, max: number, size: number): string {
  if (font.widthOfTextAtSize(text, size) <= max) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > max) t = t.slice(0, -1);
  return `${t}...`;
}

/** Build a print-ready A4 PDF of lanyard cards. Runs entirely in the browser. */
export async function buildLanyardPdf(cards: Card[], size: CardSize, eventName: string, options: PdfOptions): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const doc = await PDFDocument.create();
  doc.setTitle(`${pdfSafe(eventName)} lanyards`);
  doc.setCreator('CampCount');
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const logo = options.doubleSided && options.logoPng ? await doc.embedPng(options.logoPng).catch(() => null) : null;
  const spec = CARD_SIZES[size];
  const w = spec.w * MM;
  const h = spec.h * MM;
  const gap = 4 * MM;
  const left = (A4.w - spec.cols * w - (spec.cols - 1) * gap) / 2;
  const top = A4.h - (A4.h - spec.rows * h - (spec.rows - 1) * gap) / 2;
  const perPage = spec.cols * spec.rows;
  const lanyard = size === 'lanyard';
  const { marker } = options;
  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);

  /** Where a card sits on the sheet. Backs mirror the columns so they line up when flipped on the long edge. */
  const slotXY = (slot: number, back: boolean) => {
    const col = slot % spec.cols;
    const x = left + (back ? spec.cols - 1 - col : col) * (w + gap);
    const y = top - Math.floor(slot / spec.cols) * (h + gap) - h;
    return { x, y };
  };

  const cutLine = (p: PDFPage, x: number, y: number) =>
    p.drawRectangle({ x, y, width: w, height: h, borderColor: hex('#9a9a9a'), borderWidth: 0.6, borderDashArray: [3, 3] });

  /** A thick frame inside the cut line: the no-photos border, on both sides of the card. */
  const frame = (p: PDFPage, x: number, y: number, card: Card) => {
    if (!card.noPhotos) return;
    if (marker.photoMarker !== 'black_border' && marker.photoMarker !== 'colour_border') return;
    const t = (lanyard ? 3.5 : 2.5) * MM;
    const colour = marker.photoMarker === 'black_border' ? black : hex(marker.photoMarkerColour);
    p.drawRectangle({ x: x + t / 2, y: y + t / 2, width: w - t, height: h - t, borderColor: colour, borderWidth: t });
  };

  /** The red dot or crossed-out camera, top right of the band. */
  const badge = (p: PDFPage, cx: number, cy: number, r: number) => {
    if (marker.photoMarker === 'red_dot') {
      p.drawCircle({ x: cx, y: cy, size: r + 1, color: white });
      p.drawCircle({ x: cx, y: cy, size: r, color: hex('#D0021B') });
    } else if (marker.photoMarker === 'camera_icon') {
      p.drawCircle({ x: cx, y: cy, size: r + 1, color: white });
      const bw = r * 1.15;
      const bh = r * 0.8;
      p.drawRectangle({ x: cx - bw / 2, y: cy - bh / 2 - r * 0.08, width: bw, height: bh, color: black });
      p.drawRectangle({ x: cx - bw * 0.2, y: cy + bh / 2 - r * 0.1, width: bw * 0.4, height: r * 0.22, color: black });
      p.drawCircle({ x: cx, y: cy - r * 0.08, size: bh * 0.3, color: white });
      p.drawLine({ start: { x: cx - r * 0.75, y: cy - r * 0.75 }, end: { x: cx + r * 0.75, y: cy + r * 0.75 }, thickness: r * 0.22, color: white });
      p.drawLine({ start: { x: cx - r * 0.75, y: cy - r * 0.75 }, end: { x: cx + r * 0.75, y: cy + r * 0.75 }, thickness: r * 0.12, color: black });
    }
  };

  const drawQr = (p: PDFPage, value: string, qx: number, qy: number, side: number) => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const cell = side / n;
    p.drawRectangle({ x: qx - 2 * cell, y: qy - 2 * cell, width: side + 4 * cell, height: side + 4 * cell, color: white });
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) p.drawRectangle({ x: qx + c * cell, y: qy + (n - 1 - r) * cell, width: cell + 0.05, height: cell + 0.05, color: black });
      }
    }
  };

  const L = CARD_LAYOUT[size];
  const embed = async (a: Artwork | null | undefined) => (!a ? null : a.type === 'image/png' ? doc.embedPng(a.bytes) : doc.embedJpg(a.bytes));
  const frontArt = await embed(options.artwork?.front).catch(() => null);
  const backArt = options.doubleSided ? await embed(options.artwork?.back).catch(() => null) : null;
  const printBand = !frontArt || options.printBand !== false;

  /** A box from the layout (mm from the top-left) as PDF coordinates (points from the bottom-left). */
  const at = (x: number, y: number, box: Box) => ({ x: x + box.x * MM, y: y + h - (box.y + box.h) * MM, w: box.w * MM, h: box.h * MM });
  /** Text baseline inside a box: a little above its bottom edge. */
  const baseline = (r: { y: number; h: number }, sizePt: number) => r.y + (r.h - sizePt * 0.72) / 2;

  const custom = options.layout ?? null;

  /** No-photo dot / camera and "No photos" in the top-right corner, for custom layouts (there's no band). */
  const cornerMarker = (p: PDFPage, card: Card, x: number, y: number) => {
    if (!card.noPhotos) return;
    const showBadge = marker.photoMarker === 'red_dot' || marker.photoMarker === 'camera_icon';
    const r = (lanyard ? 4 : 2.6) * MM;
    const pad = L.safe * MM;
    let right = x + w - pad;
    const cy = y + h - pad - r;
    if (showBadge) {
      badge(p, right - r, cy, r);
      right -= 2 * r + 1.5 * MM;
    }
    if (marker.photoMarkerLabel) {
      const t = 'No photos';
      const ts = lanyard ? 9 : 7.5;
      const tw = bold.widthOfTextAtSize(t, ts);
      p.drawRectangle({ x: right - tw - 1 * MM, y: cy - ts * 0.36 - 1 * MM, width: tw + 2 * MM, height: ts * 0.72 + 2 * MM, color: white });
      p.drawText(t, { x: right - tw, y: cy - ts * 0.36, size: ts, font: bold, color: black });
    }
  };

  const customFront = (p: PDFPage, card: Card, x: number, y: number, layout: CardTextLayout) => {
    if (frontArt) p.drawImage(frontArt, { x, y, width: w, height: h });
    const q = layout.qr;
    drawQr(p, card.qr, x + q.x * MM, y + h - (q.y + q.size) * MM, q.size * MM);
    for (const t of layoutTexts(layout, card)) {
      const font = t.p.bold ? bold : regular;
      const text = pdfSafe(t.text);
      const pt = fitPt(text, t.p, (s, size, b) => (b ? bold : regular).widthOfTextAtSize(s, size) / MM);
      const shown = truncate(font, text, t.p.w * MM, pt);
      const tw = font.widthOfTextAtSize(shown, pt);
      const boxX = x + t.p.x * MM;
      const tx = t.p.align === 'left' ? boxX : t.p.align === 'right' ? boxX + t.p.w * MM - tw : boxX + (t.p.w * MM - tw) / 2;
      const lineH = t.p.size * PT_MM;
      const top = t.p.y + (lineH - pt * PT_MM) / 2;
      const ty = y + h - (top + pt * PT_MM * BASELINE_EM) * MM;
      if (t.key === 'code') {
        // Keep the typed code readable on any artwork.
        p.drawRectangle({ x: tx - 1.5 * MM, y: y + h - (t.p.y + lineH) * MM - 0.6 * MM, width: tw + 3 * MM, height: lineH * MM + 1.2 * MM, color: white });
      }
      p.drawText(shown, { x: tx, y: ty, size: pt, font, color: hex(t.p.colour) });
    }
    cornerMarker(p, card, x, y);
  };

  const front = (p: PDFPage, card: Card, x: number, y: number) => {
    if (custom) return customFront(p, card, x, y, custom);
    const colours = bandColours(card);
    const name = pdfSafe(card.name);
    const group = pdfSafe(card.groupName);
    const label = bandLabel(card);
    const framed = card.noPhotos && (marker.photoMarker === 'black_border' || marker.photoMarker === 'colour_border');
    const inset = framed ? L.frame * MM : 0;
    const showLabel = card.noPhotos && marker.photoMarkerLabel;
    const showBadge = card.noPhotos && (marker.photoMarker === 'red_dot' || marker.photoMarker === 'camera_icon');

    if (frontArt) p.drawImage(frontArt, { x, y, width: w, height: h });

    // Section band (or, over artwork that has its own band, the word on a white tag).
    const band = at(x, y, L.band);
    const labelSize = lanyard ? 18 : 11;
    const pad = (lanyard ? 5 : 4) * MM;
    const textY = band.y + (band.h - labelSize * 0.72) / 2 - (lanyard ? 0 : 0.3 * MM) - inset / 2;
    if (printBand) {
      p.drawRectangle({ x: band.x + inset, y: band.y - inset, width: band.w - 2 * inset, height: band.h, color: hex(colours.bg) });
      p.drawText(label, { x: band.x + inset + pad, y: textY, size: labelSize, font: bold, color: hex(colours.fg) });
    } else {
      const tw = bold.widthOfTextAtSize(label, labelSize);
      p.drawRectangle({ x: band.x + inset + pad - 1.5 * MM, y: textY - 1.5 * MM, width: tw + 3 * MM, height: labelSize * 0.72 + 3 * MM, color: white });
      p.drawText(label, { x: band.x + inset + pad, y: textY, size: labelSize, font: bold, color: black });
    }
    const markColour = printBand ? hex(colours.fg) : black;
    if (L.punch && !frontArt) {
      const r = at(x, y, L.punch);
      p.drawRectangle({ x: r.x, y: r.y - inset, width: r.w, height: r.h, borderColor: hex(colours.fg), borderWidth: 0.6, opacity: 0, borderOpacity: 0.6 });
    }
    let right = band.x + band.w - inset - pad;
    const r = (lanyard ? 4 : 2.6) * MM;
    if (showBadge) {
      badge(p, right - r, band.y + band.h / 2 - inset / 2, r);
      right -= 2 * r + 2 * MM;
    }
    if (showLabel) {
      const t = 'No photos';
      const ts = lanyard ? 9 : 7.5;
      const tw = bold.widthOfTextAtSize(t, ts);
      if (!printBand) p.drawRectangle({ x: right - tw - 1 * MM, y: textY - 1 * MM, width: tw + 2 * MM, height: ts * 0.72 + 2 * MM, color: white });
      p.drawText(t, { x: right - tw, y: textY + (lanyard ? 0.5 * MM : 0), size: ts, font: bold, color: markColour });
    }

    const centred = lanyard;
    const nb = at(x, y, L.name);
    const nameSize = fit(bold, name, nb.w - 2 * inset, lanyard ? 26 : 17, lanyard ? 14 : 9);
    const nx = centred ? x + (w - bold.widthOfTextAtSize(name, nameSize)) / 2 : nb.x + inset;
    p.drawText(name, { x: nx, y: baseline(nb, nameSize), size: nameSize, font: bold });
    const gb = at(x, y, L.group);
    const gs = lanyard ? 10 : 7.5;
    const g = truncate(regular, group, gb.w - 2 * inset, gs);
    p.drawText(g, { x: centred ? x + (w - regular.widthOfTextAtSize(g, gs)) / 2 : gb.x + inset, y: baseline(gb, gs), size: gs, font: regular });

    const qb = at(x, y, L.qr);
    const shrink = framed ? (lanyard ? 4 : 3) * MM : 0;
    drawQr(p, card.qr, qb.x + shrink / 2 - (centred ? 0 : inset), qb.y + shrink / 2 + inset / 2, qb.w - shrink);

    const cb = at(x, y, L.code);
    const cs = lanyard ? 12 : 10;
    const code = lanyard ? card.shortCode.split('').join(' ') : card.shortCode;
    if (frontArt) {
      // Keep the typed code readable on any artwork.
      const cw = bold.widthOfTextAtSize(code, cs);
      const cx = centred ? x + (w - cw) / 2 : cb.x + inset;
      p.drawRectangle({ x: cx - 1.5 * MM, y: baseline(cb, cs) - 1.2 * MM, width: cw + 3 * MM, height: cs * 0.72 + 2.4 * MM, color: white });
    }
    p.drawText(code, { x: centred ? x + (w - bold.widthOfTextAtSize(code, cs)) / 2 : cb.x + inset, y: baseline(cb, cs) + (lanyard ? inset / 2 : inset / 2), size: cs, font: bold });
  };

  const back = (p: PDFPage, x: number, y: number) => {
    if (backArt) {
      p.drawImage(backArt, { x, y, width: w, height: h });
      return;
    }
    const ev = pdfSafe(eventName);
    const note = 'If found, please hand to a camp leader.';
    if (lanyard) {
      const side = 62 * MM;
      if (logo) {
        const s = Math.min(side / logo.width, side / logo.height);
        p.drawImage(logo, { x: x + (w - logo.width * s) / 2, y: y + h - 16 * MM - logo.height * s, width: logo.width * s, height: logo.height * s });
      }
      const evSize = fit(bold, ev, w - 12 * MM, 16, 10);
      p.drawText(ev, { x: x + (w - bold.widthOfTextAtSize(ev, evSize)) / 2, y: y + (logo ? 24 * MM : h / 2), size: evSize, font: bold });
      p.drawText(note, { x: x + (w - regular.widthOfTextAtSize(note, 8)) / 2, y: y + 9 * MM, size: 8, font: regular, color: hex('#444444') });
    } else {
      const side = 34 * MM;
      if (logo) {
        const s = Math.min(side / logo.width, side / logo.height);
        p.drawImage(logo, { x: x + 6 * MM, y: y + (h - logo.height * s) / 2, width: logo.width * s, height: logo.height * s });
      }
      const tx = x + (logo ? 44 : 6) * MM;
      const tw = x + w - 5 * MM - tx;
      const evSize = fit(bold, ev, tw, 13, 8);
      p.drawText(truncate(bold, ev, tw, evSize), { x: tx, y: y + h / 2 + 2 * MM, size: evSize, font: bold });
      p.drawText(truncate(regular, note, tw, 6.5), { x: tx, y: y + h / 2 - 4 * MM, size: 6.5, font: regular, color: hex('#444444') });
    }
  };

  for (let start = 0; start < cards.length; start += perPage) {
    const pageCards = cards.slice(start, start + perPage);
    const fronts = doc.addPage([A4.w, A4.h]);
    pageCards.forEach((card, slot) => {
      const { x, y } = slotXY(slot, false);
      front(fronts, card, x, y);
      frame(fronts, x, y, card);
      // Last, so it shows over artwork that runs to the edge.
      cutLine(fronts, x, y);
    });
    if (options.doubleSided) {
      const backs = doc.addPage([A4.w, A4.h]);
      pageCards.forEach((card, slot) => {
        const { x, y } = slotXY(slot, true);
        back(backs, x, y);
        frame(backs, x, y, card);
        cutLine(backs, x, y);
      });
    }
  }

  return doc.save();
}

// ---------------------------------------------------------------- blank template

export type CardSide = 'front' | 'back';

/** Pixel size for artwork at 300 dpi, which prints sharply. */
export function artworkPixels(size: CardSize): { w: number; h: number } {
  const spec = CARD_SIZES[size];
  return { w: Math.round((spec.w / 25.4) * 300), h: Math.round((spec.h / 25.4) * 300) };
}

interface Guide {
  box: Box;
  kind: 'cut' | 'safe' | 'frame' | 'zone' | 'keep-clear';
  label?: string;
}

/** The pencilled-in guides on the blank template: where CampCount prints, and where to keep important artwork. */
function guides(size: CardSize, side: CardSide, layout: CardTextLayout | null = null): Guide[] {
  const spec = CARD_SIZES[size];
  const L = CARD_LAYOUT[size];
  const card = { x: 0, y: 0, w: spec.w, h: spec.h };
  const inside = (m: number) => ({ x: m, y: m, w: spec.w - 2 * m, h: spec.h - 2 * m });
  const list: Guide[] = [
    { box: card, kind: 'cut', label: 'Cut line: the edge of the card' },
    { box: inside(L.frame), kind: 'frame', label: '' },
    { box: inside(L.safe), kind: 'safe', label: '' },
  ];
  if (side === 'back') return list;
  if (layout) {
    // The event's own layout: a box where each thing prints.
    const line = (p: TextPlacement) => ({ x: p.x, y: p.y, w: p.w, h: p.size * PT_MM });
    if (layout.role.show) list.push({ box: line(layout.role), kind: 'zone', label: 'Leader / youth' });
    if (layout.name.show) list.push({ box: line(layout.name), kind: 'zone', label: 'Name' });
    if (layout.group.show) list.push({ box: line(layout.group), kind: 'zone', label: 'Scout group' });
    list.push({ box: { x: layout.qr.x - 1, y: layout.qr.y - 1, w: layout.qr.size + 2, h: layout.qr.size + 2 }, kind: 'keep-clear', label: 'QR code: keep this white' });
    list.push({ box: line(layout.code), kind: 'zone', label: 'Typed code' });
    return list;
  }
  const lanyard = size === 'lanyard';
  list.push({ box: L.band, kind: 'zone', label: lanyard ? 'Section band: Scout / Venturer / Rover / Leader' : 'Section band' });
  if (L.punch) list.push({ box: L.punch, kind: 'keep-clear', label: '' });
  list.push({ box: L.name, kind: 'zone', label: 'Name' });
  list.push({ box: L.group, kind: 'zone', label: 'Scout group' });
  list.push({ box: { x: L.qr.x - 2, y: L.qr.y - 2, w: L.qr.w + 4, h: L.qr.h + 4 }, kind: 'keep-clear', label: lanyard ? 'QR code: keep this white' : 'QR code' });
  list.push({ box: L.code, kind: 'zone', label: 'Typed code' });
  return list;
}

const NOTES: Record<CardSide, string[]> = {
  front: [
    'CampCount prints the name, group, QR code, code and section on top of your design.',
    'Keep the QR area plain white. Hide these guides before you export.',
  ],
  back: ['Your design fills the whole back. Keep words inside the dashed line.', 'A no-photo border, if you use one, prints around the edge.'],
};

/** Where the FRONT/BACK tag and the notes sit on the template (mm), clear of the guides. */
const TAG_AT: Record<CardSize, Record<CardSide, { x: number; y: number }>> = {
  lanyard: { front: { x: 6, y: 17.5 }, back: { x: 6, y: 9 } },
  badge: { front: { x: 3.5, y: 7.4 }, back: { x: 4, y: 7 } },
};
const NOTES_AT: Record<CardSize, Record<CardSide, { x: number; y: number[] } | null>> = {
  lanyard: { front: { x: 45, y: [43, 45.6] }, back: { x: 45, y: [58, 61] } },
  badge: { front: null, back: { x: 43, y: [26, 29] } },
};

/** The blank template as a PDF: one page per side, each exactly the size of a card. Opens in Illustrator, Affinity, Canva… */
export async function buildTemplatePdf(size: CardSize, layout: CardTextLayout | null = null): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(`CampCount ${size === 'lanyard' ? 'lanyard' : 'wallet card'} template`);
  doc.setCreator('CampCount');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const spec = CARD_SIZES[size];
  const W = spec.w * MM;
  const H = spec.h * MM;
  const grey = rgb(0.55, 0.55, 0.55);
  const blue = rgb(0.12, 0.37, 0.66);
  for (const side of ['front', 'back'] as const) {
    const p = doc.addPage([W, H]);
    const r = (b: Box) => ({ x: b.x * MM, y: H - (b.y + b.h) * MM, width: b.w * MM, height: b.h * MM });
    for (const g of guides(size, side, layout)) {
      const rect = r(g.box);
      if (g.kind === 'cut') p.drawRectangle({ ...rect, borderColor: rgb(0, 0, 0), borderWidth: 0.75 });
      else if (g.kind === 'frame') p.drawRectangle({ ...rect, borderColor: grey, borderWidth: 0.4, borderDashArray: [1, 2] });
      else if (g.kind === 'safe') p.drawRectangle({ ...rect, borderColor: blue, borderWidth: 0.5, borderDashArray: [4, 3] });
      else if (g.kind === 'keep-clear') p.drawRectangle({ ...rect, color: rgb(1, 1, 1), borderColor: grey, borderWidth: 0.5 });
      else p.drawRectangle({ ...rect, color: rgb(0.9, 0.94, 0.92), opacity: 0.6, borderColor: grey, borderWidth: 0.5, borderDashArray: [2, 2] });
      if (g.label) {
        const ts = 6;
        const label = g.kind === 'cut' ? '' : g.label;
        if (label) p.drawText(label, { x: rect.x + (rect.width - font.widthOfTextAtSize(label, ts)) / 2, y: rect.y + rect.height / 2 - 2, size: ts, font, color: grey });
      }
    }
    const tag = TAG_AT[size][side];
    p.drawText(side === 'front' ? 'FRONT' : 'BACK', { x: tag.x * MM, y: H - tag.y * MM, size: 7, font: bold, color: blue });
    const at = layout && side === 'front' ? null : NOTES_AT[size][side];
    if (at)
      NOTES[side].forEach((line, i) => {
        const ts = 5;
        p.drawText(line, { x: at.x * MM - font.widthOfTextAtSize(line, ts) / 2, y: H - at.y[i]! * MM, size: ts, font, color: blue });
      });
  }
  return doc.save();
}

/** One side of the blank template as a 300 dpi PNG, for design tools that prefer images. */
export async function buildTemplatePng(size: CardSize, side: CardSide, layout: CardTextLayout | null = null): Promise<Blob> {
  const { w, h } = artworkPixels(size);
  const px = w / CARD_SIZES[size].w; // pixels per mm
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const guide of guides(size, side, layout)) {
    const { x, y, w: bw, h: bh } = guide.box;
    g.setLineDash([]);
    g.lineWidth = px * 0.25;
    if (guide.kind === 'cut') {
      g.strokeStyle = '#000000';
      g.lineWidth = px * 0.3;
    } else if (guide.kind === 'frame') {
      g.strokeStyle = '#8c8c8c';
      g.setLineDash([px * 0.4, px * 0.8]);
    } else if (guide.kind === 'safe') {
      g.strokeStyle = '#1f5fa8';
      g.setLineDash([px * 1.4, px * 1]);
    } else if (guide.kind === 'keep-clear') {
      g.fillStyle = '#ffffff';
      g.fillRect(x * px, y * px, bw * px, bh * px);
      g.strokeStyle = '#8c8c8c';
    } else {
      g.fillStyle = 'rgba(214, 232, 223, 0.6)';
      g.fillRect(x * px, y * px, bw * px, bh * px);
      g.strokeStyle = '#8c8c8c';
      g.setLineDash([px * 0.7, px * 0.7]);
    }
    g.strokeRect(x * px, y * px, bw * px, bh * px);
    if (guide.label && guide.kind !== 'cut') {
      g.fillStyle = '#8c8c8c';
      g.font = `${Math.round(px * 2.2)}px system-ui, sans-serif`;
      g.fillText(guide.label, (x + bw / 2) * px, (y + bh / 2) * px);
    }
  }
  g.fillStyle = '#1f5fa8';
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.font = `600 ${Math.round(px * 2.5)}px system-ui, sans-serif`;
  const tag = TAG_AT[size][side];
  g.fillText(side === 'front' ? 'FRONT' : 'BACK', tag.x * px, tag.y * px);
  g.textAlign = 'center';
  g.font = `${Math.round(px * 1.8)}px system-ui, sans-serif`;
  const at = layout && side === 'front' ? null : NOTES_AT[size][side];
  if (at) NOTES[side].forEach((line, i) => g.fillText(line, at.x * px, at.y[i]! * px));
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png'))), 'image/png'));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadPdf(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
