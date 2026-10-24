import { describe, expect, it } from 'vitest';
import { isPermission, permissionsAllowedForScope } from '../src/shared/permissions';
import type { RoleScope } from '../src/shared/permissions';
import { testEnv } from './helpers';

/**
 * The approved permission matrix (docs/permission-matrix.md). Changing a
 * system role's permissions must change this table too, so every change to
 * who-can-do-what is deliberate and reviewed.
 */
const MATRIX: Record<string, string[]> = {
  platform_admin: ['platform.audit.read', 'platform.events.create', 'platform.events.oversee', 'platform.users.manage'],
  event_manager: [
    'activities.manage', 'activity.scan', 'activity.view_roster', 'attendance.correct', 'credentials.manage',
    'dietary.edit', 'dietary.view_alert', 'dietary.view_detail', 'event.close', 'event.configure', 'event.view',
    'meal.scan', 'meals.manage', 'photo.view_status', 'reports.export', 'reports.export_sensitive', 'reports.view',
    'roster.edit', 'roster.import', 'roster.view', 'site.scan', 'staff.manage', 'stations.manage',
  ],
  scanner: ['activity.scan', 'activity.view_roster', 'event.view', 'photo.view_status', 'site.scan'],
  meal_leader: ['dietary.view_alert', 'dietary.view_detail', 'event.view', 'meal.scan'],
};

describe('system roles', () => {
  it('match the approved permission matrix exactly', async () => {
    const { results } = await testEnv.DB.prepare(
      `SELECT r.key, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id WHERE r.is_system = 1`,
    ).all<{ key: string; permission: string }>();
    const actual: Record<string, string[]> = {};
    for (const row of results) (actual[row.key] ??= []).push(row.permission);
    for (const key of Object.keys(actual)) actual[key]!.sort();
    expect(actual).toEqual(MATRIX);
  });

  it('only contain known permissions valid for their scope', async () => {
    const { results } = await testEnv.DB.prepare(
      `SELECT r.key, r.scope, rp.permission FROM roles r JOIN role_permissions rp ON rp.role_id = r.id`,
    ).all<{ key: string; scope: RoleScope; permission: string }>();
    for (const row of results) {
      expect(isPermission(row.permission), `${row.key}: ${row.permission}`).toBe(true);
      expect(permissionsAllowedForScope(row.scope), `${row.key}: ${row.permission}`).toContain(row.permission);
    }
  });

  it('never give dietary detail or sensitive export to volunteer roles', () => {
    for (const role of ['scanner']) {
      expect(MATRIX[role]).not.toContain('dietary.view_detail');
      expect(MATRIX[role]).not.toContain('reports.export_sensitive');
    }
  });
});
