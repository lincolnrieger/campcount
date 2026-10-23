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
