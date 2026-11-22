import { z } from 'zod';

/**
 * The parts of a camper's page a link can switch on. Stored (and carried in
 * the page's pass) as bits, so the server can check every action against
 * the link it came from.
 */
export const LINK_FEATURES = ['programme', 'book', 'teams', 'food'] as const;
export type LinkFeature = (typeof LINK_FEATURES)[number];

export const LINK_FEATURE_INFO: Record<LinkFeature, { label: string; hint: string }> = {
  programme: { label: 'Programme', hint: 'The camp programme day by day, with their bookings marked' },
  book: { label: 'Book activities', hint: 'Book and cancel activities open for sign-up' },
  teams: { label: 'Teams', hint: 'Make and join teams (youth only)' },
  food: { label: 'Food', hint: 'Meal menus and what’s in each item' },
};

const BIT: Record<LinkFeature, number> = { programme: 1, book: 2, teams: 4, food: 8 };
export const ALL_FEATURES = 15;

export const maskOf = (features: readonly LinkFeature[]) => features.reduce((m, f) => m | BIT[f], 0);
export const featuresOf = (mask: number): LinkFeature[] => LINK_FEATURES.filter((f) => (mask & BIT[f]) !== 0);
export const hasFeature = (mask: number | undefined, f: LinkFeature) => mask === undefined || (mask & BIT[f]) !== 0;

export const participantLinkSchema = z.strictObject({
  name: z.string().trim().min(1, 'Give the link a name').max(60),
  features: z.array(z.enum(LINK_FEATURES)).min(1, 'Switch on at least one part').max(4),
});
export const participantLinkPatchSchema = participantLinkSchema.partial().extend({ active: z.boolean().optional() }).strict();
