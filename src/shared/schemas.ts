import { z } from 'zod';

const trimmed = (max: number) => z.string().trim().max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const signInRequestSchema = z.strictObject({ email: emailSchema });

export const signInVerifySchema = z.union([
  z.strictObject({ email: emailSchema, code: z.string().trim().regex(/^\d{6}$/) }),
  z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) }),
]);

export const createUserSchema = z.strictObject({
  email: emailSchema,
  displayName: trimmed(100).min(1),
  platformAdmin: z.boolean().default(false),
});

export const eventFeaturesSchema = z.strictObject({
  activities: z.boolean(),
  meals: z.boolean(),
  site: z.boolean(),
  dietary: z.boolean(),
  photo: z.boolean(),
  selfSignup: z.boolean(),
});

const eventFields = {
  name: trimmed(120).min(1),
  description: trimmed(2000).default(''),
  location: trimmed(200).default(''),
  startsOn: isoDate,
  endsOn: isoDate,
  features: eventFeaturesSchema.partial().default({}),
};

export const createEventSchema = z
  .strictObject(eventFields)
  .refine((e) => e.endsOn >= e.startsOn, { message: 'The event must end on or after its start date', path: ['endsOn'] });

export const updateEventSchema = z
  .strictObject({
    name: eventFields.name,
    description: trimmed(2000),
    location: trimmed(200),
    startsOn: isoDate,
    endsOn: isoDate,
    features: eventFeaturesSchema.partial(),
  })
  .partial();

export const EVENT_STATUSES = ['draft', 'open', 'completed', 'archived', 'cancelled'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const eventTransitionSchema = z.strictObject({
  to: z.enum(EVENT_STATUSES),
});

export const createAssignmentSchema = z.strictObject({
  email: emailSchema,
  displayName: trimmed(100).min(1).optional(),
  roleKey: z.string().regex(/^[a-z_]{2,40}$/),
  activityId: z.uuid().optional(),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type EventFeatures = z.infer<typeof eventFeaturesSchema>;

// ---------------------------------------------------------------- roster import

export const SECTIONS = ['Joeys', 'Cubs', 'Scouts', 'Venturers', 'Rovers', 'Leaders', 'Other'] as const;
export const DIETARY_CATEGORIES = ['allergy', 'intolerance', 'medical_diet', 'religious_cultural', 'preference'] as const;

export const dietaryEntrySchema = z.strictObject({
  category: z.enum(DIETARY_CATEGORIES),
  item: trimmed(60).min(1),
  severity: z.enum(['standard', 'anaphylactic']).default('standard'),
  note: trimmed(80).default(''),
});
export type DietaryEntryInput = z.infer<typeof dietaryEntrySchema>;

/**
 * One roster row as sent by the browser. This strict allowlist is the server's
 * guarantee that nothing else from the source file (addresses, Medicare
 * numbers, guardian details, free-text medical notes) can ever be stored.
 */
export const importRowSchema = z.strictObject({
  memberNumber: z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/, 'Membership number is missing or invalid'),
  firstName: trimmed(60).min(1, 'First name is missing'),
  preferredName: trimmed(60).default(''),
  lastName: trimmed(60).min(1, 'Last name is missing'),
  kind: z.enum(['youth', 'adult']),
  section: z.enum(SECTIONS),
  groupName: trimmed(120).default(''),
  position: trimmed(120).default(''),
  roleLabel: trimmed(60).default(''),
  team: trimmed(60).default(''),
  sourceStatus: trimmed(160).default(''),
  photoConsent: z.enum(['yes', 'no', 'unknown']),
  /** Keyed hash of the source dietary/medical text, to detect changes. Never the text. */
  dietaryFingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  /** Present only when the director reviewed this row's dietary text in this import. */
  dietary: z.array(dietaryEntrySchema).max(10).optional(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importRequestSchema = z.strictObject({
  rows: z.array(importRowSchema).min(1).max(2000),
  withdrawMissing: z.boolean().default(false),
  sourceLabel: trimmed(120).default(''),
});
