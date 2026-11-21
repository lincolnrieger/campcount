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

/** The camp's setting as stored (a JSON list), tolerating anything odd. */
export function parseYouthSections(json: string | null | undefined): YouthSectionOption[] {
  try {
    const v = JSON.parse(json ?? '') as unknown;
    if (Array.isArray(v)) return YOUTH_SECTION_OPTIONS.filter((s) => v.includes(s));
  } catch {
    // fall through
  }
  return [...DEFAULT_YOUTH_SECTIONS];
}
