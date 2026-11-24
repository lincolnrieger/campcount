import { z } from 'zod';
import { BRAND_COLOR_PATTERN, subdomainProblem } from './site';


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
  /** The secret Side Quest (participants collect each other's lanyards). */
  sideQuest: z.boolean(),
});

/** How a lanyard shows someone without photo consent (Settings › Lanyards). */
export const PHOTO_MARKERS = ['black_border', 'colour_border', 'red_dot', 'camera_icon', 'none'] as const;
export type PhotoMarker = (typeof PHOTO_MARKERS)[number];

export const lanyardSettingsSchema = z.strictObject({
  photoMarker: z.enum(PHOTO_MARKERS),
  photoMarkerColour: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Choose a colour like #B3261E'),
  /** Print a small "No photos" next to the level. */
  photoMarkerLabel: z.boolean(),
  /** With uploaded front artwork: print the coloured level band over it (or only the level word). */
  printBand: z.boolean(),
});

export const LANYARD_TEMPLATE_SIZES = ['lanyard', 'badge'] as const;
export const LANYARD_TEMPLATE_SIDES = ['front', 'back'] as const;
export type LanyardSettings = z.infer<typeof lanyardSettingsSchema>;

const eventFields = {
  name: trimmed(120).min(1),
  description: trimmed(2000).default(''),
  location: trimmed(200).default(''),
  startsOn: isoDate,
  endsOn: isoDate,
  features: eventFeaturesSchema.partial().default({}),
  /** The event's own address: <subdomain>.campcount.com. */
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => subdomainProblem(v) === null, { message: 'Use 3 to 40 lowercase letters, numbers and hyphens (not a reserved word)' })
    .optional(),
  brandColor: z.string().regex(BRAND_COLOR_PATTERN, 'Choose a colour like #1F5C46').optional(),
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
    subdomain: eventFields.subdomain.unwrap(),
    brandColor: eventFields.brandColor.unwrap(),
    lanyard: lanyardSettingsSchema.partial(),
    /** Who people email about the camp, e.g. to change a booking. Empty for none. */
    contactEmail: z.union([z.literal(''), z.email('Enter an email address like camp@example.org').max(200)]),
    /** Levels that count as youth at this camp; everyone else is an adult. */
    youthLevels: z.array(trimmed(40).min(1)).max(40),
    /** The camp's levels (Settings › Levels). `from` is the name it had, for renames. */
    levels: z
      .array(
        z.strictObject({
          from: trimmed(40).optional(),
          name: trimmed(40).min(1, 'Give each level a name'),
          word: trimmed(20),
          colour: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Choose a colour'),
          youth: z.boolean(),
          /** Imported names linked to this level ("Early Bird Youth"). */
          aliases: z.array(trimmed(40).min(1)).max(50).optional(),
        }),
      )
      .min(1, 'Keep at least one level')
      .max(40),
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

export type EventFeatures = z.infer<typeof eventFeaturesSchema>;

// ---------------------------------------------------------------- roster import

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
/** A participant ID: letters, numbers and dashes. */
export const participantIdSchema = z.string().trim().regex(/^[A-Za-z0-9-]{1,20}$/, 'Participant ID can only have letters, numbers and dashes');

export const importRowSchema = z.strictObject({
  /** Empty when the file has none: the server reuses the ID of someone already on this camp with the same name, or makes one. */
  participantId: z.union([z.literal(''), participantIdSchema]).default(''),
  /** A full first name, or just an initial. */
  firstName: trimmed(60).min(1, 'First name is missing'),
  /** A full last name, an initial, or nothing. */
  lastName: trimmed(60).default(''),
  /** Worked out by the server from the level; anything sent is ignored. */
  kind: z.enum(['youth', 'adult']).default('youth'),
  /** A level name. New names are added to the camp's levels. Empty: the camp's first level. */
  level: trimmed(40).default(''),
  groupName: trimmed(120).default(''),
  photoConsent: z.enum(['yes', 'no']).default('no'),
  /** Keyed hash of the source dietary text, to detect changes. Never the text. */
  dietaryFingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
  /** Present only when the dietary text was reviewed in this import. */
  dietary: z.array(dietaryEntrySchema).max(10).optional(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

/** Editing one person on an event (People page). Only the fields an import would bring in. */
export const registrationPatchSchema = z.strictObject({
  participantId: participantIdSchema.optional(),
  firstName: trimmed(60).min(1, 'Enter a first name').optional(),
  lastName: trimmed(60).optional(),
  kind: z.enum(['youth', 'adult']).optional(),
  level: trimmed(40).min(1).optional(),
  /** A leader's car registration, for contacting them about it at camp. */
  carRego: trimmed(20).optional(),
  groupName: trimmed(120).optional(),
  photoConsent: z.enum(['yes', 'no']).optional(),
  status: z.enum(['active', 'withdrawn']).optional(),
});

export const dietaryUpdateSchema = z.strictObject({
  entries: z.array(dietaryEntrySchema).max(10),
  /** Import & check: fingerprints of the notes that were read (never the notes). */
  checkedNotes: z.array(z.string().regex(/^[a-z0-9]{1,16}$/)).max(4).optional(),
});

// ---------------------------------------------------------------- registration

/** One person, as entered on the public registration page or by an event manager. */
export const personEntrySchema = z.strictObject({
  firstName: trimmed(60).min(1, 'Enter a first name'),
  lastName: trimmed(60).default(''),
  /** Null when they don't have one (an ID is made for them). */
  participantId: participantIdSchema.nullable(),
  kind: z.enum(['youth', 'adult']),
  /** A level name. New names are added to the camp's levels. */
  level: trimmed(40).min(1),
  groupName: trimmed(120).default(''),
  photoConsent: z.enum(['yes', 'no']),
  dietary: z.array(dietaryEntrySchema).max(10).default([]),
});
export type PersonEntry = z.infer<typeof personEntrySchema>;

export const importRequestSchema = z.strictObject({
  rows: z.array(importRowSchema).min(1).max(2000),
  withdrawMissing: z.boolean().default(false),
  /** Imported level names linked to the camp's levels on the import screen, remembered for next time. */
  levelLinks: z
    .record(trimmed(40).min(1), trimmed(40).min(1))
    .refine((o) => Object.keys(o).length <= 200, 'Too many level links')
    .optional(),
});

// ---------------------------------------------------------------- activities, meals, stations, scans

const isoDateTime = z.iso.datetime({ offset: true });

/** Activity fields without defaults, so an edit only touches what it sends. */
const activityFields = {
  name: trimmed(80).min(1),
  description: trimmed(1000),
  location: trimmed(120),
  instructions: trimmed(2000),
  startsAt: isoDateTime.nullable(),
  endsAt: isoDateTime.nullable(),
  capacity: z.number().int().positive().max(10000).nullable(),
  capacityPolicy: z.enum(['warn', 'block']),
  trackSignOut: z.boolean(),
  allowRepeat: z.boolean(),
  bookingRequired: z.boolean(),
  /** People can book this session themselves at the sign-up screen. */
  signupOpen: z.boolean(),
  /** 'program': on the schedule only (Welcome, Movies…), never booked or scanned. */
  kind: z.enum(['activity', 'program']),
};

export const activityInputSchema = z.strictObject({
  ...activityFields,
  description: activityFields.description.default(''),
  location: activityFields.location.default(''),
  instructions: activityFields.instructions.default(''),
  startsAt: activityFields.startsAt.default(null),
  endsAt: activityFields.endsAt.default(null),
  capacity: activityFields.capacity.default(null),
  capacityPolicy: activityFields.capacityPolicy.default('warn'),
  trackSignOut: activityFields.trackSignOut.default(false),
  allowRepeat: activityFields.allowRepeat.default(true),
  bookingRequired: activityFields.bookingRequired.default(false),
  signupOpen: activityFields.signupOpen.default(false),
  kind: activityFields.kind.default('activity'),
});
export const activityPatchSchema = z.strictObject(activityFields).partial().extend({ status: z.enum(['active', 'cancelled']).optional() });

const mealFields = {
  name: trimmed(80).min(1),
  location: trimmed(120),
  startsAt: isoDateTime.nullable(),
  endsAt: isoDateTime.nullable(),
  /** What's served, for example "Spaghetti bolognese, garden salad". */
  menu: trimmed(1000),
  /** Additional notes (once the single ingredients box; items now hold each product's ingredients). */
  ingredients: trimmed(10000),
};

export const mealInputSchema = z.strictObject({
  ...mealFields,
  location: mealFields.location.default(''),
  menu: mealFields.menu.default(''),
  ingredients: mealFields.ingredients.default(''),
  startsAt: mealFields.startsAt.default(null),
  endsAt: mealFields.endsAt.default(null),
});
export const mealPatchSchema = z.strictObject(mealFields).partial().extend({ status: z.enum(['active', 'cancelled']).optional() });

/** A whole programme at once (Activities › Import programme). Saved all together, or not at all. */
export const programImportSchema = z
  .strictObject({
    activities: z.array(activityInputSchema).max(400).default([]),
    meals: z.array(mealInputSchema).max(150).default([]),
  })
  .refine((p) => p.activities.length + p.meals.length > 0, { message: 'There is nothing to import' });

// ---------------------------------------------------------------- team events

/** A team event (Soccer, Basketball…): an activity people enter as teams. */
const teamEventFields = {
  name: trimmed(80).min(1),
  description: trimmed(1000),
  location: trimmed(120),
  startsAt: isoDateTime.nullable(),
  endsAt: isoDateTime.nullable(),
  /** Fewest people a team needs to play. */
  minSize: z.number().int().min(1).max(100),
  /** Most people on one team (null: no limit). */
  maxSize: z.number().int().min(1).max(100).nullable(),
  /** Most teams that can enter (null: no limit). */
  maxTeams: z.number().int().min(1).max(200).nullable(),
  /** Participants can make and join teams themselves. */
  registrationOpen: z.boolean(),
};
const sizesMakeSense = (t: { minSize?: number; maxSize?: number | null }) => t.maxSize == null || t.minSize === undefined || t.maxSize >= t.minSize;
const sizeMessage = { message: 'The most per team must be at least the fewest', path: ['maxSize'] };

export const teamEventInputSchema = z
  .strictObject({
    ...teamEventFields,
    description: teamEventFields.description.default(''),
    location: teamEventFields.location.default(''),
    startsAt: teamEventFields.startsAt.default(null),
    endsAt: teamEventFields.endsAt.default(null),
    minSize: teamEventFields.minSize.default(1),
    maxSize: teamEventFields.maxSize.default(null),
    maxTeams: teamEventFields.maxTeams.default(null),
    registrationOpen: teamEventFields.registrationOpen.default(false),
  })
  .refine(sizesMakeSense, sizeMessage);
export const teamEventPatchSchema = z.strictObject(teamEventFields).partial().refine(sizesMakeSense, sizeMessage);

/** A leader roster duty: what, where and when. */
const dutyFields = {
  title: trimmed(80).min(1, 'Enter what the duty is, like Gate'),
  location: trimmed(120),
  notes: trimmed(500),
  startsAt: isoDateTime,
  endsAt: isoDateTime.nullable(),
};
const dutyTimesMakeSense = (d: { startsAt?: string; endsAt?: string | null }) => !d.startsAt || !d.endsAt || Date.parse(d.endsAt) > Date.parse(d.startsAt);
const dutyTimeMessage = { message: 'The end must be after the start', path: ['endsAt'] };
export const dutyInputSchema = z
  .strictObject({
    ...dutyFields,
    location: dutyFields.location.default(''),
    notes: dutyFields.notes.default(''),
    endsAt: dutyFields.endsAt.default(null),
    registrationIds: z.array(z.uuid()).max(200).default([]),
  })
  .refine(dutyTimesMakeSense, dutyTimeMessage);
export const dutyPatchSchema = z.strictObject(dutyFields).partial().refine(dutyTimesMakeSense, dutyTimeMessage);

export const teamNameSchema = z.strictObject({ name: trimmed(40).min(1, 'Enter a team name') });

export const stationInputSchema = z.strictObject({
  name: trimmed(60).min(1),
  contextType: z.enum(['activity', 'meal', 'site']),
  contextId: z.uuid().nullable(),
  hours: z.number().int().min(1).max(168).default(24),
});

export const stationPatchSchema = z.strictObject({
  name: trimmed(60).min(1).optional(),
  contextType: z.enum(['activity', 'meal', 'site']).optional(),
  contextId: z.uuid().nullable().optional(),
});

export const stationReopenSchema = z.strictObject({ hours: z.number().int().min(1).max(168).default(12) });

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
