import qrcode from 'qrcode-generator';
import type {
  CardPerson,
  DesignElement,
  DesignSide,
  FontId,
  FontWeight,
  ImageElement,
  LanyardDesign,
  SideKey,
  TextElement,
} from '../../shared/lanyardDesign';
import { FIELDS, cardSize, fillFields, resolveColour } from '../../shared/lanyardDesign';
import { canvasFont } from './fonts';

/**
 * One drawing routine for a card side, used for the designer, the previews
 * and the PDF. A Painter does the actual drawing (canvas or PDF); everything
 * here works in millimetres from the card's top-left corner, so what you
 * see is what prints.
 */

export const PT_TO_MM = 25.4 / 72;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PhotoMarkerStyle {
  photoMarker: 'black_border' | 'colour_border' | 'red_dot' | 'camera_icon' | 'none';
  photoMarkerColour: string;
  photoMarkerLabel: boolean;
}

export interface RenderContext {
  campName: string;
  marker: PhotoMarkerStyle;
}

export interface Painter {
  /** Called once per side, before anything else: clip to the card. */
  begin(card: Box): void;
  end(): void;
  rect(box: Box, o: { fill: string | null; stroke: string | null; strokeWidth: number; radius: number; ellipse: boolean; opacity: number }): void;
  image(el: ImageElement): void;
  /** Width of a line of text, in mm. */
  measure(text: string, font: FontId, weight: FontWeight, sizePt: number): number;
  text(line: string, x: number, baseline: number, font: FontId, weight: FontWeight, sizePt: number, colour: string): void;
  qr(value: string, box: Box): void;
  /** The red circle or crossed-out camera, inside the box. */
  photoSymbol(kind: 'red_dot' | 'camera_icon', box: Box): void;
}

/** A person to preview the design with, when no real one is chosen. */
export const SAMPLE_PERSON: CardPerson = {
  name: FIELDS.name.sample,
  kind: 'youth',
  section: 'Scouts',
  groupName: '1st Example Scout Group',
  shortCode: '1234567',
  qr: 'https://campcount.com/c#sample-card-preview-only',
};

// ---------------------------------------------------------------- text layout

export interface TextLayout {
  sizePt: number;
  lines: { text: string; x: number; baseline: number; width: number }[];
}

/** Where a baseline sits for text vertically centred on a line of this height. */
const baselineIn = (top: number, lineH: number, sizeMm: number) => top + lineH / 2 + sizeMm * 0.34;

function wrapWords(text: string, maxW: number, measure: (t: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = words[0]!;
    for (const word of words.slice(1)) {
      const next = `${line} ${word}`;
      if (measure(next) <= maxW) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Lay out a text element's words in its box: shrink to fit (down to 40% of
 * the chosen size), wrap if allowed, and centre the block vertically.
 */
export function layoutText(el: Pick<TextElement, 'x' | 'y' | 'w' | 'h' | 'size' | 'align' | 'wrap'>, text: string, measure: (t: string, sizePt: number) => number): TextLayout {
  const min = Math.max(3, el.size * 0.4);
  let size = el.size;
  let lines: string[] = [text];
  for (;;) {
    const sizeMm = size * PT_TO_MM;
    const lineH = sizeMm * 1.2;
    lines = el.wrap ? wrapWords(text, el.w, (t) => measure(t, size)) : [text];
    const widest = Math.max(0, ...lines.map((l) => measure(l, size)));
    const fits = widest <= el.w + 0.01 && lines.length * lineH <= Math.max(el.h, lineH) + 0.01;
    if (fits || size <= min) break;
    size = Math.max(min, size - Math.max(0.25, size * 0.04));
  }
  // Still too wide at the smallest size: cut the line short.
  lines = lines.map((l) => {
    if (measure(l, size) <= el.w + 0.01) return l;
    let t = l;
    while (t.length > 1 && measure(`${t}…`, size) > el.w) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  });
  const sizeMm = size * PT_TO_MM;
  const lineH = sizeMm * 1.2;
  const top = el.y + (el.h - lines.length * lineH) / 2;
  return {
    sizePt: size,
    lines: lines.map((l, i) => {
      const width = measure(l, size);
      const x = el.align === 'left' ? el.x : el.align === 'right' ? el.x + el.w - width : el.x + (el.w - width) / 2;
      return { text: l, x, baseline: baselineIn(top + i * lineH, lineH, sizeMm), width };
    }),
  };
}

export function elementText(el: TextElement, person: CardPerson, campName: string): string {
  const t = fillFields(el.text, person, campName);
  return el.uppercase ? t.toUpperCase() : t;
}

// ---------------------------------------------------------------- the card

export function frameWidth(design: LanyardDesign): number {
  return design.format === 'large' ? 3.5 : 2.5;
}

/** Draw one side of one person's card. */
export function drawSide(p: Painter, design: LanyardDesign, side: SideKey, person: CardPerson, ctx: RenderContext, only?: (el: DesignElement) => boolean): void {
  const { w, h } = cardSize(design.format, design.orientation);
  const s: DesignSide = design[side];
  p.begin({ x: 0, y: 0, w, h });
  p.rect({ x: 0, y: 0, w, h }, { fill: s.background, stroke: null, strokeWidth: 0, radius: 0, ellipse: false, opacity: 1 });
  for (const el of s.elements) {
    if (only && !only(el)) continue;
    drawElement(p, el, person, ctx);
  }
  // No photo consent: a frame inside the edge, on both sides, over everything.
  const m = ctx.marker;
  if (person.noPhotos && (m.photoMarker === 'black_border' || m.photoMarker === 'colour_border')) {
    const t = frameWidth(design);
    p.rect({ x: t / 2, y: t / 2, w: w - t, h: h - t }, { fill: null, stroke: m.photoMarker === 'black_border' ? '#000000' : m.photoMarkerColour, strokeWidth: t, radius: 0, ellipse: false, opacity: 1 });
  }
  p.end();
}

export function drawElement(p: Painter, el: DesignElement, person: CardPerson, ctx: RenderContext): void {
  switch (el.type) {
    case 'shape': {
      const fill = el.fill === 'none' ? null : resolveColour(el.fill, person);
      const stroke = el.stroke === 'none' || el.strokeWidth <= 0 ? null : resolveColour(el.stroke, person);
      p.rect(el, { fill, stroke, strokeWidth: el.strokeWidth, radius: el.radius, ellipse: el.shape === 'ellipse', opacity: el.opacity });
      return;
    }
    case 'image':
      p.image(el);
      return;
    case 'text': {
      const text = elementText(el, person, ctx.campName);
      if (!text.trim()) return;
      const layout = layoutText(el, text, (t, size) => p.measure(t, el.font, el.weight, size));
      const colour = resolveColour(el.colour, person);
      for (const line of layout.lines) p.text(line.text, line.x, line.baseline, el.font, el.weight, layout.sizePt, colour);
      return;
    }
    case 'qr':
      p.qr(person.qr, el);
      return;
    case 'marker': {
      if (!person.noPhotos) return;
      const m = ctx.marker;
      if (m.photoMarker === 'red_dot' || m.photoMarker === 'camera_icon') {
        p.photoSymbol(m.photoMarker, el);
      } else if (m.photoMarkerLabel) {
        // A small black tag with the words, readable on any background. It's as
        // wide as its words, lined up with the right edge of the marker's box.
        const tagH = Math.min(el.h, 6);
        const size = Math.max(4, (tagH * 0.5) / PT_TO_MM);
        const words = 'No photos';
        const pad = tagH * 0.35;
        const tagW = p.measure(words, 'nunito-sans', 800, size) + 2 * pad;
        const tag = { x: el.x + el.w - tagW, y: el.y + (el.h - tagH) / 2, w: tagW, h: tagH };
        p.rect(tag, { fill: '#000000', stroke: null, strokeWidth: 0, radius: tagH / 2, ellipse: false, opacity: 1 });
        p.text(words, tag.x + pad, tag.y + tagH / 2 + size * PT_TO_MM * 0.34, 'nunito-sans', 800, size, '#FFFFFF');
      }
      return;
    }
  }
}

/** QR modules for a value: a square grid, true = dark. */
export function qrModules(value: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** The QR square inside a box: centred, with a 2-module white quiet zone inside the box. */
export function qrGeometry(box: Box, n: number) {
  const side = Math.min(box.w, box.h);
  const cell = side / (n + 4);
  return { x: box.x + (box.w - side) / 2, y: box.y + (box.h - side) / 2, side, cell };
}

// ---------------------------------------------------------------- canvas painter

export interface CanvasImages {
  get(assetId: string): CanvasImageSource | undefined;
}

/** Draws onto a 2D canvas at `scale` pixels per millimetre. */
export class CanvasPainter implements Painter {
  constructor(
    private g: CanvasRenderingContext2D,
    private scale: number,
    private images: CanvasImages,
    private offset = { x: 0, y: 0 },
  ) {}

  private X = (mm: number) => (mm + this.offset.x) * this.scale;
  private Y = (mm: number) => (mm + this.offset.y) * this.scale;
  private L = (mm: number) => mm * this.scale;

  begin(card: Box) {
    this.g.save();
    this.g.beginPath();
    this.g.rect(this.X(card.x), this.Y(card.y), this.L(card.w), this.L(card.h));
    this.g.clip();
  }
  end() {
    this.g.restore();
  }

  private path(box: Box, radius: number, ellipse: boolean) {
    const g = this.g;
    g.beginPath();
    if (ellipse) {
      g.ellipse(this.X(box.x + box.w / 2), this.Y(box.y + box.h / 2), this.L(box.w / 2), this.L(box.h / 2), 0, 0, Math.PI * 2);
    } else if (radius > 0) {
      g.roundRect(this.X(box.x), this.Y(box.y), this.L(box.w), this.L(box.h), this.L(Math.min(radius, box.w / 2, box.h / 2)));
    } else {
      g.rect(this.X(box.x), this.Y(box.y), this.L(box.w), this.L(box.h));
    }
  }

  rect(box: Box, o: { fill: string | null; stroke: string | null; strokeWidth: number; radius: number; ellipse: boolean; opacity: number }) {
    const g = this.g;
    g.save();
    g.globalAlpha = o.opacity;
    if (o.fill) {
      this.path(box, o.radius, o.ellipse);
      g.fillStyle = o.fill;
      g.fill();
    }
    if (o.stroke && o.strokeWidth > 0) {
      // Strokes sit inside the box, so a border never spills off the card.
      const inset = o.strokeWidth / 2;
      this.path({ x: box.x + inset, y: box.y + inset, w: box.w - o.strokeWidth, h: box.h - o.strokeWidth }, Math.max(0, o.radius - inset), o.ellipse);
      g.strokeStyle = o.stroke;
      g.lineWidth = this.L(o.strokeWidth);
      g.stroke();
    }
    g.restore();
  }

  image(el: ImageElement) {
    const img = this.images.get(el.assetId);
    const g = this.g;
    g.save();
    g.globalAlpha = el.opacity;
    this.path(el, el.radius, false);
    g.clip();
    if (!img) {
      g.fillStyle = '#E0E6E2';
      g.fillRect(this.X(el.x), this.Y(el.y), this.L(el.w), this.L(el.h));
    } else {
      const { sx, sy, sw, sh, dx, dy, dw, dh } = fitImage(img, el);
      g.drawImage(img, sx, sy, sw, sh, this.X(dx), this.Y(dy), this.L(dw), this.L(dh));
    }
    g.restore();
  }

  measure(text: string, font: FontId, weight: FontWeight, sizePt: number) {
    // Measure at a fixed size and scale, so tiny sizes measure accurately.
    this.g.font = canvasFont(font, weight, 100);
    return (this.g.measureText(text).width / 100) * sizePt * PT_TO_MM;
  }

  text(line: string, x: number, baseline: number, font: FontId, weight: FontWeight, sizePt: number, colour: string) {
    const g = this.g;
    g.save();
    g.font = canvasFont(font, weight, this.L(sizePt * PT_TO_MM));
    g.fillStyle = colour;
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillText(line, this.X(x), this.Y(baseline));
    g.restore();
  }

  qr(value: string, box: Box) {
    const modules = qrModules(value);
    const { x, y, side, cell } = qrGeometry(box, modules.length);
    const g = this.g;
    g.fillStyle = '#FFFFFF';
    g.fillRect(this.X(x), this.Y(y), this.L(side), this.L(side));
    g.fillStyle = '#000000';
    modules.forEach((row, r) =>
      row.forEach((dark, c) => {
        if (!dark) return;
        // Round outward to whole pixels so neighbouring modules don't show hairline gaps.
        const px = Math.floor(this.X(x + (c + 2) * cell));
        const py = Math.floor(this.Y(y + (r + 2) * cell));
        g.fillRect(px, py, Math.ceil(this.X(x + (c + 3) * cell)) - px, Math.ceil(this.Y(y + (r + 3) * cell)) - py);
      }),
    );
  }

  photoSymbol(kind: 'red_dot' | 'camera_icon', box: Box) {
    drawPhotoSymbol(this, kind, box);
  }

  /** Low-level helpers for the shared symbol drawing. */
  line(x1: number, y1: number, x2: number, y2: number, width: number, colour: string) {
    const g = this.g;
    g.save();
    g.strokeStyle = colour;
    g.lineWidth = this.L(width);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(this.X(x1), this.Y(y1));
    g.lineTo(this.X(x2), this.Y(y2));
    g.stroke();
    g.restore();
  }
}

/** Source and destination rectangles for cover/contain (destination in mm). */
export function fitImage(img: CanvasImageSource | { width: number; height: number }, el: Pick<ImageElement, 'x' | 'y' | 'w' | 'h' | 'fit'>) {
  const iw = (img as { width: number }).width;
  const ih = (img as { height: number }).height;
  const boxRatio = el.w / el.h;
  const imgRatio = iw / ih;
  if (el.fit === 'cover') {
    // Crop the image to the box's shape, centred.
    let sw = iw;
    let sh = ih;
    if (imgRatio > boxRatio) sw = ih * boxRatio;
    else sh = iw / boxRatio;
    return { sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh, dx: el.x, dy: el.y, dw: el.w, dh: el.h };
  }
  let dw = el.w;
  let dh = el.h;
  if (imgRatio > boxRatio) dh = el.w / imgRatio;
  else dw = el.h * imgRatio;
  return { sx: 0, sy: 0, sw: iw, sh: ih, dx: el.x + (el.w - dw) / 2, dy: el.y + (el.h - dh) / 2, dw, dh };
}

interface SymbolPainter {
  rect: Painter['rect'];
  line(x1: number, y1: number, x2: number, y2: number, width: number, colour: string): void;
}

/** The no-photo symbols, built from circles, rectangles and lines so both painters draw them the same. */
export function drawPhotoSymbol(p: SymbolPainter, kind: 'red_dot' | 'camera_icon', box: Box) {
  const d = Math.min(box.w, box.h);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const disc = { x: cx - d / 2, y: cy - d / 2, w: d, h: d };
  if (kind === 'red_dot') {
    p.rect(disc, { fill: '#FFFFFF', stroke: null, strokeWidth: 0, radius: 0, ellipse: true, opacity: 1 });
    const r = d * 0.84;
    p.rect({ x: cx - r / 2, y: cy - r / 2, w: r, h: r }, { fill: '#D0021B', stroke: null, strokeWidth: 0, radius: 0, ellipse: true, opacity: 1 });
    return;
  }
  p.rect(disc, { fill: '#FFFFFF', stroke: null, strokeWidth: 0, radius: 0, ellipse: true, opacity: 1 });
  const bw = d * 0.56;
  const bh = d * 0.38;
  const by = cy - bh / 2 + d * 0.04;
  p.rect({ x: cx - bw / 2, y: by, w: bw, h: bh }, { fill: '#000000', stroke: null, strokeWidth: 0, radius: d * 0.05, ellipse: false, opacity: 1 });
  p.rect({ x: cx - bw * 0.2, y: by - d * 0.08, w: bw * 0.4, h: d * 0.1 }, { fill: '#000000', stroke: null, strokeWidth: 0, radius: d * 0.02, ellipse: false, opacity: 1 });
  const lens = bh * 0.55;
  p.rect({ x: cx - lens / 2, y: by + (bh - lens) / 2, w: lens, h: lens }, { fill: '#FFFFFF', stroke: null, strokeWidth: 0, radius: 0, ellipse: true, opacity: 1 });
  const k = d * 0.34;
  p.line(cx - k, cy + k, cx + k, cy - k, d * 0.14, '#FFFFFF');
  p.line(cx - k, cy + k, cx + k, cy - k, d * 0.07, '#000000');
}

// ---------------------------------------------------------------- images

/** Load design images for canvases, keyed by asset id. */
export class ImageCache implements CanvasImages {
  private map = new Map<string, ImageBitmap>();
  private pending = new Map<string, Promise<ImageBitmap | null>>();
  constructor(private eventId: string) {}

  get(assetId: string) {
    return this.map.get(assetId);
  }

  /** The image's own URL. */
  url(assetId: string) {
    return `/api/events/${this.eventId}/lanyard-assets/${assetId}`;
  }

  load(assetId: string): Promise<ImageBitmap | null> {
    const have = this.map.get(assetId);
    if (have) return Promise.resolve(have);
    let p = this.pending.get(assetId);
    if (!p) {
      p = fetch(this.url(assetId), { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('image'))))
        .then((b) => createImageBitmap(b))
        .then((bmp) => {
          this.map.set(assetId, bmp);
          return bmp;
        })
        .catch(() => null)
        .finally(() => this.pending.delete(assetId));
      this.pending.set(assetId, p);
    }
    return p;
  }

  /** Put an image straight in (just uploaded). */
  put(assetId: string, bmp: ImageBitmap) {
    this.map.set(assetId, bmp);
  }

  async loadAll(design: LanyardDesign) {
    const ids = [...design.front.elements, ...design.back.elements].flatMap((e) => (e.type === 'image' ? [e.assetId] : []));
    await Promise.all(ids.map((id) => this.load(id)));
  }
}

/** Every font and weight a design's text uses (plus the no-photo tag's). */
export function designFonts(design: LanyardDesign): { font: FontId; weight: FontWeight }[] {
  const seen = new Map<string, { font: FontId; weight: FontWeight }>();
  seen.set('nunito-sans:800', { font: 'nunito-sans', weight: 800 });
  for (const el of [...design.front.elements, ...design.back.elements]) {
    if (el.type === 'text') seen.set(`${el.font}:${el.weight}`, { font: el.font, weight: el.weight });
  }
  return [...seen.values()];
}

/** Render one side to a canvas element at a given pixel density. */
export function renderToCanvas(canvas: HTMLCanvasElement, design: LanyardDesign, side: SideKey, person: CardPerson, ctx: RenderContext, images: CanvasImages, pxPerMm: number) {
  const { w, h } = cardSize(design.format, design.orientation);
  const W = Math.round(w * pxPerMm);
  const H = Math.round(h * pxPerMm);
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  drawSide(new CanvasPainter(g, W / w, images), design, side, person, ctx);
}
