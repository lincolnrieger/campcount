import type { PDFDocument, PDFFont, PDFImage, PDFPage, RGB } from 'pdf-lib';
import type { CardPerson, FontId, FontWeight, ImageElement, LanyardDesign, SideKey } from '../../shared/lanyardDesign';
import { cardSize } from '../../shared/lanyardDesign';
import { fontBytes } from './fonts';
import type { Box, ImageCache, Painter, RenderContext } from './render';
import { PT_TO_MM, designFonts, drawPhotoSymbol, drawSide, fitImage, qrGeometry, qrModules } from './render';

/**
 * Print-ready PDFs of a lanyard design, built in the browser.
 *
 * - "sheet": as many cards as fit on A4, with cut lines, to print on any
 *   printer and cut out.
 * - "cards": one card per page, each page exactly the card's size, for card
 *   printers (Evolis, Zebra…) and print shops.
 *
 * Text and QR codes are vectors, so they print sharp and files stay small.
 */

export type PrintLayout = 'sheet' | 'cards';
export type PrintSides = 'both' | 'front' | 'back';

export interface PrintOptions extends RenderContext {
  layout: PrintLayout;
  sides: PrintSides;
  /** Dashed cut lines around each card (sheet layout). */
  cutLines: boolean;
}

const MM = 72 / 25.4; // points per millimetre
const A4 = { w: 210, h: 297 };
const SHEET_MARGIN = 7;
const SHEET_GAP = 2;

/** How cards sit on an A4 sheet (mm). */
export function sheetGrid(design: LanyardDesign) {
  const { w, h } = cardSize(design.format, design.orientation);
  const cols = Math.max(1, Math.floor((A4.w - 2 * SHEET_MARGIN + SHEET_GAP) / (w + SHEET_GAP)));
  const rows = Math.max(1, Math.floor((A4.h - 2 * SHEET_MARGIN + SHEET_GAP) / (h + SHEET_GAP)));
  const left = (A4.w - cols * w - (cols - 1) * SHEET_GAP) / 2;
  const top = (A4.h - rows * h - (rows - 1) * SHEET_GAP) / 2;
  return { cols, rows, perPage: cols * rows, w, h, left, top, gap: SHEET_GAP };
}

/** How many pages a print will take. */
export function pageCount(design: LanyardDesign, people: number, o: Pick<PrintOptions, 'layout' | 'sides'>): number {
  const sides = o.sides === 'both' ? 2 : 1;
  if (o.layout === 'cards') return people * sides;
  return Math.ceil(people / sheetGrid(design).perPage) * sides;
}

function hexToRgb(rgb: (r: number, g: number, b: number) => RGB, hex: string): RGB {
  return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
}

type PdfLib = typeof import('pdf-lib');

/** Draws one card onto a PDF page; the card's top-left corner is at (left, top) mm from the page's top-left. */
class PdfPainter implements Painter {
  constructor(
    private lib: PdfLib,
    private page: PDFPage,
    private pageH: number, // mm
    private left: number,
    private top: number,
    private fonts: Map<string, PDFFont>,
    private images: Map<string, PDFImage>,
  ) {}

  private X = (mm: number) => (this.left + mm) * MM;
  /** PDF y grows upwards from the bottom of the page. */
  private Y = (mm: number) => (this.pageH - this.top - mm) * MM;
  private col = (hex: string) => hexToRgb(this.lib.rgb, hex);
  private font(font: FontId, weight: FontWeight) {
    return this.fonts.get(`${font}:${weight}`) ?? this.fonts.values().next().value!;
  }

  begin(card: Box) {
    const { pushGraphicsState, rectangle, clip, endPath } = this.lib;
    this.page.pushOperators(pushGraphicsState(), rectangle(this.X(card.x), this.Y(card.y + card.h), card.w * MM, card.h * MM), clip(), endPath());
  }
  end() {
    this.page.pushOperators(this.lib.popGraphicsState());
  }

  private roundedPath(w: number, h: number, r: number) {
    // SVG path in points, y down from the box's top-left (pdf-lib flips it).
    const W = w * MM;
    const H = h * MM;
    const R = Math.min(r, w / 2, h / 2) * MM;
    return `M ${R} 0 H ${W - R} A ${R} ${R} 0 0 1 ${W} ${R} V ${H - R} A ${R} ${R} 0 0 1 ${W - R} ${H} H ${R} A ${R} ${R} 0 0 1 0 ${H - R} V ${R} A ${R} ${R} 0 0 1 ${R} 0 Z`;
  }

  private shape(box: Box, radius: number, ellipse: boolean, o: { color?: RGB; borderColor?: RGB; borderWidth?: number; opacity: number }) {
    const common = { opacity: o.opacity, borderOpacity: o.opacity, color: o.color, borderColor: o.borderColor, borderWidth: o.borderWidth ?? 0 };
    if (ellipse) {
      this.page.drawEllipse({ x: this.X(box.x + box.w / 2), y: this.Y(box.y + box.h / 2), xScale: (box.w / 2) * MM, yScale: (box.h / 2) * MM, ...common });
    } else if (radius > 0) {
      this.page.drawSvgPath(this.roundedPath(box.w, box.h, radius), { x: this.X(box.x), y: this.Y(box.y), ...common });
    } else {
      this.page.drawRectangle({ x: this.X(box.x), y: this.Y(box.y + box.h), width: box.w * MM, height: box.h * MM, ...common });
    }
  }

  rect(box: Box, o: { fill: string | null; stroke: string | null; strokeWidth: number; radius: number; ellipse: boolean; opacity: number }) {
    if (o.fill) this.shape(box, o.radius, o.ellipse, { color: this.col(o.fill), opacity: o.opacity });
    if (o.stroke && o.strokeWidth > 0) {
      const inset = o.strokeWidth / 2;
      this.shape({ x: box.x + inset, y: box.y + inset, w: box.w - o.strokeWidth, h: box.h - o.strokeWidth }, Math.max(0, o.radius - inset), o.ellipse, {
        borderColor: this.col(o.stroke),
        borderWidth: o.strokeWidth * MM,
        opacity: o.opacity,
      });
    }
  }

  image(el: ImageElement) {
    const img = this.images.get(el.id);
    if (!img) return;
    this.page.drawImage(img, { x: this.X(el.x), y: this.Y(el.y + el.h), width: el.w * MM, height: el.h * MM, opacity: el.opacity });
  }

  measure(text: string, font: FontId, weight: FontWeight, sizePt: number) {
    try {
      return this.font(font, weight).widthOfTextAtSize(text, sizePt) * PT_TO_MM;
    } catch {
      return text.length * sizePt * 0.5 * PT_TO_MM;
    }
  }

  text(line: string, x: number, baseline: number, font: FontId, weight: FontWeight, sizePt: number, colour: string) {
    this.page.drawText(line, { x: this.X(x), y: this.Y(baseline), size: sizePt, font: this.font(font, weight), color: this.col(colour) });
  }

  qr(value: string, box: Box) {
    const modules = qrModules(value);
    const { x, y, side, cell } = qrGeometry(box, modules.length);
    const black = this.lib.rgb(0, 0, 0);
    this.page.drawRectangle({ x: this.X(x), y: this.Y(y + side), width: side * MM, height: side * MM, color: this.lib.rgb(1, 1, 1) });
    // One rectangle per run of dark modules in a row: fewer drawing commands, same result.
    modules.forEach((row, r) => {
      let c = 0;
      while (c < row.length) {
        if (!row[c]) {
          c++;
          continue;
        }
        let end = c;
        while (end < row.length && row[end]) end++;
        const top = y + (r + 2) * cell;
        this.page.drawRectangle({ x: this.X(x + (c + 2) * cell), y: this.Y(top + cell) - 0.02, width: (end - c) * cell * MM, height: cell * MM + 0.04, color: black });
        c = end;
      }
    });
  }

  photoSymbol(kind: 'red_dot' | 'camera_icon', box: Box) {
    drawPhotoSymbol(this, kind, box);
  }

  line(x1: number, y1: number, x2: number, y2: number, width: number, colour: string) {
    this.page.drawLine({ start: { x: this.X(x1), y: this.Y(y1) }, end: { x: this.X(x2), y: this.Y(y2) }, thickness: width * MM, color: this.col(colour), lineCap: this.lib.LineCapStyle.Round });
  }
}

/** Each image element, cropped and fitted to its box at 300 dpi, ready to embed once and reuse on every card. */
async function prepareImages(doc: PDFDocument, design: LanyardDesign, cache: ImageCache): Promise<Map<string, PDFImage>> {
  const out = new Map<string, PDFImage>();
  const els = [...design.front.elements, ...design.back.elements].filter((e): e is ImageElement => e.type === 'image');
  for (const el of els) {
    const bmp = await cache.load(el.assetId);
    if (!bmp) continue;
    const dpmm = 300 / 25.4;
    const W = Math.max(1, Math.min(3000, Math.round(el.w * dpmm)));
    const H = Math.max(1, Math.min(3000, Math.round(el.h * dpmm)));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d')!;
    const k = W / el.w;
    g.beginPath();
    if (el.radius > 0) g.roundRect(0, 0, W, H, Math.min(el.radius, el.w / 2, el.h / 2) * k);
    else g.rect(0, 0, W, H);
    g.clip();
    const f = fitImage(bmp, { ...el, x: 0, y: 0 });
    g.drawImage(bmp, f.sx, f.sy, f.sw, f.sh, f.dx * k, f.dy * k, f.dw * k, f.dh * k);
    // Photos fill their box: JPEG keeps the file small. Anything with see-through parts stays PNG.
    const opaque = el.fit === 'cover' && el.radius === 0;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, opaque ? 'image/jpeg' : 'image/png', 0.92));
    if (!blob) continue;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    out.set(el.id, opaque ? await doc.embedJpg(bytes) : await doc.embedPng(bytes));
  }
  return out;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function build(design: LanyardDesign, people: CardPerson[], cache: ImageCache, o: PrintOptions, subset: boolean, onProgress?: (done: number) => void): Promise<Uint8Array> {
  const lib = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const doc = await lib.PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`${o.campName} lanyards`);
  doc.setCreator('CampCount');

  const fonts = new Map<string, PDFFont>();
  for (const f of designFonts(design)) {
    fonts.set(`${f.font}:${f.weight}`, await doc.embedFont(await fontBytes(f.font, f.weight), { subset }));
  }
  const images = await prepareImages(doc, design, cache);
  const sides: SideKey[] = o.sides === 'both' ? ['front', 'back'] : [o.sides];
  const card = cardSize(design.format, design.orientation);
  const grey = lib.rgb(0.62, 0.62, 0.62);

  if (o.layout === 'cards') {
    for (let i = 0; i < people.length; i++) {
      for (const side of sides) {
        const page = doc.addPage([card.w * MM, card.h * MM]);
        drawSide(new PdfPainter(lib, page, card.h, 0, 0, fonts, images), design, side, people[i]!, o);
      }
      if (i % 20 === 19) {
        onProgress?.(i + 1);
        await tick();
      }
    }
  } else {
    const grid = sheetGrid(design);
    for (let start = 0; start < people.length; start += grid.perPage) {
      const chunk = people.slice(start, start + grid.perPage);
      for (const side of sides) {
        const page = doc.addPage([A4.w * MM, A4.h * MM]);
        chunk.forEach((person, slot) => {
          const col = slot % grid.cols;
          const row = Math.floor(slot / grid.cols);
          // Backs mirror the columns, so they line up when the sheet is flipped on its long edge.
          const c = side === 'back' && o.sides === 'both' ? grid.cols - 1 - col : col;
          const left = grid.left + c * (grid.w + grid.gap);
          const top = grid.top + row * (grid.h + grid.gap);
          drawSide(new PdfPainter(lib, page, A4.h, left, top, fonts, images), design, side, person, o);
          if (o.cutLines) {
            page.drawRectangle({
              x: left * MM,
              y: (A4.h - top - grid.h) * MM,
              width: grid.w * MM,
              height: grid.h * MM,
              borderColor: grey,
              borderWidth: 0.4,
              borderDashArray: [2.5, 2.5],
            });
          }
        });
      }
      onProgress?.(Math.min(people.length, start + grid.perPage));
      await tick();
    }
  }
  return doc.save();
}

/** Build the PDF. Fonts are subset to keep files small; if that ever fails, whole fonts are embedded instead. */
export async function buildPrintPdf(design: LanyardDesign, people: CardPerson[], cache: ImageCache, o: PrintOptions, onProgress?: (done: number) => void): Promise<Uint8Array> {
  try {
    return await build(design, people, cache, o, true, onProgress);
  } catch {
    return build(design, people, cache, o, false, onProgress);
  }
}
