import type { EventFeatures, EventStatus, LanyardSettings } from '../shared/schemas';
import type { Permission } from '../shared/permissions';

export interface EventSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  location: string;
  startsOn: string;
  endsOn: string;
  timezone: string;
  status: EventStatus;
  features: EventFeatures;
  closedAt: string | null;
  isDemo: boolean;
  /** The event's own address: <subdomain>.campcount.com (null until an admin sets one). */
  subdomain: string | null;
  brandColor: string | null;
  /** How lanyards mark someone without photo consent. */
  lanyard: LanyardSettings;
  logoUrl: string | null;
  permissions: Permission[];
}

export type Me =
  | {
      kind: 'user';
      user: { id: string; email: string; displayName: string; hasPassword: boolean; isDemo: boolean };
      platformPermissions: Permission[];
      preview: RolePreview | null;
      /** May use View as a role (platform admins, and event managers for their own events). */
      canViewAs?: boolean;
    }
  | {
      kind: 'station';
      station: { id: string; eventId: string; contextType: 'activity' | 'meal' | 'site'; contextId: string | null };
    };

export interface RolePreview {
  eventId: string;
  eventName: string;
  roleKey: string;
  roleName: string;
  activityId: string | null;
  activityName: string | null;
}
