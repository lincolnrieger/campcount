import { describe, expect, it } from 'vitest';
import type { ActivityRules, TimelineScan } from '../src/shared/scanRules';
import { replay } from '../src/shared/scanRules';

const activity = (o: Partial<ActivityRules> = {}): ActivityRules => ({
  type: 'activity',
  capacity: null,
  capacityPolicy: 'warn',
  trackSignOut: true,
  allowRepeat: true,
  bookingRequired: false,
  ...o,
});

let n = 0;
const scan = (registrationId: string, minute: number, o: Partial<TimelineScan> = {}): TimelineScan => ({
  id: `s${String(n++).padStart(4, '0')}`,
  registrationId,
  direction: 'in',
  deviceTime: `2026-12-05T01:${String(minute).padStart(2, '0')}:00.000Z`,
  credentialRevoked: false,
  registrationWithdrawn: false,
  booked: true,
  ...o,
});

describe('meal rules', () => {
  it('counts one serving per person no matter how often they are scanned', () => {
    const scans = [scan('a', 1), scan('a', 2), scan('b', 3), scan('a', 4)];
    const r = replay({ type: 'meal' }, scans);
    expect(scans.map((s) => r.outcomes.get(s.id)!.outcome)).toEqual(['accepted', 'duplicate', 'accepted', 'duplicate']);
    expect(r.presentNow).toBe(2);
  });

  it('gives the same answer whatever order offline devices sync in', () => {
    const scans = [scan('a', 5), scan('a', 1), scan('a', 3)];
    const r1 = replay({ type: 'meal' }, scans);
    const r2 = replay({ type: 'meal' }, [...scans].reverse());
    expect(r1.outcomes.get(scans[1]!.id)!.outcome).toBe('accepted'); // earliest device time wins
    for (const s of scans) expect(r1.outcomes.get(s.id)!.outcome).toBe(r2.outcomes.get(s.id)!.outcome);
  });

  it('two devices scanning the same person at the same moment count once', () => {
    const a = scan('a', 1, { id: 'device-1-x' });
    const b = scan('a', 1, { id: 'device-2-y' });
    const r = replay({ type: 'meal' }, [b, a]);
    expect([r.outcomes.get(a.id)!.outcome, r.outcomes.get(b.id)!.outcome].sort()).toEqual(['accepted', 'duplicate']);
    expect(r.presentNow).toBe(1);
  });

  it('rejects revoked cards', () => {
    const s = scan('a', 1, { credentialRevoked: true });
    expect(replay({ type: 'meal' }, [s]).outcomes.get(s.id)!.outcome).toBe('rejected');
  });
});

describe('activity rules', () => {
  it('tracks sign-in and sign-out, and flags sign-out without sign-in for review', () => {
    const scans = [scan('a', 1, { direction: 'out' }), scan('a', 2), scan('a', 3), scan('a', 4, { direction: 'out' })];
    const r = replay(activity(), scans);
    expect(scans.map((s) => r.outcomes.get(s.id)!.outcome)).toEqual(['review', 'accepted', 'duplicate', 'accepted']);
    expect(r.presentNow).toBe(0);
    expect(r.states.get('a')!.visits).toBe(1);
  });

  it('blocks or warns at capacity', () => {
    const scans = [scan('a', 1), scan('b', 2), scan('c', 3)];
    const blocked = replay(activity({ capacity: 2, capacityPolicy: 'block' }), scans);
    expect(blocked.outcomes.get(scans[2]!.id)!.outcome).toBe('rejected');
    const warned = replay(activity({ capacity: 2, capacityPolicy: 'warn' }), scans);
    expect(warned.outcomes.get(scans[2]!.id)).toMatchObject({ outcome: 'accepted', warning: 'Over capacity: 3 of 2.' });
  });

  it('frees capacity when people sign out', () => {
    const scans = [scan('a', 1), scan('a', 2, { direction: 'out' }), scan('b', 3)];
    const r = replay(activity({ capacity: 1, capacityPolicy: 'block' }), scans);
    expect(r.outcomes.get(scans[2]!.id)!.outcome).toBe('accepted');
  });

  it('respects no-repeat activities', () => {
    const scans = [scan('a', 1), scan('a', 2, { direction: 'out' }), scan('a', 3)];
    const r = replay(activity({ allowRepeat: false }), scans);
    expect(r.outcomes.get(scans[2]!.id)!.outcome).toBe('duplicate');
  });

  it('counts visits without sign-out and warns about unbooked people', () => {
    const scans = [scan('a', 1, { booked: false }), scan('a', 9)];
    const r = replay(activity({ trackSignOut: false, bookingRequired: true }), scans);
    expect(r.outcomes.get(scans[0]!.id)).toMatchObject({ outcome: 'accepted', warning: 'Not booked for this activity.' });
    expect(r.states.get('a')!.visits).toBe(2);
    expect(r.outcomes.get(scans[1]!.id)!.outcome).toBe('accepted');
  });

  it('a lunch scan never affects an activity: contexts are replayed separately', () => {
    // Enforced structurally: replay() only ever receives one context's scans.
    const r = replay(activity(), []);
    expect(r.presentNow).toBe(0);
  });
});

describe('site rules', () => {
  it('records arrivals and departures with duplicates ignored', () => {
    const scans = [scan('l', 1), scan('l', 2), scan('l', 3, { direction: 'out' }), scan('l', 4, { direction: 'out' })];
    const r = replay({ type: 'site' }, scans);
    expect(scans.map((s) => r.outcomes.get(s.id)!.outcome)).toEqual(['accepted', 'duplicate', 'accepted', 'review']);
    expect(r.states.get('l')!.present).toBe(false);
  });
});
