import type { Permission } from '../../shared/permissions';
import { PLATFORM_PERMISSIONS } from '../../shared/permissions';

export interface AssignmentGrant {
  assignmentId: string;
  roleKey: string;
  eventId: string | null;
  activityId: string | null;
  permissions: ReadonlySet<Permission>;
}

export interface UserPrincipal {
  kind: 'user';
  userId: string;
  email: string;
  displayName: string;
  grants: AssignmentGrant[];
}

export interface StationPrincipal {
  kind: 'station';
  stationId: string;
  eventId: string;
  contextType: 'activity' | 'meal' | 'site';
  contextId: string | null;
}

export type Principal = UserPrincipal | StationPrincipal;

export interface Scope {
  eventId?: string;
  activityId?: string;
}

const PLATFORM = new Set<string>(PLATFORM_PERMISSIONS);
/** Permissions a platform overseer holds on every event (no participant data). */
const OVERSIGHT = new Set<Permission>(['event.view', 'staff.manage']);
const ACTIVITY_LEVEL = new Set<Permission>(['activity.scan', 'activity.view_roster']);

function stationPermissions(p: StationPrincipal): Set<Permission> {
  switch (p.contextType) {
    case 'activity':
      return new Set(['event.view', 'activity.scan', 'photo.view_status']);
    case 'meal':
      return new Set(['event.view', 'meal.scan', 'dietary.view_alert']);
    case 'site':
      return new Set(['event.view', 'site.scan']);
  }
}

/**
 * The single authorisation decision point. Every route calls this (via
 * `requirePermission`) before touching data.
 */
export function can(principal: Principal, permission: Permission, scope: Scope = {}): boolean {
  if (principal.kind === 'station') {
    if (!scope.eventId || scope.eventId !== principal.eventId) return false;
    if (!stationPermissions(principal).has(permission)) return false;
    if (ACTIVITY_LEVEL.has(permission)) {
      return scope.activityId !== undefined && scope.activityId === principal.contextId;
    }
    return true;
  }

  for (const grant of principal.grants) {
    if (PLATFORM.has(permission)) {
      if (grant.eventId === null && grant.permissions.has(permission)) return true;
      continue;
    }
    if (!scope.eventId) continue;
    if (
      grant.eventId === null &&
      grant.permissions.has('platform.events.oversee') &&
      OVERSIGHT.has(permission)
    ) {
      return true;
    }
    if (grant.eventId !== scope.eventId || !grant.permissions.has(permission)) continue;
    if (ACTIVITY_LEVEL.has(permission) && grant.activityId !== null) {
      if (scope.activityId === undefined || scope.activityId !== grant.activityId) continue;
    }
    return true;
  }
  return false;
}

/**
 * For an activity-level permission, which activities in the event the
 * principal holds it for: 'all', or a specific set.
 */
export function activityAccess(
  principal: Principal,
  permission: 'activity.scan' | 'activity.view_roster',
  eventId: string,
): 'all' | Set<string> {
  if (principal.kind === 'station') {
    if (principal.eventId !== eventId || principal.contextType !== 'activity') return new Set();
    if (!stationPermissions(principal).has(permission)) return new Set();
    return new Set([principal.contextId!]);
  }
  const ids = new Set<string>();
  for (const grant of principal.grants) {
    if (grant.eventId !== eventId || !grant.permissions.has(permission)) continue;
    if (grant.activityId === null) return 'all';
    ids.add(grant.activityId);
  }
  return ids;
}

/** Every permission the principal holds within one event (for the UI only). */
export function eventPermissions(principal: Principal, eventId: string): Permission[] {
  if (principal.kind === 'station') {
    return principal.eventId === eventId ? [...stationPermissions(principal)] : [];
  }
  const out = new Set<Permission>();
  for (const grant of principal.grants) {
    if (grant.eventId === null && grant.permissions.has('platform.events.oversee')) {
      OVERSIGHT.forEach((p) => out.add(p));
    }
    if (grant.eventId === eventId) grant.permissions.forEach((p) => out.add(p));
  }
  return [...out];
}

export function platformPermissions(principal: Principal): Permission[] {
  if (principal.kind === 'station') return [];
  const out = new Set<Permission>();
  for (const grant of principal.grants) {
    if (grant.eventId !== null) continue;
    grant.permissions.forEach((p) => {
      if (PLATFORM.has(p)) out.add(p);
    });
  }
  return [...out];
}
