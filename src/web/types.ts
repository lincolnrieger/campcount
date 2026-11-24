import type { EventFeatures, EventStatus, LanyardSettings } from '../shared/schemas';
import type { Permission } from '../shared/permissions';
import type { LevelSetting } from '../shared/levels';

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
  /** Levels that count as youth at this camp; everyone else is an adult. */
  /** Who people email about the camp (shown on booking links). */
  contactEmail: string;
  youthLevels: string[];
  /** The camp's levels: names, lanyard words, colours, youth (Settings › Levels). */
  levels: LevelSetting[];
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
