/**
 * Attendance rules, shared by the scanning device (instant feedback, offline)
 * and the server (authoritative results and reports).
 *
 * Scans are never edited. The state of any person in any context is derived
 * by replaying their scans in device-time order, so late-syncing offline
 * devices and simultaneous scans on two phones still produce one consistent
 * answer, and repeated scans are never double-counted.
 */

export type ContextType = 'activity' | 'meal' | 'site';
export type Direction = 'in' | 'out';
export type Outcome = 'accepted' | 'duplicate' | 'rejected' | 'review';

export interface ActivityRules {
  type: 'activity';
  capacity: number | null;
  capacityPolicy: 'warn' | 'block';
  trackSignOut: boolean;
  allowRepeat: boolean;
  bookingRequired: boolean;
}
export interface MealRules {
  type: 'meal';
}
export interface SiteRules {
  type: 'site';
}
export type ContextRules = ActivityRules | MealRules | SiteRules;

/** One person's state within one context. */
export interface PersonState {
  present: boolean; // signed in to the activity / on site / served (meal)
  visits: number; // accepted sign-ins (activity), servings (meal), arrivals (site)
  lastAcceptedAt: string | null;
}

export const EMPTY_STATE: PersonState = { present: false, visits: 0, lastAcceptedAt: null };

export interface ScanFacts {
  direction: Direction;
  deviceTime: string;
  credentialRevoked: boolean;
  registrationWithdrawn: boolean;
  booked: boolean;
}

export interface Evaluation {
  outcome: Outcome;
  /** Short, human message for the scanner. */
  message: string;
  /** An accepted scan that still deserves attention (e.g. over capacity). */
  warning: string | null;
  next: PersonState;
}

export interface ContextTotals {
  presentNow: number;
}

function time(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Adelaide' });
}

export function evaluateScan(rules: ContextRules, state: PersonState, scan: ScanFacts, totals: ContextTotals): Evaluation {
  const keep = (outcome: Outcome, message: string): Evaluation => ({ outcome, message, warning: null, next: state });

  if (scan.credentialRevoked) return keep('rejected', 'This card has been replaced and no longer works.');

  const accept = (message: string, next: PersonState, warning: string | null = null): Evaluation => ({
    outcome: 'accepted',
    message,
    warning: warning ?? (scan.registrationWithdrawn ? 'Marked as withdrawn from this event.' : null),
    next,
  });

  switch (rules.type) {
    case 'meal': {
      if (scan.direction !== 'in') return keep('rejected', 'Meals only record serving.');
      if (state.present) return keep('duplicate', `Already served at ${time(state.lastAcceptedAt)}.`);
      return accept('Served', { present: true, visits: 1, lastAcceptedAt: scan.deviceTime });
    }

    case 'site': {
      if (scan.direction === 'in') {
        if (state.present) return keep('duplicate', `Already on site since ${time(state.lastAcceptedAt)}.`);
        return accept('Arrived', { present: true, visits: state.visits + 1, lastAcceptedAt: scan.deviceTime });
      }
      if (!state.present) return keep('review', 'Was not recorded as on site. Departure noted for review.');
      return accept('Departed', { present: false, visits: state.visits, lastAcceptedAt: scan.deviceTime });
    }

    case 'activity': {
      if (scan.direction === 'out') {
        if (!rules.trackSignOut) return keep('rejected', 'This activity does not use sign-out.');
        if (!state.present) return keep('review', 'Was not signed in. Sign-out noted for review.');
        return accept('Signed out', { present: false, visits: state.visits, lastAcceptedAt: scan.deviceTime });
      }
      if (state.present) return keep('duplicate', `Already signed in at ${time(state.lastAcceptedAt)}.`);
      if (!rules.allowRepeat && state.visits > 0) return keep('duplicate', 'Has already done this activity.');
      const next = { present: rules.trackSignOut, visits: state.visits + 1, lastAcceptedAt: scan.deviceTime };
      // Without sign-out, "present" would never clear; count visits instead.
      const occupancy = rules.trackSignOut ? totals.presentNow : 0;
      if (rules.capacity !== null && rules.trackSignOut && occupancy >= rules.capacity) {
        if (rules.capacityPolicy === 'block') return keep('rejected', `Activity is full (${rules.capacity}).`);
        return accept('Signed in', next, `Over capacity: ${occupancy + 1} of ${rules.capacity}.`);
      }
      if (rules.bookingRequired && !scan.booked) return accept('Signed in', next, 'Not booked for this activity.');
      return accept('Signed in', next);
    }
  }
}

export interface TimelineScan extends ScanFacts {
  id: string;
  registrationId: string;
}

export interface ReplayResult {
  outcomes: Map<string, Evaluation>;
  states: Map<string, PersonState>;
  presentNow: number;
}

/** Deterministic order: device time, then id as a tie-break. */
export function compareScans(a: { deviceTime: string; id: string }, b: { deviceTime: string; id: string }): number {
  return a.deviceTime < b.deviceTime ? -1 : a.deviceTime > b.deviceTime ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Replay every (non-voided) scan in a context to derive outcomes and current state. */
export function replay(rules: ContextRules, scans: TimelineScan[]): ReplayResult {
  const states = new Map<string, PersonState>();
  const outcomes = new Map<string, Evaluation>();
  let presentNow = 0;
  for (const scan of [...scans].sort(compareScans)) {
    const before = states.get(scan.registrationId) ?? EMPTY_STATE;
    const evaluation = evaluateScan(rules, before, scan, { presentNow });
    outcomes.set(scan.id, evaluation);
    if (evaluation.next.present !== before.present) presentNow += evaluation.next.present ? 1 : -1;
    states.set(scan.registrationId, evaluation.next);
  }
  return { outcomes, states, presentNow };
}
