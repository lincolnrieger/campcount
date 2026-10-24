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
}

export type CardSize = 'lanyard' | 'badge';

export const CARD_SIZES: Record<CardSize, { label: string; w: number; h: number; cols: number; rows: number }> = {
  lanyard: { label: 'Lanyard, 90×120 mm, 4 per A4', w: 90, h: 120, cols: 2, rows: 2 },
  badge: { label: 'Wallet, 86×54 mm, 10 per A4', w: 86, h: 54, cols: 2, rows: 5 },
};

/** Scouts Australia section colours; the section name is always printed too. */
export const SECTION_COLOURS: Record<string, { bg: string; fg: string }> = {
  Joeys: { bg: '#8b5a2b', fg: '#ffffff' },
  Cubs: { bg: '#ffc72c', fg: '#000000' },
  Scouts: { bg: '#00843d', fg: '#ffffff' },
  Venturers: { bg: '#7a1f3d', fg: '#ffffff' },
  Rovers: { bg: '#c8102e', fg: '#ffffff' },
  Leaders: { bg: '#1f4d3f', fg: '#ffffff' },
  Other: { bg: '#dddddd', fg: '#000000' },
};

export function bandLabel(card: Card): string {
  return card.kind === 'adult' ? 'Leader' : card.section;
}

const MM = 72 / 25.4;
const A4 = { w: 210 * MM, h: 297 * MM };

/** Standard PDF fonts only cover Western European characters; map the rest to close equivalents. */
function pdfSafe(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
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
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`.replace('…', '...'), size) > max) t = t.slice(0, -1);
  return `${t}...`;
}

/** Build a print-ready A4 PDF of lanyard cards. Runs entirely in the browser. */
export async function buildLanyardPdf(cards: Card[], size: CardSize, eventName: string): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const doc = await PDFDocument.create();
  doc.setTitle(`${pdfSafe(eventName)} lanyards`);
  doc.setCreator('CampCount');
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const spec = CARD_SIZES[size];
  const w = spec.w * MM;
  const h = spec.h * MM;
  const gap = 4 * MM;
  const left = (A4.w - spec.cols * w - (spec.cols - 1) * gap) / 2;
  const top = A4.h - (A4.h - spec.rows * h - (spec.rows - 1) * gap) / 2;
  const perPage = spec.cols * spec.rows;
  let page: PDFPage | null = null;

  cards.forEach((card, i) => {
    if (i % perPage === 0) page = doc.addPage([A4.w, A4.h]);
    const slot = i % perPage;
    const x = left + (slot % spec.cols) * (w + gap);
    const y = top - Math.floor(slot / spec.cols) * (h + gap) - h;
    const colours = SECTION_COLOURS[card.kind === 'adult' ? 'Leaders' : card.section] ?? SECTION_COLOURS.Other!;
    const p = page!;
    const name = pdfSafe(card.name);
    const group = pdfSafe(card.groupName);

    // Cut line
    p.drawRectangle({ x, y, width: w, height: h, borderColor: hex('#9a9a9a'), borderWidth: 0.6, borderDashArray: [3, 3] });

    const qr = qrcode(0, 'M');
    qr.addData(card.qr);
    qr.make();
    const n = qr.getModuleCount();
    const drawQr = (qx: number, qy: number, side: number) => {
      const cell = side / n;
      p.drawRectangle({ x: qx - 2 * cell, y: qy - 2 * cell, width: side + 4 * cell, height: side + 4 * cell, color: rgb(1, 1, 1) });
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) p.drawRectangle({ x: qx + c * cell, y: qy + (n - 1 - r) * cell, width: cell + 0.05, height: cell + 0.05, color: rgb(0, 0, 0) });
        }
      }
    };

    if (size === 'lanyard') {
      const band = 20 * MM;
      p.drawRectangle({ x, y: y + h - band, width: w, height: band, color: hex(colours.bg) });
      p.drawText(bandLabel(card), { x: x + 5 * MM, y: y + h - band + 5 * MM, size: 15, font: bold, color: hex(colours.fg) });
      // Hole-punch guide
      p.drawRectangle({ x: x + w / 2 - 7 * MM, y: y + h - 6 * MM, width: 14 * MM, height: 3 * MM, borderColor: hex(colours.fg), borderWidth: 0.6, opacity: 0, borderOpacity: 0.6 });

      const nameSize = fit(bold, name, w - 10 * MM, 26, 14);
      p.drawText(name, { x: x + (w - bold.widthOfTextAtSize(name, nameSize)) / 2, y: y + h - band - 13 * MM, size: nameSize, font: bold });
      const g = truncate(regular, group, w - 10 * MM, 10);
      p.drawText(g, { x: x + (w - regular.widthOfTextAtSize(g, 10)) / 2, y: y + h - band - 19 * MM, size: 10, font: regular });

      const side = 56 * MM;
      drawQr(x + (w - side) / 2, y + 17 * MM, side);
      const code = card.shortCode.split('').join(' ');
      p.drawText(code, { x: x + (w - bold.widthOfTextAtSize(code, 12)) / 2, y: y + 10 * MM, size: 12, font: bold });
      const foot = truncate(regular, `${pdfSafe(eventName)}. If found, please hand to a camp leader.`, w - 8 * MM, 6.5);
      p.drawText(foot, { x: x + (w - regular.widthOfTextAtSize(foot, 6.5)) / 2, y: y + 4 * MM, size: 6.5, font: regular, color: hex('#444444') });
    } else {
      const band = 9 * MM;
      p.drawRectangle({ x, y: y + h - band, width: w, height: band, color: hex(colours.bg) });
      p.drawText(bandLabel(card), { x: x + 4 * MM, y: y + h - band + 2.8 * MM, size: 10, font: bold, color: hex(colours.fg) });
      const side = 34 * MM;
      const qx = x + w - side - 4 * MM;
      drawQr(qx, y + 6 * MM, side);
      const textW = qx - x - 7 * MM;
      const nameSize = fit(bold, name, textW, 17, 9);
      p.drawText(name, { x: x + 4 * MM, y: y + h - band - 9 * MM, size: nameSize, font: bold });
      const g = truncate(regular, group, textW, 7.5);
      p.drawText(g, { x: x + 4 * MM, y: y + h - band - 14 * MM, size: 7.5, font: regular });
      p.drawText(card.shortCode, { x: x + 4 * MM, y: y + 6 * MM, size: 10, font: bold });
    }
  });

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
