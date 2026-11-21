import { saysNothing } from './myscout';
import type { ImportRow } from './schemas';
import type { SECTIONS } from './sections';

/**
 * Import & check, worked out entirely in the browser: MyScout (who is
 * registered, and their position) and Consent2Go (activity consent and
 * extra dietary needs) linked person by person, then sent to the roster.
 * Nothing about the files is kept on the server.
 */

export type Section = (typeof SECTIONS)[number];

/** One person as one file has them. */
export interface FilePerson {
  /** As in the file; '' when Consent2Go has no usable Student ID. */
  memberNumber: string;
  firstName: string;
  preferredName: string;
  lastName: string;
  /** MyScout's position (their highest appointment). */
  position: string;
  /** MyScout: from the position, when it's a plain section (else null). Consent2Go: from the class or tab. */
  section: Section | null;
  groupName: string;
  photo: 'yes' | 'no' | 'unknown';
  dietaryText: string;
  roleLabel: string;
  team: string;
  sourceStatus: string;
  /** Consent2Go swimming and medication answers. */
  extra?: Record<string, string>;
  where: string;
}

/** Someone already on the camp's roster. */
export interface RosterPerson {
  id: string;
  memberNumber: string;
  firstName: string;
  preferredName: string;
  lastName: string;
  section: string;
  groupName: string;
  position: string;
  status: string;
}

export interface Linked {
  key: string;
  memberNumber: string;
  ms?: FilePerson;
  cg?: FilePerson;
  roster?: RosterPerson;
  /** How the Consent2Go row was matched to MyScout (or the roster). */
  link?: 'number' | 'name';
}

/** Membership numbers compared without spaces, case or leading zeros (Excel drops them). */
export const memberKey = (m: string) => m.replace(/\s+/g, '').toUpperCase().replace(/^0+(?=.)/, '');
const nameKey = (first: string, last: string) => `${first}|${last}`.toLowerCase().replace(/[^a-z|]/g, '');
const VALID_NUMBER = /^[A-Za-z0-9-]{1,20}$/;

/**
 * MyScout positions that are a section on their own. Anything else (a
 * leader appointment, a blank) is chosen by hand.
 */
export function positionSection(position: string): Section | null {
  const p = position.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^joeys?( scouts?)?$/.test(p)) return 'Joeys';
  if (/^cubs?( scouts?)?$/.test(p)) return 'Cubs';
  if (/^scouts?$/.test(p)) return 'Scouts';
  if (/^venturers?( scouts?)?$/.test(p)) return 'Venturers';
  if (/^rovers?( scouts?)?$/.test(p)) return 'Rovers';
  if (/^adult helpers?$/.test(p)) return 'Leaders';
  return null;
}

/**
 * Link Consent2Go rows to MyScout by membership number, then by name; then
 * to people already on the roster the same way. Rows that match nothing
 * and have a usable membership number stand on their own (and are listed);
 * rows with neither are returned as unmatched.
 */
export function linkPeople(ms: FilePerson[], cg: FilePerson[], roster: RosterPerson[]): { people: Linked[]; unmatched: FilePerson[] } {
  const byKey = new Map<string, Linked>();
  const rosterByKey = new Map(roster.map((r) => [memberKey(r.memberNumber), r]));
  for (const m of ms) {
    const key = memberKey(m.memberNumber);
    byKey.set(key, { key, memberNumber: m.memberNumber, ms: m, roster: rosterByKey.get(key) });
  }
  // Names that point at exactly one MyScout person (or roster person).
  const uniqueBy = <T>(items: T[], names: (t: T) => string[]) => {
    const seen = new Map<string, T | null>();
    for (const t of items) for (const n of new Set(names(t))) seen.set(n, seen.has(n) && seen.get(n) !== t ? null : t);
    return seen;
  };
  const msByName = uniqueBy([...byKey.values()], (l) => [nameKey(l.ms!.firstName, l.ms!.lastName), ...(l.ms!.preferredName ? [nameKey(l.ms!.preferredName, l.ms!.lastName)] : [])]);
  const rosterByName = uniqueBy(roster, (r) => [nameKey(r.firstName, r.lastName), ...(r.preferredName ? [nameKey(r.preferredName, r.lastName)] : [])]);

  const unmatched: FilePerson[] = [];
  for (const c of cg) {
    const key = c.memberNumber ? memberKey(c.memberNumber) : '';
    let target = key ? byKey.get(key) : undefined;
    let link: Linked['link'] = target ? 'number' : undefined;
    if (!target) {
      const named = msByName.get(nameKey(c.firstName, c.lastName));
      if (named) {
        target = named;
        link = 'name';
      }
    }
    if (target) {
      if (!target.cg) {
        target.cg = c;
        target.link = link;
      }
      continue;
    }
    // Not in MyScout: someone already on the roster?
    let r = key ? rosterByKey.get(key) : undefined;
    let rLink: Linked['link'] = r ? 'number' : undefined;
    if (!r) {
      r = rosterByName.get(nameKey(c.firstName, c.lastName)) ?? undefined;
      if (r) rLink = 'name';
    }
    const number = r?.memberNumber ?? (VALID_NUMBER.test(c.memberNumber) ? c.memberNumber : '');
    if (!number) {
      unmatched.push(c);
      continue;
    }
    const k = memberKey(number);
    if (byKey.has(k)) continue; // listed twice in Consent2Go
    byKey.set(k, { key: k, memberNumber: number, cg: c, roster: r, link: rLink });
  }
  return { people: [...byKey.values()].sort((a, b) => displayName(a).localeCompare(displayName(b))), unmatched };
}

export function displayName(p: Linked): string {
  const src = p.ms ?? p.roster ?? p.cg!;
  return `${src.preferredName || src.firstName} ${src.lastName}`.trim();
}

/** A section given by the files without anyone choosing: MyScout's position (or, for someone only in Consent2Go, their class). */
export function autoSection(p: Linked): Section | null {
  if (p.ms) return p.ms.section;
  return p.cg?.section && p.cg.section !== 'Other' ? p.cg.section : null;
}

/** Still needs a section chosen by hand. */
export const needsSection = (p: Linked, chosen: Partial<Record<string, Section>>) => autoSection(p) === null && !chosen[p.key];

const PHOTO_WORD = { yes: 'Yes', no: 'No', unknown: 'Not given' } as const;

/** One "no" anywhere means no photos; otherwise any "yes" is yes. Both answers are kept on the profile too. */
export function combinedPhoto(...answers: ('yes' | 'no' | 'unknown' | undefined)[]): 'yes' | 'no' | 'unknown' {
  if (answers.includes('no')) return 'no';
  if (answers.includes('yes')) return 'yes';
  return 'unknown';
}

/** Both files' dietary notes, as compared to tell whether they've been looked at. */
export const dietaryNotes = (p: Linked) => ({ myscout: p.ms?.dietaryText.trim() ?? '', consent2go: p.cg?.dietaryText.trim() ?? '' });
export const dietarySignature = (p: Linked) => {
  const n = dietaryNotes(p);
  return `${n.myscout.toLowerCase().replace(/\s+/g, ' ')}\u0000${n.consent2go.toLowerCase().replace(/\s+/g, ' ')}`;
};
/** Has notes worth reading (not empty, not just "Nil"). */
export const hasDietaryNotes = (p: Linked) => Object.values(dietaryNotes(p)).some((t) => t && !saysNothing(t));

/** The roster row for one person: everything except dietary needs, which are recorded by hand. */
export function buildRow(p: Linked, chosen?: Section): ImportRow | null {
  const names = p.ms ?? p.roster ?? p.cg;
  if (!names || !names.firstName || !names.lastName) return null;
  const rosterSection = p.roster && p.roster.section !== 'Other' ? (p.roster.section as Section) : null;
  const section = chosen ?? autoSection(p) ?? rosterSection ?? 'Other';
  const extra: Record<string, string> = {};
  if (p.ms) extra['Photo consent (MyScout)'] = PHOTO_WORD[p.ms.photo];
  if (p.cg) extra['Photo consent (Consent2Go)'] = PHOTO_WORD[p.cg.photo];
  for (const [k, v] of Object.entries(p.cg?.extra ?? {})) if (v) extra[k] = v;
  return {
    memberNumber: p.memberNumber,
    firstName: names.firstName.slice(0, 60),
    preferredName: (p.ms ? p.ms.preferredName : (p.roster?.preferredName ?? '')).slice(0, 60),
    lastName: names.lastName.slice(0, 60),
    kind: section === 'Leaders' ? 'adult' : 'youth',
    section,
    groupName: (p.cg?.groupName || p.ms?.groupName || p.roster?.groupName || '').slice(0, 120),
    position: (p.ms?.position ?? p.roster?.position ?? '').slice(0, 120),
    roleLabel: (p.ms?.roleLabel ?? '').slice(0, 60),
    team: (p.ms?.team ?? '').slice(0, 60),
    sourceStatus: (p.ms?.sourceStatus ?? '').slice(0, 160),
    photoConsent: combinedPhoto(p.ms?.photo, p.cg?.photo),
    dietaryFingerprint: null,
    ...(Object.keys(extra).length ? { extra } : {}),
  };
}
