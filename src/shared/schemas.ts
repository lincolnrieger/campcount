import { z } from 'zod';

const trimmed = (max: number) => z.string().trim().max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const signInRequestSchema = z.strictObject({ email: emailSchema });

export const signUpSchema = z.strictObject({
  email: emailSchema,
  displayName: trimmed(100).min(2, 'Enter your name'),
  password: z.string().min(1).max(200),
});

/** Token from a password setup or reset link. */
export const passwordLinkCheckSchema = z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/) });
export const passwordLinkUseSchema = passwordLinkCheckSchema.extend({ password: z.string().min(1).max(200) });

export const signInVerifySchema = z.union([
  z.strictObject({ email: emailSchema, code: z.string().trim().regex(/^\d{6}$/) }),
  z.strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) }),
]);

export const createUserSchema = z.strictObject({
  email: emailSchema,
  displayName: trimmed(100).min(1),
  platformAdmin: z.boolean().default(false),
  /** Email them a link to set their password (it is also returned to the admin). */
  sendEmail: z.boolean().default(true),
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
  /** Required to archive while reconciliation items remain; recorded in the audit log. */
  acknowledgeOpenItems: z.boolean().default(false),
});

/** Add someone to an event: pick an existing account (userId) or type an email (a new account is made if needed). */
export const createAssignmentSchema = z
  .strictObject({
    userId: z.uuid().optional(),
    email: emailSchema.optional(),
    displayName: trimmed(100).min(1).optional(),
    roleKey: z.string().regex(/^[a-z_]{2,40}$/),
    activityId: z.uuid().optional(),
  })
  .refine((v) => v.userId || v.email, { message: 'Choose a person or enter an email address.', path: ['email'] });

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

// ---------------------------------------------------------------- activities, meals, stations, scans

const isoDateTime = z.iso.datetime({ offset: true });

export const activityInputSchema = z.strictObject({
  name: trimmed(80).min(1),
  description: trimmed(1000).default(''),
  location: trimmed(120).default(''),
  instructions: trimmed(2000).default(''),
  startsAt: isoDateTime.nullable().default(null),
  endsAt: isoDateTime.nullable().default(null),
  capacity: z.number().int().positive().max(10000).nullable().default(null),
  capacityPolicy: z.enum(['warn', 'block']).default('warn'),
  trackSignOut: z.boolean().default(false),
  allowRepeat: z.boolean().default(true),
  bookingRequired: z.boolean().default(false),
});
export const activityPatchSchema = activityInputSchema.partial().extend({ status: z.enum(['active', 'cancelled']).optional() });

export const mealInputSchema = z.strictObject({
  name: trimmed(80).min(1),
  location: trimmed(120).default(''),
  startsAt: isoDateTime.nullable().default(null),
  endsAt: isoDateTime.nullable().default(null),
});
export const mealPatchSchema = mealInputSchema.partial().extend({ status: z.enum(['active', 'cancelled']).optional() });

export const stationInputSchema = z.strictObject({
  name: trimmed(60).min(1),
  contextType: z.enum(['activity', 'meal', 'site']),
  contextId: z.uuid().nullable(),
  hours: z.number().int().min(1).max(168).default(24),
});

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);

export const scanUploadSchema = z.strictObject({
  deviceId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  scans: z
    .array(
      z.strictObject({
        id: z.uuid(),
        contextType: z.enum(['activity', 'meal', 'site']),
        contextId: z.uuid().nullable(),
        direction: z.enum(['in', 'out']),
        deviceTime: isoDateTime,
        method: z.enum(['qr', 'code', 'manual']),
        /** sha256("credential:" + token) for QR scans; sha256("code:" + eventId + ":" + CODE) for typed codes. */
        credentialHash: hex64.optional(),
        codeHash: hex64.optional(),
        /** Manual lookup by name (fallback); recorded as such in reports. */
        registrationId: z.uuid().optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type ScanUpload = z.infer<typeof scanUploadSchema>;
export type ScanUploadItem = ScanUpload['scans'][number];

export const voidScanSchema = z.strictObject({ reason: trimmed(200).min(3, 'Give a reason for the correction') });

// ---------------------------------------------------------------- passwords

export const passwordSignInSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const setPasswordSchema = z.strictObject({
  password: z.string().min(1).max(200),
  currentPassword: z.string().max(200).optional(),
});
