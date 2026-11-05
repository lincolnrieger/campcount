/**
 * Reading a camp programme from a spreadsheet: which column is which, and
 * turning the many ways people write days and times into real ones.
 */
import { dayLabel, weekdayName } from './time';

export const PROGRAM_FIELDS = {
  name: { label: 'Name', required: true, aliases: ['name', 'activity', 'session', 'title', 'event', 'what', 'program', 'programme', 'item'] },
  type: { label: 'Type (activity, meal or programme)', required: false, aliases: ['type', 'kind', 'category'] },
  day: { label: 'Day or date', required: false, aliases: ['day', 'date', 'when'] },
  start: { label: 'Start time', required: false, aliases: ['start', 'start time', 'starts', 'from', 'begins', 'time'] },
  end: { label: 'End time', required: false, aliases: ['end', 'end time', 'ends', 'finish', 'finishes', 'to', 'until'] },
  duration: { label: 'Length (minutes)', required: false, aliases: ['duration', 'length', 'mins', 'minutes'] },
  location: { label: 'Place', required: false, aliases: ['location', 'place', 'venue', 'where', 'area', 'site'] },
  capacity: { label: 'Places (capacity)', required: false, aliases: ['capacity', 'max', 'places', 'limit', 'spots', 'max people'] },
  booking: { label: 'Booking required', required: false, aliases: ['booking', 'booking required', 'rego', 'registration', 'register', 'book'] },
  description: { label: 'Description', required: false, aliases: ['description', 'details', 'notes', 'info'] },
  instructions: { label: 'Instructions for leaders', required: false, aliases: ['instructions', 'leader notes', 'leader instructions', 'staff notes'] },
} as const;

export type ProgramField = keyof typeof PROGRAM_FIELDS;
export type ProgramMapping = Partial<Record<ProgramField, number>>;

const norm = (s: string) => s.trim().toLowerCase().replace(/[_\s]+/g, ' ');

export function autoMapProgram(headers: string[]): ProgramMapping {
  const mapping: ProgramMapping = {};
  const taken = new Set<number>();
  const h = headers.map(norm);
  for (const [field, def] of Object.entries(PROGRAM_FIELDS) as [ProgramField, (typeof PROGRAM_FIELDS)[ProgramField]][]) {
    const index = h.findIndex((x, i) => !taken.has(i) && (def.aliases as readonly string[]).includes(x));
    if (index >= 0) {
      mapping[field] = index;
      taken.add(index);
    }
  }
  return mapping;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * A day written any common way, as one of the camp's days (YYYY-MM-DD), or
 * null. Accepts 2026-12-05, 5/12/2026 (Australian day/month), 5 Dec,
 * Saturday / Sat, "Day 2" or "2", and Excel date numbers.
 */
export function parseDay(value: string, days: string[]): string | null {
  const v = value.trim().toLowerCase();
  if (!v || days.length === 0) return null;
  const inCamp = (d: string) => (days.includes(d) ? d : null);
  let m: RegExpMatchArray | null;
  if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return inCamp(iso(+m[1]!, +m[2]!, +m[3]!));
  if ((m = v.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/))) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : +days[0]!.slice(0, 4);
    return inCamp(iso(year, +m[2]!, +m[1]!));
  }
  // "Day 2", "2", "D2"
  if ((m = v.match(/^(?:day\s*|d)?(\d{1,2})$/)) && +m[1]! >= 1) {
    const n = +m[1]!;
    if (/^\d+$/.test(v) && n > 31) return null;
    return days[n - 1] ?? null;
  }
  // Excel serial dates (days since 1899-12-30).
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(+v) * 86_400_000).toISOString().slice(0, 10);
    return inCamp(d);
  }
  // "5 Dec", "Sat 5 Dec", "December 5", "5th December 2026"
  const month = MONTHS.findIndex((mo) => new RegExp(`\\b${mo}`).test(v));
  const dayNum = v.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
  if (month >= 0 && dayNum) {
    const year = v.match(/\b(20\d{2})\b/)?.[1];
    return inCamp(iso(year ? +year : +days[0]!.slice(0, 4), month + 1, +dayNum[1]!));
  }
  // A weekday name: the first camp day that falls on it.
  const word = v.replace(/[^a-z]/g, '');
  if (word.length >= 3) {
    const found = days.find((d) => weekdayName(d).toLowerCase().startsWith(word.slice(0, 3)));
    if (found) return found;
  }
  return null;
}

/**
 * A clock time written any common way, as "HH:MM" (24-hour), or null:
 * 9, 9:00, 09:00, 9.30, 930, 9am, 9:30 pm, 14:30, noon, midday, and Excel
 * time fractions (0.375).
 */
export function parseTime(value: string): string | null {
  const v = value.trim().toLowerCase().replace(/\s+/g, '');
  if (!v) return null;
  if (v === 'noon' || v === 'midday') return '12:00';
  if (v === 'midnight') return '00:00';
  if (/^0?\.\d+$/.test(v)) {
    const mins = Math.round(Number(v) * 1440);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
  const m = v.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = +m[1]!;
  const min = m[2] ? +m[2] : 0;
  const ap = m[3]?.[0];
  if (min > 59 || h > 24) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap === 'p' && h !== 12) h += 12;
    if (ap === 'a' && h === 12) h = 0;
  }
  if (h === 24) h = 0;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const MEAL_NAME = /^(breakfast|brekkie|brunch|lunch|dinner|tea|morning tea|afternoon tea|supper|smoko|bbq dinner|bbq lunch)\b/i;

/** A programme item (Welcome, Movies…): on the schedule, never booked or scanned. */
export function isProgramType(type: string): boolean {
  return /program|schedule|info|general|event/.test(type.trim().toLowerCase());
}

/** "Yes", "Required", "Rego", "Y", "true", "x" mean booking is needed. */
export function needsBooking(value: string): boolean {
  return /^(y|yes|true|x|1|required|rego|registration|book|booking|needed|must book)/.test(value.trim().toLowerCase());
}

/** Is this row a meal? Uses the type column when there is one, otherwise the name. */
export function isMealRow(type: string, name: string): boolean {
  const t = type.trim().toLowerCase();
  if (t) return /meal|food|breakfast|lunch|dinner|tea|supper/.test(t);
  return MEAL_NAME.test(name.trim());
}

export interface ProgramRow {
  /** Line in the file (the header is line 1). */
  line: number;
  kind: 'activity' | 'meal' | 'program';
  bookingRequired: boolean;
  name: string;
  day: string | null;
  start: string | null;
  end: string | null;
  location: string;
  capacity: number | null;
  description: string;
  instructions: string;
  errors: string[];
  notes: string[];
}

const addMinutes = (time: string, mins: number) => {
  const total = (+time.slice(0, 2) * 60 + +time.slice(3) + mins + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** Turn spreadsheet rows into programme rows, with plain-English problems for anything unclear. */
export function prepareProgram(rows: string[][], mapping: ProgramMapping, days: string[], opts: { mealsByName: boolean }): ProgramRow[] {
  const get = (r: string[], f: ProgramField) => (mapping[f] === undefined ? '' : (r[mapping[f]!] ?? '').trim());
  return rows
    .map((r, i) => ({ r, line: i + 2 }))
    .filter(({ r }) => r.some((c) => c.trim()))
    .map(({ r, line }) => {
      const errors: string[] = [];
      const notes: string[] = [];
      const name = get(r, 'name').slice(0, 80);
      if (!name) errors.push('No name');
      const dayText = get(r, 'day');
      let day = parseDay(dayText, days);
      if (dayText && !day) errors.push(`"${dayText}" isn't one of the camp's days`);
      if (!dayText && days.length === 1) day = days[0]!;
      const startText = get(r, 'start');
      const endText = get(r, 'end');
      // A single "9:00-10:30" in the start column.
      const range = startText.match(/^(.+?)\s*(?:-|–|to)\s*(.+)$/i);
      const start = parseTime(range ? range[1]! : startText);
      let end = parseTime(range && !endText ? range[2]! : endText);
      if (startText && !start) errors.push(`Can't read the start time "${startText}"`);
      if (endText && !end) errors.push(`Can't read the end time "${endText}"`);
      const duration = Number.parseInt(get(r, 'duration'), 10);
      if (start && !end && Number.isFinite(duration) && duration > 0) end = addMinutes(start, Math.min(duration, 1440));
      if (start && !day && !dayText) errors.push('Has a time but no day');
      if (!start && end) {
        notes.push('No start time, so the end time is ignored');
        end = null;
      }
      if (start && end && end <= start) {
        if (end < start) errors.push('Ends before it starts');
        else end = null;
      }
      if (!start && day) {
        notes.push('No start time, so it runs all camp');
        day = null;
      }
      const capText = get(r, 'capacity');
      const cap = Number.parseInt(capText, 10);
      const capacity = capText && Number.isFinite(cap) && cap > 0 ? Math.min(cap, 10000) : null;
      if (capText && capacity === null) notes.push(`Places "${capText}" ignored`);
      const type = get(r, 'type');
      const kind: ProgramRow['kind'] = isProgramType(type) ? 'program' : isMealRow(type, name) && (mapping.type !== undefined || opts.mealsByName) ? 'meal' : 'activity';
      const bookingRequired = kind === 'activity' && needsBooking(get(r, 'booking'));
      return {
        line,
        kind,
        bookingRequired,
        name,
        day,
        start,
        end,
        location: get(r, 'location').slice(0, 120),
        capacity: kind === 'activity' ? capacity : null,
        description: get(r, 'description').slice(0, 1000),
        instructions: get(r, 'instructions').slice(0, 2000),
        errors,
        notes,
      };
    });
}

/** "Sat 5 Dec, 9:00–10:30" for the check step. */
export function describeWhen(row: Pick<ProgramRow, 'day' | 'start' | 'end'>): string {
  if (!row.day) return 'No set time';
  if (!row.start) return `${dayLabel(row.day)}, no set time`;
  return `${dayLabel(row.day)}, ${row.start}${row.end ? `–${row.end}` : ''}`;
}
