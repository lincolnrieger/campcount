/** Shapes the API returns, shared between screens. */
import type { DietaryEntryInput } from '../shared/schemas';

export interface Activity {
  id: string;
  name: string;
  description: string;
  location: string;
  instructions: string;
  startsAt: string | null;
  endsAt: string | null;
  capacity: number | null;
  capacityPolicy: 'warn' | 'block';
  trackSignOut: boolean;
  allowRepeat: boolean;
  bookingRequired: boolean;
  signupOpen: boolean;
  booked: number;
  /** 'program': on the schedule only, never booked or scanned. */
  kind: 'activity' | 'program';
  /** People enter as teams; set up on the Teams tab. */
  teamEvent?: boolean;
  status: 'active' | 'cancelled';
}

export interface TeamMember {
  registrationId: string;
  name: string;
  groupName: string;
  section: string;
  source: 'manual' | 'self_signup';
}

export interface TeamEvent {
  id: string;
  name: string;
  description: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  status: 'active' | 'cancelled';
  minSize: number;
  maxSize: number | null;
  maxTeams: number | null;
  registrationOpen: boolean;
  teams: { id: string; name: string; members: TeamMember[] }[];
}

export interface Meal {
  id: string;
  name: string;
  location: string;
  startsAt: string | null;
  endsAt: string | null;
  status: 'active' | 'cancelled';
}

export interface Registration {
  id: string;
  memberNumber: string;
  firstName: string;
  preferredName: string;
  lastName: string;
  displayName: string;
  kind: 'youth' | 'adult';
  section: string;
  groupName: string;
  position: string;
  status: 'active' | 'withdrawn';
  shortCode: string | null;
  photoConsent?: 'yes' | 'no' | 'unknown';
  dietary?: DietaryEntryInput[];
  dietaryFingerprint?: string | null;
}

/** Where someone is right now. */
export interface Where {
  site: 'on' | 'off' | 'never' | null;
  siteSince: string | null;
  activities: { key: string; name: string; since: string | null }[];
  lastSeen: { contextName: string; type: 'activity' | 'meal' | 'site'; direction: 'in' | 'out'; at: string } | null;
}

/** "Arrived", "Signed out", "Served"… */
export function scanVerb(type: 'activity' | 'meal' | 'site', direction: 'in' | 'out'): string {
  if (type === 'meal') return 'Served';
  if (type === 'site') return direction === 'in' ? 'Arrived' : 'Left';
  return direction === 'in' ? 'Signed in' : 'Signed out';
}

/** "just now", "12 min ago", "3 h 5 min ago". */
export function minutesAgo(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min ago` : `${Math.floor(h / 24)} days ago`;
}
