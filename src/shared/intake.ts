import { z } from 'zod';
import { importRowSchema } from './schemas';

/**
 * Import & check: MyScout (registration) and Consent2Go (consent, dietary
 * and health) exports read side by side, one person at a time, with a
 * checklist. Shared by the browser and the server.
 */

export const INTAKE_SOURCES = ['myscout', 'consent2go'] as const;
export type IntakeSource = (typeof INTAKE_SOURCES)[number];
export const SOURCE_NAME: Record<IntakeSource, string> = { myscout: 'MyScout', consent2go: 'Consent2Go' };

/** What the person checking ticks off for each person. */
export const CHECKLIST = [
  { key: 'details', label: 'Name, section and group are right' },
  { key: 'photo', label: 'Photo consent is right' },
  { key: 'dietary', label: 'Dietary needs read and recorded' },
  { key: 'health', label: 'Medical, medication and swimming notes read' },
] as const;
export type ChecklistKey = (typeof CHECKLIST)[number]['key'];

/** Fingerprints are the first 16 hex characters of an HMAC. */
const fingerprint = z.string().regex(/^[0-9a-f]{16}$/);

export const intakeSeenSchema = z.strictObject({
  source: z.enum(INTAKE_SOURCES),
  people: z
    .array(
      z.strictObject({
        memberNumber: importRowSchema.shape.memberNumber,
        name: z.string().trim().min(1).max(130),
        section: z.string().trim().max(40).default(''),
        groupName: z.string().trim().max(120).default(''),
        /** Column name -> fingerprint of that person's value in it. */
        fields: z.record(z.string().trim().min(1).max(80), fingerprint).refine((o) => Object.keys(o).length <= 120, 'Too many columns'),
      }),
    )
    .min(1)
    .max(150),
});

export const intakeCheckSchema = z.strictObject({
  memberNumber: importRowSchema.shape.memberNumber,
  /** Keep them off this camp (not coming): nothing is added to the roster. */
  leftOff: z.boolean().default(false),
  /** What to put on the roster, as chosen. Required unless leftOff. */
  row: importRowSchema.optional(),
  checklist: z.record(z.string().max(20), z.boolean()).refine((o) => Object.keys(o).length <= 10),
});

export type IntakeState = 'new' | 'changed' | 'in_progress' | 'checked' | 'left_off' | 'roster_only';

export interface IntakePerson {
  memberNumber: string;
  name: string;
  section: string;
  groupName: string;
  myscout: { firstSeen: string; lastSeen: string } | null;
  consent2go: { firstSeen: string; lastSeen: string } | null;
  roster: {
    registrationId: string;
    status: 'active' | 'withdrawn';
    firstName: string;
    preferredName: string;
    lastName: string;
    kind: 'youth' | 'adult';
    section: string;
    groupName: string;
    position: string;
    roleLabel: string;
    team: string;
    sourceStatus: string;
    photoConsent: string;
    dietary?: { category: string; item: string; severity: string; note: string }[];
    extra?: Record<string, string>;
  } | null;
  check: { at: string; by: string; checklist: Record<string, boolean>; complete: boolean; leftOff: boolean } | null;
  state: IntakeState;
  /** What changed since they were checked ("Consent2Go: Dietary Requirement 1", "Now in Consent2Go"). */
  changed: string[];
}

/** People still to look at: never checked, changed since, or half done. */
export const needsCheck = (s: IntakeState) => s === 'new' || s === 'changed' || s === 'in_progress';
