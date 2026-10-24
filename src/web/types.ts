import type { EventFeatures, EventStatus } from '../shared/schemas';
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
  permissions: Permission[];
}

export type Me =
  | {
      kind: 'user';
      user: { id: string; email: string; displayName: string; hasPassword: boolean; isDemo: boolean };
      platformPermissions: Permission[];
      preview: RolePreview | null;
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
