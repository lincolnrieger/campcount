/**
 * Levels: how a camp groups its people (age groups, year levels, crews,
 * staff…). Nothing is built in beyond a plain starting pair: each camp names
 * its own, and new names arriving in an import are added automatically.
 * Kept free of zod so the web app can import it cheaply.
 */

/** One of a camp's levels, as named and styled in Settings › Levels. */
export interface LevelSetting {
  /** What it's called at this camp, and what people's level is stored as. */
  name: string;
  /** The word on lanyards and participant pages ("Participant", "Leader"). Empty for none. */
  word: string;
  /** Lanyard band and pass colour, #RRGGBB. */
  colour: string;
  /** Counted as a young person (youth) rather than an adult. */
  youth: boolean;
  /**
   * Other names that mean this level, linked on the import screen (for
   * example "Early Bird Youth" and "Full Participant Youth" both mean Youth).
   * Imports file anyone with one of these under this level.
   */
  aliases?: string[];
}

/** What a new camp starts with. Rename, add or remove freely. */
export const STARTING_LEVELS: readonly LevelSetting[] = [
  { name: 'Participants', word: 'Participant', colour: '#1F6F8B', youth: true },
  { name: 'Leaders', word: 'Leader', colour: '#262661', youth: false },
];

/** Colours given to levels added by an import, in turn. */
const PALETTE = ['#1F6F8B', '#B5651D', '#2E7D32', '#7A1F3D', '#C8102E', '#5B3C88', '#00796B', '#8D6E00', '#5A6770'];

/** Level names that read as adults when an import adds them. */
const ADULT_NAME = /leader|adult|staff|helper|volunteer|parent|carer|coach|teacher|supervisor|crew boss|official/i;

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

/** The camp's youth levels as stored (a JSON list of names), or null when there's no usable list. */
export function parseYouthLevels(json: string | null | undefined): string[] | null {
  try {
    const v = JSON.parse(json ?? '') as unknown;
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  } catch {
    // fall through
  }
  return null;
}

/** A camp's levels as stored, or the starting pair when it has none. */
export function parseLevelSettings(json: string | null | undefined, youthJson?: string | null): LevelSetting[] {
  const youth = parseYouthLevels(youthJson);
  let list: LevelSetting[] = [];
  try {
    const v = JSON.parse(json ?? '') as Partial<LevelSetting>[];
    if (Array.isArray(v)) {
      list = v
        .filter((s) => s && typeof s.name === 'string' && s.name.trim())
        .map((s) => ({
          name: s.name!,
          word: typeof s.word === 'string' ? s.word : '',
          colour: typeof s.colour === 'string' && /^#[0-9a-f]{6}$/i.test(s.colour) ? s.colour : PALETTE[PALETTE.length - 1]!,
          youth: Boolean(s.youth),
          ...(Array.isArray(s.aliases) && s.aliases.length ? { aliases: s.aliases.filter((a): a is string => typeof a === 'string' && a.trim() !== '') } : {}),
        }));
    }
  } catch {
    // fall through
  }
  // A camp that has never saved its levels starts with the plain pair (the old youth list doesn't apply to them).
  if (list.length === 0) return STARTING_LEVELS.map((s) => ({ ...s }));
  return youth ? list.map((s) => ({ ...s, youth: youth.includes(s.name) })) : list;
}

/** Youth or adult, from someone's level and the camp's levels. Unknown levels count as adults. */
export function kindForLevel(level: string, levels: readonly LevelSetting[] | readonly string[]): 'youth' | 'adult' {
  if (levels.length > 0 && typeof levels[0] === 'string') return (levels as readonly string[]).includes(level) ? 'youth' : 'adult';
  return (levels as readonly LevelSetting[]).find((s) => s.name === level)?.youth ? 'youth' : 'adult';
}

/** The camp's name for a level: its own name or a linked name, matched without case; the input itself (trimmed) when it's new. */
export function normalizeLevel(input: string, levels: readonly LevelSetting[]): string {
  const t = input.trim().replace(/\s+/g, ' ').slice(0, 40);
  const l = t.toLowerCase();
  return (
    levels.find((s) => s.name === t)?.name ??
    levels.find((s) => s.name.toLowerCase() === l)?.name ??
    levels.find((s) => s.aliases?.some((a) => a.toLowerCase() === l))?.name ??
    t
  );
}

/**
 * Link imported names to levels ({ "Early Bird Youth": "Youth" }): the target
 * level is added if it's new, and each name becomes one of its linked names
 * (moved from any other level). Returns the levels and whether anything changed.
 */
export function linkLevels(levels: readonly LevelSetting[], links: Record<string, string>): { levels: LevelSetting[]; changed: boolean } {
  const targets = Object.values(links).map((t) => normalizeLevel(t, levels));
  const added = withLevels(levels, targets);
  const next = added.levels.map((s) => ({ ...s, aliases: [...(s.aliases ?? [])] }));
  let changed = added.added.length > 0;
  for (const [from, to] of Object.entries(links)) {
    const name = from.trim().replace(/\s+/g, ' ').slice(0, 40);
    const target = next.find((s) => s.name === normalizeLevel(to, next));
    if (!name || !target || name.toLowerCase() === target.name.toLowerCase()) continue;
    // A level's own name can't be linked to another level.
    if (next.some((s) => s.name.toLowerCase() === name.toLowerCase())) continue;
    // A name means one level: take it off any other.
    for (const s of next) {
      if (s === target) continue;
      const before = s.aliases.length;
      s.aliases = s.aliases.filter((a) => a.toLowerCase() !== name.toLowerCase());
      if (s.aliases.length !== before) changed = true;
    }
    if (!target.aliases.some((a) => a.toLowerCase() === name.toLowerCase())) {
      target.aliases.push(name);
      changed = true;
    }
  }
  return { levels: next.map(({ aliases, ...s }) => (aliases.length ? { ...s, aliases } : s)), changed };
}

/** Where someone goes when a file doesn't give a level: the first youth level, or the first adult one for adults. */
export function defaultLevel(kind: 'youth' | 'adult', levels: readonly LevelSetting[]): string {
  return (levels.find((s) => s.youth === (kind === 'youth')) ?? levels[0] ?? STARTING_LEVELS[0]!).name;
}

/** The levels with any new names added on the end (adult if the name reads as one), and whether anything was added. */
export function withLevels(levels: readonly LevelSetting[], names: Iterable<string>): { levels: LevelSetting[]; added: string[] } {
  const next = levels.map((s) => ({ ...s }));
  const added: string[] = [];
  for (const raw of names) {
    const name = normalizeLevel(raw, next);
    if (!name || next.some((s) => s.name === name)) continue;
    next.push({
      name,
      word: name.length > 3 && /s$/i.test(name) && !/ss$/i.test(name) ? name.slice(0, -1) : name,
      colour: PALETTE[next.length % PALETTE.length]!,
      youth: !ADULT_NAME.test(name),
    });
    added.push(name);
  }
  return { levels: next, added };
}

/** The lanyard word and colours for someone's level at this camp. */
export function levelStyle(levels: readonly LevelSetting[], level: string): { word: string; bg: string; fg: string } {
  const s = levels.find((x) => x.name === level);
  const colour = s?.colour ?? PALETTE[PALETTE.length - 1]!;
  return { word: s?.word ?? '', bg: colour, fg: textOn(colour) };
}
