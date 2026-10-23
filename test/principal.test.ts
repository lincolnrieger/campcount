import { describe, expect, it } from 'vitest';
import type { Permission } from '../src/shared/permissions';
import type { AssignmentGrant, Principal } from '../src/worker/services/principal';
import { activityAccess, can } from '../src/worker/services/principal';

const E1 = 'event-1';
const E2 = 'event-2';
const grant = (eventId: string | null, perms: Permission[], activityId: string | null = null): AssignmentGrant => ({
  assignmentId: crypto.randomUUID(),
  roleKey: 'x',
  eventId,
  activityId,
  permissions: new Set(perms),
});
const user = (...grants: AssignmentGrant[]): Principal => ({ kind: 'user', userId: 'u', email: 'e', displayName: 'd', grants });

describe('can()', () => {
  it('scopes event permissions to their event', () => {
    const p = user(grant(E1, ['roster.view']));
    expect(can(p, 'roster.view', { eventId: E1 })).toBe(true);
    expect(can(p, 'roster.view', { eventId: E2 })).toBe(false);
    expect(can(p, 'roster.view')).toBe(false);
  });

  it('does not let event grants satisfy platform permissions', () => {
    const p = user(grant(E1, ['platform.users.manage' as Permission]));
    expect(can(p, 'platform.users.manage')).toBe(false);
  });

  it('gives platform overseers event.view and staff.manage only', () => {
    const p = user(grant(null, ['platform.events.oversee']));
    expect(can(p, 'event.view', { eventId: E1 })).toBe(true);
    expect(can(p, 'staff.manage', { eventId: E1 })).toBe(true);
    expect(can(p, 'roster.view', { eventId: E1 })).toBe(false);
    expect(can(p, 'dietary.view_detail', { eventId: E1 })).toBe(false);
  });

  it('limits activity-scoped grants to their activity', () => {
    const p = user(grant(E1, ['activity.scan', 'event.view'], 'a1'));
    expect(can(p, 'activity.scan', { eventId: E1, activityId: 'a1' })).toBe(true);
    expect(can(p, 'activity.scan', { eventId: E1, activityId: 'a2' })).toBe(false);
    expect(can(p, 'activity.scan', { eventId: E1 })).toBe(false);
    expect(can(p, 'event.view', { eventId: E1 })).toBe(true);
    expect(activityAccess(p, 'activity.scan', E1)).toEqual(new Set(['a1']));
  });

  it('event-wide activity grants cover all activities', () => {
    const p = user(grant(E1, ['activity.scan']));
    expect(can(p, 'activity.scan', { eventId: E1, activityId: 'anything' })).toBe(true);
    expect(activityAccess(p, 'activity.scan', E1)).toBe('all');
  });

  it('confines stations to their event and context', () => {
    const meal: Principal = { kind: 'station', stationId: 's', eventId: E1, contextType: 'meal', contextId: 'm1' };
    expect(can(meal, 'meal.scan', { eventId: E1 })).toBe(true);
    expect(can(meal, 'dietary.view_alert', { eventId: E1 })).toBe(true);
    expect(can(meal, 'dietary.view_detail', { eventId: E1 })).toBe(false);
    expect(can(meal, 'meal.scan', { eventId: E2 })).toBe(false);
    expect(can(meal, 'activity.scan', { eventId: E1, activityId: 'm1' })).toBe(false);
    expect(can(meal, 'roster.view', { eventId: E1 })).toBe(false);

    const act: Principal = { kind: 'station', stationId: 's', eventId: E1, contextType: 'activity', contextId: 'a1' };
    expect(can(act, 'activity.scan', { eventId: E1, activityId: 'a1' })).toBe(true);
    expect(can(act, 'activity.scan', { eventId: E1, activityId: 'a2' })).toBe(false);
    expect(can(act, 'meal.scan', { eventId: E1 })).toBe(false);
  });
});
