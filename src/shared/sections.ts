/** Scouts SA sections, in age order. Kept free of zod so the web app can import it cheaply. */
export const SECTIONS = ['Joeys', 'Cubs', 'Scouts', 'Venturers', 'Rovers', 'Leaders', 'Other'] as const;

/** Sections a camp can count as youth. Leaders are always adults. */
export const YOUTH_SECTION_OPTIONS = ['Joeys', 'Cubs', 'Scouts', 'Venturers', 'Rovers', 'Other'] as const;
export type YouthSectionOption = (typeof YOUTH_SECTION_OPTIONS)[number];
export const DEFAULT_YOUTH_SECTIONS: YouthSectionOption[] = [...YOUTH_SECTION_OPTIONS];

/** Youth or adult, from someone's section and the camp's setting. */
export function kindForSection(section: string, youthSections: readonly string[]): 'youth' | 'adult' {
  return section !== 'Leaders' && youthSections.includes(section) ? 'youth' : 'adult';
}

/** The camp's youth sections as stored (a JSON list of section names), tolerating anything odd. */
export function parseYouthSections(json: string | null | undefined): string[] {
  try {
    const v = JSON.parse(json ?? '') as unknown;
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x !== 'Leaders');
  } catch {
    // fall through
  }
  return [...DEFAULT_YOUTH_SECTIONS];
}

// ---------------------------------------------------------------- a camp's own sections

/** The built-in kind of section behind each of a camp's sections (imports and lanyards work in these). */
export type SectionBase = (typeof SECTIONS)[number] | 'custom';

/** One of a camp's sections, as named and styled in Settings › Sections. */
export interface SectionSetting {
  /** What it's called at this camp, and what people's section is stored as. */
  name: string;
  /** Which built-in section this is (renamed or not), or 'custom' for one the camp added. */
  base: SectionBase;
  /** The word on lanyards and participant pages ("Joey", "Leader"). Empty for none. */
  word: string;
  /** Lanyard band and pass colour, #RRGGBB. */
  colour: string;
  youth: boolean;
}

const BUILT_IN_STYLE: Record<(typeof SECTIONS)[number], { word: string; colour: string }> = {
  Joeys: { word: 'Joey', colour: '#8B5A2B' },
  Cubs: { word: 'Cub', colour: '#FFC82E' },
  Scouts: { word: 'Scout', colour: '#00843D' },
  Venturers: { word: 'Venturer', colour: '#7A1F3D' },
  Rovers: { word: 'Rover', colour: '#C8102E' },
  // Navy, RGB 38 38 97.
  Leaders: { word: 'Leader', colour: '#262661' },
  Other: { word: '', colour: '#5A6770' },
};

/** Readable text on a colour: near-black on light colours, white on dark ones. */
export function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#FFFFFF';
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.4 ? '#1A1A1A' : '#FFFFFF';
}

export function defaultSectionSettings(youth: readonly string[] = DEFAULT_YOUTH_SECTIONS as readonly string[]): SectionSetting[] {
  return SECTIONS.map((s) => ({ name: s, base: s, word: BUILT_IN_STYLE[s].word, colour: BUILT_IN_STYLE[s].colour, youth: s !== 'Leaders' && youth.includes(s) }));
}

/** A camp's sections as stored, falling back to the built-ins (with its youth setting) when it has none. */
export function parseSectionSettings(json: string | null | undefined, youthJson?: string | null): SectionSetting[] {
  const youth = parseYouthSections(youthJson);
  try {
    const v = JSON.parse(json ?? '') as SectionSetting[];
    if (Array.isArray(v) && v.length) {
      const list = v.filter((s) => s && typeof s.name === 'string' && s.name.trim());
      // Every built-in is always there, even if something odd was stored.
      for (const d of defaultSectionSettings(youth)) if (!list.some((s) => s.base === d.base)) list.push(d);
      return list.map((s) => ({ ...s, youth: s.base === 'Leaders' ? false : youth.includes(s.name) }));
    }
  } catch {
    // fall through
  }
  return defaultSectionSettings(youth);
}

/** The camp's name for a built-in section (e.g. "Leaders" might be called "Adults"). */
export function nameForBase(settings: readonly SectionSetting[], base: (typeof SECTIONS)[number]): string {
  return settings.find((s) => s.base === base)?.name ?? base;
}

/**
 * What a section given by an import, form or older code is called at this
 * camp: a name it uses, else a built-in it has renamed, else Other.
 */
export function normalizeSection(input: string, settings: readonly SectionSetting[]): string {
  const t = input.trim();
  const exact = settings.find((s) => s.name === t) ?? settings.find((s) => s.name.toLowerCase() === t.toLowerCase());
  if (exact) return exact.name;
  const builtIn = (SECTIONS as readonly string[]).find((b) => b.toLowerCase() === t.toLowerCase());
  if (builtIn) return nameForBase(settings, builtIn as (typeof SECTIONS)[number]);
  return nameForBase(settings, 'Other');
}

/** The lanyard word and colours for someone's section at this camp. */
export function sectionStyle(settings: readonly SectionSetting[], section: string): { word: string; bg: string; fg: string } {
  const s = settings.find((x) => x.name === section) ?? settings.find((x) => x.base === 'Other');
  const colour = s?.colour ?? BUILT_IN_STYLE.Other.colour;
  return { word: s?.word ?? '', bg: colour, fg: textOn(colour) };
}
