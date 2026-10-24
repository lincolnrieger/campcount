/**
 * The complete set of permissions CampCount understands.
 *
 * Permissions are code; roles are data (see migrations/0002_system_roles.sql).
 * Adding a role never needs a code change. Adding a capability does.
 */
export const PLATFORM_PERMISSIONS = [
  'platform.users.manage',
  'platform.events.create',
  'platform.events.oversee', // see every event and manage its staff (audited); no participant data
  'platform.audit.read',
] as const;

export const EVENT_PERMISSIONS = [
  'event.view',
  'event.configure',
  'event.close',
  'staff.manage',
  'stations.manage',
  'roster.view',
  'roster.import',
  'roster.edit',
  'credentials.manage',
  'activities.manage',
  'meals.manage',
  'meal.scan',
  'site.scan',
  'dietary.view_alert', // the alert shown at a meal scan
  'dietary.view_detail', // named dietary list, catering detail
  'dietary.edit',
  'photo.view_status',
  'attendance.correct',
  'reports.view',
  'reports.export',
  'reports.export_sensitive',
] as const;

/** Activity permissions can be granted for a whole event or for one activity. */
export const ACTIVITY_PERMISSIONS = ['activity.scan', 'activity.view_roster', 'activity.bookings'] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
export type EventPermission = (typeof EVENT_PERMISSIONS)[number];
export type ActivityPermission = (typeof ACTIVITY_PERMISSIONS)[number];
export type Permission = PlatformPermission | EventPermission | ActivityPermission;

export const ALL_PERMISSIONS: readonly Permission[] = [
  ...PLATFORM_PERMISSIONS,
  ...EVENT_PERMISSIONS,
  ...ACTIVITY_PERMISSIONS,
];

export type RoleScope = 'platform' | 'event' | 'activity';

/** Which permissions a role of a given scope may contain. */
export function permissionsAllowedForScope(scope: RoleScope): readonly Permission[] {
  switch (scope) {
    case 'platform':
      return PLATFORM_PERMISSIONS;
    case 'event':
      return [...EVENT_PERMISSIONS, ...ACTIVITY_PERMISSIONS];
    case 'activity':
      return ACTIVITY_SCOPE_PERMISSIONS;
  }
}

/**
 * An activity-scoped role may also carry these event-level permissions, which
 * an activity leader needs to function (seeing the event exists, and the
 * photo-consent marker on a scan result).
 */
const ACTIVITY_SCOPE_PERMISSIONS: readonly Permission[] = [
  ...ACTIVITY_PERMISSIONS,
  'event.view',
  'photo.view_status',
];

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}
