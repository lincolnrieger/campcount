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
  permissions: Permission[];
}

export type Me =
  | {
      kind: 'user';
      user: { id: string; email: string; displayName: string };
      platformPermissions: Permission[];
    }
  | {
      kind: 'station';
      station: { id: string; eventId: string; contextType: 'activity' | 'meal' | 'site'; contextId: string | null };
    };
