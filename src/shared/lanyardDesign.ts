import { z } from 'zod';

/**
 * A camp's lanyard design: what's printed on the front and back of every
 * card. Shared by the designer, the print renderer and the server (which
 * validates every save with the same schema).
 *
 * Everything is measured in millimetres from the card's top-left corner, so
 * the same design prints identically on a sheet of A4, on a card-sized page,
 * or on a card printer.
 */

/** Card sizes. CR80 is the standard ID/credit card size (ISO/IEC 7810 ID-1). */
export const CARD_FORMATS = {
  cr80: { label: 'Standard card (CR80)', detail: '85.6 × 54 mm, the size of a bank card', long: 85.6, short: 53.98 },
  large: { label: 'Large lanyard', detail: '90 × 120 mm', long: 120, short: 90 },
} as const;
export type CardFormat = keyof typeof CARD_FORMATS;
export const CARD_FORMAT_KEYS = Object.keys(CARD_FORMATS) as CardFormat[];
export type Orientation = 'portrait' | 'landscape';

export function cardSize(format: CardFormat, orientation: Orientation): { w: number; h: number } {
  const f = CARD_FORMATS[format];
  return orientation === 'portrait' ? { w: f.short, h: f.long } : { w: f.long, h: f.short };
}

/** Fonts bundled with CampCount (self-hosted, all under the SIL Open Font License). */
export const FONTS = {
  'nunito-sans': { label: 'Nunito Sans', family: 'CC Nunito Sans', weights: [400, 700, 800] },
  merriweather: { label: 'Merriweather', family: 'CC Merriweather', weights: [400, 700] },
  'roboto-slab': { label: 'Roboto Slab', family: 'CC Roboto Slab', weights: [400, 700] },
  oswald: { label: 'Oswald', family: 'CC Oswald', weights: [400, 700] },
  'bebas-neue': { label: 'Bebas Neue', family: 'CC Bebas Neue', weights: [400] },
  'permanent-marker': { label: 'Permanent Marker', family: 'CC Permanent Marker', weights: [400] },
} as const;
export type FontId = keyof typeof FONTS;
export const FONT_IDS = Object.keys(FONTS) as FontId[];
export type FontWeight = 400 | 700 | 800;

/** The nearest weight a font actually has. */
export function fontWeight(font: FontId, wanted: FontWeight): FontWeight {
  const ws = FONTS[font].weights as readonly number[];
  if (ws.includes(wanted)) return wanted;
  return ws.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best), ws[0]!) as FontWeight;
}

/** Fields that fill in per person. Typed into text as {name}, {level}… */
export const FIELDS = {
  name: { label: 'Name', sample: 'Sam Taylor' },
  first: { label: 'First name', sample: 'Sam' },
  last: { label: 'Last name', sample: 'Taylor' },
  level: { label: 'Level', sample: 'Participant' },
  code: { label: 'Lanyard code', sample: '1234567' },
  camp: { label: 'Camp name', sample: 'Summer Camp' },
} as const;
export type FieldId = keyof typeof FIELDS;
export const FIELD_IDS = Object.keys(FIELDS) as FieldId[];

/**
 * A colour: a hex value, or one that follows the person's level (the
 * camp's colour for it in Settings › Levels), or the text colour that reads
 * on it.
 */
export const LEVEL_COLOUR = 'level';
export const LEVEL_TEXT_COLOUR = 'level-text';
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a colour like #1F5C46');
const colour = z.union([hex, z.literal(LEVEL_COLOUR), z.literal(LEVEL_TEXT_COLOUR)]);
const fill = z.union([colour, z.literal('none')]);
export type Colour = z.infer<typeof colour>;
export type Fill = z.infer<typeof fill>;

const mm = (min: number, max: number) => z.number().finite().min(min).max(max);

const base = {
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  name: z.string().trim().max(60).optional(),
  x: mm(-50, 250),
  y: mm(-50, 250),
  w: mm(1, 300),
  h: mm(1, 300),
  locked: z.boolean().optional(),
};

export const textElement = z.strictObject({
  ...base,
  type: z.literal('text'),
  /** Words to print; {name}, {level}… fill in for each person. */
  text: z.string().max(400),
  font: z.enum(FONT_IDS as [FontId, ...FontId[]]),
  /** Point size (1 pt = 0.3528 mm). Shrinks to fit the box if the words are too long. */
  size: z.number().min(4).max(120),
  weight: z.union([z.literal(400), z.literal(700), z.literal(800)]),
  colour,
  align: z.enum(['left', 'center', 'right']),
  /** Wrap onto more lines (otherwise one line, shrunk to fit). */
  wrap: z.boolean(),
  uppercase: z.boolean().optional(),
});

export const shapeElement = z.strictObject({
  ...base,
  type: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse']),
  fill,
  stroke: fill,
  strokeWidth: mm(0, 10),
  radius: mm(0, 60),
  opacity: z.number().min(0).max(1),
});

export const imageElement = z.strictObject({
  ...base,
  type: z.literal('image'),
  assetId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  /** Fill the box (cropping) or fit inside it. */
  fit: z.enum(['cover', 'contain']),
  radius: mm(0, 60),
  opacity: z.number().min(0).max(1),
});

/** The person's QR code. Always black on a white quiet zone, so every scanner reads it. */
export const qrElement = z.strictObject({ ...base, type: z.literal('qr') });

/** Where the no-photo mark (red circle, crossed-out camera or words) goes, for people without photo consent. */
export const markerElement = z.strictObject({ ...base, type: z.literal('marker') });

export const designElement = z.discriminatedUnion('type', [textElement, shapeElement, imageElement, qrElement, markerElement]);
export type DesignElement = z.infer<typeof designElement>;
export type TextElement = z.infer<typeof textElement>;
export type ShapeElement = z.infer<typeof shapeElement>;
export type ImageElement = z.infer<typeof imageElement>;
export type QrElement = z.infer<typeof qrElement>;
export type MarkerElement = z.infer<typeof markerElement>;
export type ElementType = DesignElement['type'];

export const designSide = z.strictObject({
  background: hex,
  elements: z.array(designElement).max(80),
});
export type DesignSide = z.infer<typeof designSide>;
export type SideKey = 'front' | 'back';

export const lanyardDesignSchema = z
  .strictObject({
    version: z.literal(1),
    format: z.enum(CARD_FORMAT_KEYS as [CardFormat, ...CardFormat[]]),
    orientation: z.enum(['portrait', 'landscape']),
    front: designSide,
    back: designSide,
  })
  .refine((d) => d.format !== 'large' || d.orientation === 'portrait', { message: 'Large lanyards are portrait only.' })
  .refine((d) => new Set([...d.front.elements, ...d.back.elements].map((e) => e.id)).size === d.front.elements.length + d.back.elements.length, {
    message: 'Each element needs its own id.',
  });
export type LanyardDesign = z.infer<typeof lanyardDesignSchema>;

/** Image ids a design uses. */
export function designAssetIds(d: LanyardDesign): string[] {
  return [...new Set([...d.front.elements, ...d.back.elements].flatMap((e) => (e.type === 'image' ? [e.assetId] : [])))];
}

// ---------------------------------------------------------------- per-person values

/**
 * Fallback card colours, for when a card has no camp style (each camp sets
 * its own per level in Settings › Levels). The level word is always printed
 * too, so colour is never the only signal.
 */
export const LEVEL_COLOURS: Record<string, { bg: string; fg: string }> = {
  Participant: { bg: '#1F6F8B', fg: '#FFFFFF' },
  // Navy, RGB 38 38 97.
  Leader: { bg: '#262661', fg: '#FFFFFF' },
};
/** Anyone not in a level: no word on the card, and a neutral band. */
const NO_LEVEL = { bg: '#5A6770', fg: '#FFFFFF' };

export type LevelWord = 'Participant' | 'Leader' | '';

/** The fallback word for someone's level on a card, when the camp's own word isn't known: Leader for adults, Participant otherwise. */
export function levelWord(kind: 'youth' | 'adult', _level: string): LevelWord {
  return kind === 'adult' ? 'Leader' : 'Participant';
}

/** A level's card colours (the neutral band for anyone without a level). */
export function levelColours(word: string): { bg: string; fg: string } {
  return LEVEL_COLOURS[word] ?? NO_LEVEL;
}

export interface CardPerson {
  /** First name and last name (either may be an initial). */
  name: string;
  firstName?: string;
  lastName?: string;
  kind: 'youth' | 'adult';
  level: string;
  groupName: string;
  shortCode: string;
  qr: string;
  noPhotos?: boolean;
  /** The camp's word and colours for their level (Settings › Levels). */
  style?: { word: string; bg: string; fg: string };
}

/** Fill {fields} in text for one person. Unknown {words} are left as typed. */
export function fillFields(text: string, person: CardPerson, campName: string): string {
  const parts = person.name.trim().split(/\s+/);
  const values: Record<FieldId | 'group', string> = {
    name: person.name,
    first: person.firstName ?? parts[0] ?? '',
    last: person.lastName ?? (parts.length > 1 ? parts.slice(1).join(' ') : ''),
    // Cards no longer show the group: {group} on an older design prints nothing.
    group: '',
    level: person.style ? person.style.word : levelWord(person.kind, person.level),
    code: person.shortCode,
    camp: campName,
  };
  return text.replace(/\{([a-z]+)\}/g, (whole, key: string) => (key in values ? values[key as FieldId | 'group'] : whole));
}

export function resolveColour(c: Colour, person: CardPerson | null): string {
  if (c !== LEVEL_COLOUR && c !== LEVEL_TEXT_COLOUR) return c;
  const s = person?.style ?? (person ? levelColours(levelWord(person.kind, person.level)) : LEVEL_COLOURS.Participant!);
  return c === LEVEL_COLOUR ? s.bg : s.fg;
}

// ---------------------------------------------------------------- starting design

let counter = 0;
export function newId(prefix = 'el'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * The design every camp starts from: the level band, full name, QR code
 * and typed code on the front; "if found" on the back. Laid out for the
 * chosen size and orientation.
 */
export function starterDesign(format: CardFormat = 'cr80', orientation: Orientation = 'portrait'): LanyardDesign {
  const { w, h } = cardSize(format, orientation);
  const portrait = orientation === 'portrait';
  const m = format === 'large' ? 6 : 4; // margin
  const id = (n: string) => `${n}-${format}-${orientation}`;
  const front: DesignElement[] = [];
  const bandH = portrait ? h * 0.15 : h * 0.2;
  front.push({ id: id('band'), name: 'Level band', type: 'shape', shape: 'rect', x: 0, y: 0, w, h: bandH, fill: LEVEL_COLOUR, stroke: 'none', strokeWidth: 0, radius: 0, opacity: 1 });
  front.push({ id: id('level'), name: 'Level', type: 'text', text: '{level}', x: m, y: 0, w: w - 2 * m - bandH, h: bandH, font: 'nunito-sans', size: portrait ? (format === 'large' ? 22 : 13) : 12, weight: 800, colour: LEVEL_TEXT_COLOUR, align: 'left', wrap: false, uppercase: true });
  front.push({ id: id('marker'), name: 'No-photo mark', type: 'marker', x: w - m - bandH * 0.7, y: bandH * 0.15, w: bandH * 0.7, h: bandH * 0.7 });
  if (portrait) {
    const nameY = bandH + (format === 'large' ? 6 : 3.5);
    // Two lines' room, so a long preferred name and surname wrap rather than shrink.
    const nameH = format === 'large' ? 20 : 12;
    front.push({ id: id('name'), name: 'Name', type: 'text', text: '{name}', x: m, y: nameY, w: w - 2 * m, h: nameH, font: 'nunito-sans', size: format === 'large' ? 26 : 15, weight: 800, colour: '#16201B', align: 'center', wrap: true });
    const qrSide = Math.min(w - 2 * m - 6, h * 0.45);
    const codeH = format === 'large' ? 7 : 5;
    const qrY = h - m - codeH - qrSide - 1;
    front.push({ id: id('qr'), name: 'QR code', type: 'qr', x: (w - qrSide) / 2, y: qrY, w: qrSide, h: qrSide });
    front.push({ id: id('code'), name: 'Lanyard code', type: 'text', text: '{code}', x: m, y: h - m - codeH, w: w - 2 * m, h: codeH, font: 'nunito-sans', size: format === 'large' ? 13 : 9, weight: 700, colour: '#16201B', align: 'center', wrap: false });
  } else {
    const qrSide = h - bandH - 2 * m - 1;
    const qrX = w - m - qrSide;
    const top = bandH + m;
    const textW = qrX - 2 * m;
    front.push({ id: id('name'), name: 'Name', type: 'text', text: '{name}', x: m, y: top, w: textW, h: 18, font: 'nunito-sans', size: 15, weight: 800, colour: '#16201B', align: 'left', wrap: true });
    front.push({ id: id('code'), name: 'Lanyard code', type: 'text', text: '{code}', x: m, y: h - m - 5, w: textW, h: 5, font: 'nunito-sans', size: 9, weight: 700, colour: '#16201B', align: 'left', wrap: false });
    front.push({ id: id('qr'), name: 'QR code', type: 'qr', x: qrX, y: top, w: qrSide, h: qrSide });
  }
  const back: DesignElement[] = [
    { id: id('back-camp'), name: 'Camp name', type: 'text', text: '{camp}', x: m, y: h * 0.32, w: w - 2 * m, h: portrait ? 14 : 10, font: 'nunito-sans', size: format === 'large' ? 20 : 13, weight: 800, colour: '#16201B', align: 'center', wrap: true },
    { id: id('back-note'), name: 'If found', type: 'text', text: 'If found, please hand this to a camp leader.', x: m, y: h - m - (portrait ? 12 : 8), w: w - 2 * m, h: portrait ? 10 : 6, font: 'nunito-sans', size: format === 'large' ? 10 : 7, weight: 400, colour: '#45514C', align: 'center', wrap: true },
  ];
  return { version: 1, format, orientation, front: { background: '#FFFFFF', elements: front }, back: { background: '#FFFFFF', elements: back } };
}

/**
 * Things worth fixing before printing. A design can still be printed with
 * warnings; scanners just need a QR code somewhere.
 */
export function designWarnings(d: LanyardDesign): { level: 'error' | 'warning'; message: string; side?: SideKey; elementId?: string }[] {
  const out: ReturnType<typeof designWarnings> = [];
  const { w, h } = cardSize(d.format, d.orientation);
  const all = (['front', 'back'] as const).flatMap((side) => d[side].elements.map((e) => ({ side, e })));
  const qrs = all.filter((x) => x.e.type === 'qr');
  if (qrs.length === 0) out.push({ level: 'error', message: 'Add a QR code. Scanners need it to know who this is.' });
  for (const { side, e } of qrs) {
    const s = Math.min(e.w, e.h);
    if (s < 15) out.push({ level: 'warning', message: `The QR code on the ${side} is ${s.toFixed(0)} mm. Make it at least 15 mm so phones read it quickly.`, side, elementId: e.id });
  }
  // Anything stacked on top of a QR code that overlaps it stops phones reading it.
  for (const side of ['front', 'back'] as const) {
    const list = d[side].elements;
    list.forEach((qr, i) => {
      if (qr.type !== 'qr') return;
      for (const e of list.slice(i + 1)) {
        const overlap = e.x < qr.x + qr.w && e.x + e.w > qr.x && e.y < qr.y + qr.h && e.y + e.h > qr.y;
        if (overlap) out.push({ level: 'error', message: `${e.name ?? 'Something'} covers part of the QR code on the ${side}. Move it, or send it behind the QR code.`, side, elementId: e.id });
      }
    });
  }
  const hasCode = all.some((x) => x.e.type === 'text' && x.e.text.includes('{code}'));
  if (!hasCode) out.push({ level: 'warning', message: 'Add the lanyard code ({code}). Staff type it in when a QR code won’t scan.' });
  const hasName = all.some((x) => x.e.type === 'text' && /\{(name|first)\}/.test(x.e.text));
  if (!hasName) out.push({ level: 'warning', message: 'Add the person’s name, so staff can check the card belongs to them.' });
  for (const { side, e } of all) {
    const outside = e.x + e.w <= 0 || e.y + e.h <= 0 || e.x >= w || e.y >= h;
    if (outside) out.push({ level: 'warning', message: `${e.name ?? 'Something'} on the ${side} is off the card and won’t print.`, side, elementId: e.id });
  }
  return out;
}
