import { describe, expect, it } from 'vitest';
import { autoMapProgram, isMealRow, parseDay, parseTime, prepareProgram } from '../src/shared/program';

// A Saturday-to-Monday camp.
const DAYS = ['2026-12-05', '2026-12-06', '2026-12-07'];

describe('reading a programme', () => {
  it('reads days written many ways', () => {
    const cases: [string, string | null][] = [
      ['2026-12-06', '2026-12-06'],
      ['6/12/2026', '2026-12-06'],
      ['06/12/26', '2026-12-06'],
      ['6/12', '2026-12-06'],
      ['Sunday', '2026-12-06'],
      ['sun', '2026-12-06'],
      ['Sat 5 Dec', '2026-12-05'],
      ['7th December 2026', '2026-12-07'],
      ['Day 2', '2026-12-06'],
      ['2', '2026-12-06'],
      ['46362', '2026-12-06'],
      ['Friday', null],
      ['2026-12-09', null],
      ['Day 9', null],
      ['', null],
    ];
    for (const [text, want] of cases) expect(parseDay(text, DAYS), text).toBe(want);
  });

  it('reads times written many ways', () => {
    const cases: [string, string | null][] = [
      ['9', '09:00'],
      ['9:00', '09:00'],
      ['09:30', '09:30'],
      ['9.30', '09:30'],
      ['930', '09:30'],
      ['9am', '09:00'],
      ['9:30 pm', '21:30'],
      ['12pm', '12:00'],
      ['12am', '00:00'],
      ['14:30', '14:30'],
      ['noon', '12:00'],
      ['0.375', '09:00'],
      ['13pm', null],
      ['9:75', null],
      ['soon', null],
    ];
    for (const [text, want] of cases) expect(parseTime(text), text).toBe(want);
  });

  it('matches common column names and spots meals', () => {
    expect(autoMapProgram(['Activity', 'Date', 'Start time', 'Finish', 'Venue', 'Max'])).toEqual({ name: 0, day: 1, start: 2, end: 3, location: 4, capacity: 5 });
    expect(isMealRow('', 'Breakfast')).toBe(true);
    expect(isMealRow('', 'Morning tea')).toBe(true);
    expect(isMealRow('', 'Teamwork games')).toBe(false);
    expect(isMealRow('Activity', 'Lunch hike')).toBe(false);
    expect(isMealRow('Meal', 'BBQ')).toBe(true);
  });

  it('builds rows, with clear problems for anything it cannot read', () => {
    const rows = [
      ['Kayaking', 'Sat', '9:00', '10:30', '', 'Lake', '12'],
      ['Archery', 'Sunday', '2pm', '', '90', 'Range', 'lots'],
      ['Breakfast', 'Sun', '7:30-8:30', '', '', 'Hall', ''],
      ['Campfire', '', '', '', '', '', ''],
      ['Night hike', 'Friday', '20:00', '', '', '', ''],
      ['Rafting', 'Sat', '11:00', '10:00', '', '', ''],
      ['', '', '', '', '', '', ''],
    ];
    const mapping = { name: 0, day: 1, start: 2, end: 3, duration: 4, location: 5, capacity: 6 };
    const out = prepareProgram(rows, mapping, DAYS, { mealsByName: true });
    expect(out).toHaveLength(6);
    expect(out[0]).toMatchObject({ kind: 'activity', day: '2026-12-05', start: '09:00', end: '10:30', capacity: 12, errors: [] });
    expect(out[1]).toMatchObject({ day: '2026-12-06', start: '14:00', end: '15:30', capacity: null });
    expect(out[1]!.notes[0]).toMatch(/lots/);
    expect(out[2]).toMatchObject({ kind: 'meal', start: '07:30', end: '08:30' });
    expect(out[3]).toMatchObject({ day: null, start: null, errors: [] });
    expect(out[4]!.errors[0]).toMatch(/Friday/);
    expect(out[5]!.errors).toContain('Ends before it starts');
  });
});
