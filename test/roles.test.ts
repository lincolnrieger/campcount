import { describe, expect, it } from 'vitest';
import { isPermission, permissionsAllowedForScope } from '../src/shared/permissions';
import type { RoleScope } from '../src/shared/permissions';
import { testEnv } from './helpers';

/**
 * The approved permission matrix (the roles table in docs/requirements.md). Changing a
 * system role's permissions must change this table too, so every change to
 * who-can-do-what is deliberate and reviewed.
 */
const MATRIX: Record<string, string[]> = {
  platform_admin: ['platform.audit.read', 'platform.events.create', 'platform.events.oversee', 'platform.users.manage'],
  event_manager: [
    'activities.manage',
    'activity.bookings',
    'activity.scan',
    'activity.view_roster',
    'attendance.correct',
    'credentials.manage',
    'event.close',
    'event.configure',
    'event.view',
    'meal.scan',
    'meals.manage',
    'reports.export',
    'reports.view',
    'roster.edit',
    'roster.view',
    'site.scan',
    'staff.manage',
    'stations.manage',
  ],
  scanner: ['activity.bookings', 'activity.scan', 'activity.view_roster', 'event.view', 'site.scan'],
  meal_leader: ['event.view', 'meal.scan'],
  activity_leader: ['activity.bookings', 'activity.scan', 'activity.view_roster', 'event.view'],
};

describe('system roles', () => {
  it('match the approved permission matrix exactly', async () => {
    const { results } = await testEnv.DB.prepare(`SELECT r.key, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id WHERE r.is_system = 1`).all<{
      key: string;
      permission: string;
    }>();
    const actual: Record<string, string[]> = {};
    for (const row of results) (actual[row.key] ??= []).push(row.permission);
    for (const key of Object.keys(actual)) actual[key]!.sort();
    expect(actual).toEqual(MATRIX);
  });

  it('only contain known permissions valid for their scope', async () => {
    const { results } = await testEnv.DB.prepare(`SELECT r.key, r.scope, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id`).all<{
      key: string;
      scope: RoleScope;
      permission: string;
    }>();
    for (const row of results) {
      expect(isPermission(row.permission), `${row.key}: ${row.permission}`).toBe(true);
      expect(permissionsAllowedForScope(row.scope), `${row.key}: ${row.permission}`).toContain(row.permission);
    }
  });

  it('never give the roster or exports to volunteer roles', () => {
    for (const role of ['scanner', 'meal_leader', 'activity_leader']) {
      expect(MATRIX[role]).not.toContain('roster.view');
      expect(MATRIX[role]).not.toContain('reports.export');
    }
  });
});
