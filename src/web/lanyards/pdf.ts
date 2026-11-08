import qrcode from 'qrcode-generator';
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';

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

export interface PdfOptions {
  marker: PhotoMarkerStyle;
  /** Print a back for every card (for double-sided printing, flip on the long edge). */
  doubleSided: boolean;
  /** The camp's logo as PNG bytes, for the back. */
  logoPng: Uint8Array | null;
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

  const front = (p: PDFPage, card: Card, x: number, y: number) => {
    const colours = bandColours(card);
    const name = pdfSafe(card.name);
    const group = pdfSafe(card.groupName);
    const label = bandLabel(card);
    const inset = card.noPhotos && (marker.photoMarker === 'black_border' || marker.photoMarker === 'colour_border') ? (lanyard ? 3.5 : 2.5) * MM : 0;
    const showLabel = card.noPhotos && marker.photoMarkerLabel;
    const showBadge = card.noPhotos && (marker.photoMarker === 'red_dot' || marker.photoMarker === 'camera_icon');

    if (lanyard) {
      const band = 20 * MM;
      p.drawRectangle({ x: x + inset, y: y + h - band - inset, width: w - 2 * inset, height: band, color: hex(colours.bg) });
      p.drawText(label, { x: x + inset + 5 * MM, y: y + h - band - inset + 6 * MM, size: 18, font: bold, color: hex(colours.fg) });
      // Hole-punch guide
      p.drawRectangle({ x: x + w / 2 - 7 * MM, y: y + h - inset - 6 * MM, width: 14 * MM, height: 3 * MM, borderColor: hex(colours.fg), borderWidth: 0.6, opacity: 0, borderOpacity: 0.6 });
      let right = x + w - inset - 5 * MM;
      if (showBadge) {
        badge(p, right - 4 * MM, y + h - band - inset + 8 * MM, 4 * MM);
        right -= 10 * MM;
      }
      if (showLabel) {
        const t = 'No photos';
        p.drawText(t, { x: right - bold.widthOfTextAtSize(t, 9), y: y + h - band - inset + 7 * MM, size: 9, font: bold, color: hex(colours.fg) });
      }

      const textW = w - 2 * inset - 10 * MM;
      const nameSize = fit(bold, name, textW, 26, 14);
      p.drawText(name, { x: x + (w - bold.widthOfTextAtSize(name, nameSize)) / 2, y: y + h - band - 14 * MM, size: nameSize, font: bold });
      const g = truncate(regular, group, textW, 10);
      p.drawText(g, { x: x + (w - regular.widthOfTextAtSize(g, 10)) / 2, y: y + h - band - 20 * MM, size: 10, font: regular });

      const side = (inset ? 52 : 56) * MM;
      drawQr(p, card.qr, x + (w - side) / 2, y + 15 * MM, side);
      const code = card.shortCode.split('').join(' ');
      p.drawText(code, { x: x + (w - bold.widthOfTextAtSize(code, 12)) / 2, y: y + inset + 6 * MM, size: 12, font: bold });
    } else {
      const band = 9 * MM;
      p.drawRectangle({ x: x + inset, y: y + h - band - inset, width: w - 2 * inset, height: band, color: hex(colours.bg) });
      p.drawText(label, { x: x + inset + 4 * MM, y: y + h - band - inset + 2.8 * MM, size: 11, font: bold, color: hex(colours.fg) });
      let right = x + w - inset - 4 * MM;
      if (showBadge) {
        badge(p, right - 2.6 * MM, y + h - inset - band / 2, 2.6 * MM);
        right -= 7 * MM;
      }
      if (showLabel) {
        const t = 'No photos';
        p.drawText(t, { x: right - bold.widthOfTextAtSize(t, 7.5), y: y + h - band - inset + 3 * MM, size: 7.5, font: bold, color: hex(colours.fg) });
      }
      const side = (inset ? 31 : 34) * MM;
      const qx = x + w - inset - side - 4 * MM;
      drawQr(p, card.qr, qx, y + inset + 5 * MM, side);
      const textW = qx - x - inset - 7 * MM;
      const nameSize = fit(bold, name, textW, 17, 9);
      p.drawText(name, { x: x + inset + 4 * MM, y: y + h - band - inset - 9 * MM, size: nameSize, font: bold });
      const g = truncate(regular, group, textW, 7.5);
      p.drawText(g, { x: x + inset + 4 * MM, y: y + h - band - inset - 14 * MM, size: 7.5, font: regular });
      p.drawText(card.shortCode, { x: x + inset + 4 * MM, y: y + inset + 5 * MM, size: 10, font: bold });
    }
  };

  const back = (p: PDFPage, x: number, y: number) => {
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
      cutLine(fronts, x, y);
      frame(fronts, x, y, card);
      front(fronts, card, x, y);
    });
    if (options.doubleSided) {
      const backs = doc.addPage([A4.w, A4.h]);
      pageCards.forEach((card, slot) => {
        const { x, y } = slotXY(slot, true);
        cutLine(backs, x, y);
        frame(backs, x, y, card);
        back(backs, x, y);
      });
    }
  }

  return doc.save();
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
