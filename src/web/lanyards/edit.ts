import type { CardFormat, DesignElement, FieldId, LanyardDesign, Orientation, SideKey } from '../../shared/lanyardDesign';
import { FIELDS, cardSize, newId } from '../../shared/lanyardDesign';
import { api } from '../api';
import { PT_TO_MM } from './render';

/** Change one element on a side. */
export function updateElement(d: LanyardDesign, side: SideKey, id: string, patch: Partial<DesignElement>): LanyardDesign {
  return { ...d, [side]: { ...d[side], elements: d[side].elements.map((e) => (e.id === id ? ({ ...e, ...patch } as DesignElement) : e)) } };
}

export function removeElement(d: LanyardDesign, side: SideKey, id: string): LanyardDesign {
  return { ...d, [side]: { ...d[side], elements: d[side].elements.filter((e) => e.id !== id) } };
}

export function addElement(d: LanyardDesign, side: SideKey, el: DesignElement): LanyardDesign {
  return { ...d, [side]: { ...d[side], elements: [...d[side].elements, el] } };
}

/** Move an element up or down the stack (later = drawn on top). */
export function reorder(d: LanyardDesign, side: SideKey, id: string, to: 'forward' | 'backward' | 'front' | 'back'): LanyardDesign {
  const list = [...d[side].elements];
  const i = list.findIndex((e) => e.id === id);
  if (i < 0) return d;
  const [el] = list.splice(i, 1);
  const j = to === 'front' ? list.length : to === 'back' ? 0 : to === 'forward' ? Math.min(list.length, i + 1) : Math.max(0, i - 1);
  list.splice(j, 0, el!);
  return { ...d, [side]: { ...d[side], elements: list } };
}

export function duplicate(d: LanyardDesign, side: SideKey, id: string): { design: LanyardDesign; id: string | null } {
  const el = d[side].elements.find((e) => e.id === id);
  if (!el) return { design: d, id: null };
  const copy = { ...el, id: newId(el.type), x: el.x + 2, y: el.y + 2, locked: false } as DesignElement;
  return { design: addElement(d, side, copy), id: copy.id };
}

/** A new element, placed in the middle of the card. */
export function makeElement(d: LanyardDesign, kind: 'text' | 'field' | 'qr' | 'rect' | 'ellipse' | 'band', field?: FieldId): DesignElement {
  const { w, h } = cardSize(d.format, d.orientation);
  const big = d.format === 'large';
  const centre = (bw: number, bh: number) => ({ x: (w - bw) / 2, y: (h - bh) / 2, w: bw, h: bh });
  switch (kind) {
    case 'text':
      return {
        id: newId('text'),
        name: 'Text',
        type: 'text',
        text: 'Your words here',
        ...centre(w * 0.7, big ? 10 : 7),
        font: 'nunito-sans',
        size: big ? 16 : 11,
        weight: 700,
        colour: '#16201B',
        align: 'center',
        wrap: true,
      };
    case 'field': {
      const f = field ?? 'name';
      return {
        id: newId(f),
        name: FIELDS[f].label,
        type: 'text',
        text: `{${f}}`,
        ...centre(w * 0.8, big ? 10 : 7),
        font: 'nunito-sans',
        size: big ? 18 : 12,
        weight: f === 'name' ? 800 : 700,
        colour: '#16201B',
        align: 'center',
        wrap: false,
      };
    }
    case 'qr': {
      const s = Math.min(w, h) * 0.55;
      return { id: newId('qr'), name: 'QR code', type: 'qr', ...centre(s, s) };
    }
    case 'rect':
      return {
        id: newId('rect'),
        name: 'Rectangle',
        type: 'shape',
        shape: 'rect',
        ...centre(w * 0.5, h * 0.25),
        fill: '#1F5C46',
        stroke: 'none',
        strokeWidth: 0,
        radius: 0,
        opacity: 1,
      };
    case 'ellipse': {
      const s = Math.min(w, h) * 0.35;
      return { id: newId('circle'), name: 'Circle', type: 'shape', shape: 'ellipse', ...centre(s, s), fill: '#1F5C46', stroke: 'none', strokeWidth: 0, radius: 0, opacity: 1 };
    }
    case 'band':
      return {
        id: newId('band'),
        name: 'Role band',
        type: 'shape',
        shape: 'rect',
        x: 0,
        y: 0,
        w,
        h: h * 0.15,
        fill: 'level',
        stroke: 'none',
        strokeWidth: 0,
        radius: 0,
        opacity: 1,
      };
  }
}

/** An image element for an uploaded image: fitted inside the card, or covering it as a background. */
export function makeImage(d: LanyardDesign, assetId: string, pixelW: number, pixelH: number, background: boolean): DesignElement {
  const { w, h } = cardSize(d.format, d.orientation);
  if (background) return { id: newId('bg'), name: 'Background image', type: 'image', assetId, x: 0, y: 0, w, h, fit: 'cover', radius: 0, opacity: 1 };
  const ratio = pixelW / pixelH;
  let iw = w * 0.5;
  let ih = iw / ratio;
  if (ih > h * 0.5) {
    ih = h * 0.5;
    iw = ih * ratio;
  }
  return { id: newId('img'), name: 'Image', type: 'image', assetId, x: (w - iw) / 2, y: (h - ih) / 2, w: iw, h: ih, fit: 'contain', radius: 0, opacity: 1 };
}

/** Change card size or orientation, stretching everything to the new shape (text scales with it). */
export function resizeDesign(d: LanyardDesign, format: CardFormat, orientation: Orientation): LanyardDesign {
  const from = cardSize(d.format, d.orientation);
  const to = cardSize(format, orientation);
  const sx = to.w / from.w;
  const sy = to.h / from.h;
  const ss = Math.min(sx, sy);
  const scale = (e: DesignElement): DesignElement => {
    let next = { ...e, x: e.x * sx, y: e.y * sy, w: e.w * sx, h: e.h * sy } as DesignElement;
    // QR codes stay square.
    if (e.type === 'qr' || e.type === 'marker') {
      const s = Math.min(e.w, e.h) * ss;
      next = { ...next, w: s, h: s, x: e.x * sx + (e.w * sx - s) / 2, y: e.y * sy + (e.h * sy - s) / 2 } as DesignElement;
    }
    if (next.type === 'text') next = { ...next, size: Math.max(4, Math.min(120, Math.round(next.size * ss * 2) / 2)) };
    return next;
  };
  return { ...d, format, orientation, front: { ...d.front, elements: d.front.elements.map(scale) }, back: { ...d.back, elements: d.back.elements.map(scale) } };
}

// ---------------------------------------------------------------- snapping

export interface Guide {
  axis: 'x' | 'y';
  at: number;
}

/**
 * Snap a moving box to the card's edges and centre lines, the safe margin,
 * and other elements' edges and centres. Returns the adjusted position and
 * the guide lines to show.
 */
export function snapMove(
  box: { x: number; y: number; w: number; h: number },
  others: { x: number; y: number; w: number; h: number }[],
  card: { w: number; h: number },
  threshold: number,
) {
  const xs = [0, card.w / 2, card.w, 3, card.w - 3, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
  const ys = [0, card.h / 2, card.h, 3, card.h - 3, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
  const guides: Guide[] = [];
  const best = (edges: number[], targets: number[]) => {
    let hit: { delta: number; at: number } | null = null;
    for (const e of edges)
      for (const t of targets) {
        const delta = t - e;
        if (Math.abs(delta) <= threshold && (!hit || Math.abs(delta) < Math.abs(hit.delta))) hit = { delta, at: t };
      }
    return hit;
  };
  const hx = best([box.x, box.x + box.w / 2, box.x + box.w], xs);
  const hy = best([box.y, box.y + box.h / 2, box.y + box.h], ys);
  if (hx) guides.push({ axis: 'x', at: hx.at });
  if (hy) guides.push({ axis: 'y', at: hy.at });
  return { x: box.x + (hx?.delta ?? 0), y: box.y + (hy?.delta ?? 0), guides };
}

/** Snap a single edge while resizing. */
export function snapEdge(value: number, axis: 'x' | 'y', others: { x: number; y: number; w: number; h: number }[], card: { w: number; h: number }, threshold: number) {
  const targets =
    axis === 'x'
      ? [0, card.w / 2, card.w, 3, card.w - 3, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])]
      : [0, card.h / 2, card.h, 3, card.h - 3, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
  let hit: number | null = null;
  for (const t of targets) if (Math.abs(t - value) <= threshold && (hit === null || Math.abs(t - value) < Math.abs(hit - value))) hit = t;
  return hit === null ? { value, guide: null } : { value: hit, guide: { axis, at: hit } as Guide };
}

// ---------------------------------------------------------------- images

const MAX_UPLOAD = 1400 * 1024;
const MAX_EDGE = 2000;

/**
 * Upload an image for the design. Large images are shrunk first (2000 px on
 * the long edge is sharp at 300 dpi for anything up to 170 mm). Images with
 * see-through parts stay PNG; others become JPEG.
 */
export async function uploadImage(eventId: string, file: File): Promise<{ id: string; bitmap: ImageBitmap }> {
  const { dataUrl, bitmap } = await prepareImage(file);
  const res = await api<{ id: string }>(`/events/${eventId}/lanyard-assets`, { body: { dataUrl } });
  return { id: res.id, bitmap };
}

/** Read an image for upload, shrinking it to 2000 px on the long edge (and under 1.4 MB) if needed. */
export async function prepareImage(file: File): Promise<{ dataUrl: string; bitmap: ImageBitmap; width: number; height: number }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP image.');
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('That image couldn’t be opened. Try saving it as a PNG or JPEG.');
  const small = bitmap.width <= MAX_EDGE && bitmap.height <= MAX_EDGE;
  if (small && file.size <= MAX_UPLOAD) return { dataUrl: await readDataUrl(file), bitmap, width: bitmap.width, height: bitmap.height };
  const k = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * k);
  canvas.height = Math.round(bitmap.height * k);
  const g = canvas.getContext('2d')!;
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const transparent = file.type !== 'image/jpeg' && hasTransparency(g, canvas.width, canvas.height);
  for (const quality of [0.9, 0.8, 0.7]) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, transparent ? 'image/png' : 'image/jpeg', quality));
    if (blob && blob.size <= MAX_UPLOAD) return { dataUrl: await readDataUrl(blob), bitmap, width: canvas.width, height: canvas.height };
    if (transparent) break;
  }
  throw new Error('That image is too big. Use one under 1.4 MB.');
}

function hasTransparency(g: CanvasRenderingContext2D, w: number, h: number): boolean {
  const data = g.getImageData(0, 0, w, h).data;
  for (let i = 3; i < data.length; i += 4 * 16) if (data[i]! < 250) return true;
  return false;
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** mm ↔ pt for the size field. */
export const ptToMm = (pt: number) => pt * PT_TO_MM;
