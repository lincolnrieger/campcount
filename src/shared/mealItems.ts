import { z } from 'zod';

/**
 * Meal items: the products that make up a meal (a breakfast can have 50),
 * each with its ingredients, allergens and dietary labels, and dietary
 * alternatives that replace something for the people who need it.
 * Shared by the Meals page, the JSON import, the server and participants'
 * own pages.
 */

export const MEAL_CATEGORIES = [
  'Main',
  'Side',
  'Bread & wraps',
  'Spreads & condiments',
  'Sauces & dressings',
  'Cereal',
  'Dairy & milk',
  'Drinks',
  'Fruit & veg',
  'Dessert',
  'Snack',
  'Other',
] as const;
export type MealCategory = (typeof MEAL_CATEGORIES)[number];

/** The allergens CampCount knows (Australia's mandatory 14-ish, plus common extras). Custom ones can be added. */
export const ALLERGENS = [
  'gluten',
  'wheat',
  'milk',
  'egg',
  'soy',
  'peanut',
  'tree nuts',
  'sesame',
  'fish',
  'crustacean',
  'mollusc',
  'lupin',
  'sulphites',
  'pork',
  'rice',
  'fructose',
  'mustard',
  'celery',
] as const;

export const DIETARY_TAGS = [
  'gluten free',
  'dairy free',
  'lactose free',
  'vegan',
  'vegetarian',
  'halal',
  'nut free',
  'egg free',
  'soy free',
  'diabetic friendly',
  'low FODMAP/fructose free',
] as const;

export const ITEM_STATUSES = ['confirmed', 'tbc'] as const;

/** A label as stored: trimmed, single-spaced, and a known one's own spelling when it matches (any case). */
export function normalizeLabel(raw: string, known: readonly string[]): string {
  const t = raw.trim().replace(/\s+/g, ' ');
  return known.find((k) => k.toLowerCase() === t.toLowerCase()) ?? t.toLowerCase();
}
const labels = (known: readonly string[]) =>
  z
    .array(z.string().trim().min(1).max(40))
    .max(30)
    .default([])
    .transform((list) => [...new Set(list.map((x) => normalizeLabel(x, known)))]);

/** One item as the Meals page sends it. */
export const mealItemInputSchema = z.strictObject({
  name: z.string().trim().min(1, 'Give the item a name').max(200),
  category: z.enum(MEAL_CATEGORIES),
  ingredients: z.string().max(5000).default(''),
  contains: labels(ALLERGENS),
  mayContain: labels(ALLERGENS),
  dietary: labels(DIETARY_TAGS),
  isAlternative: z.boolean().default(false),
  replacesItemId: z.uuid().nullable().default(null),
  alternativeFor: labels([...DIETARY_TAGS, ...ALLERGENS]),
  status: z.enum(ITEM_STATUSES).default('confirmed'),
  internalNotes: z.string().trim().max(2000).default(''),
});
export type MealItemInput = z.infer<typeof mealItemInputSchema>;
export const mealItemPatchSchema = mealItemInputSchema.partial();

/** A stored item, as the server returns it (staff). Participants never get internalNotes. */
export interface MealItem {
  id: string;
  mealId: string;
  name: string;
  category: MealCategory;
  ingredients: string;
  contains: string[];
  mayContain: string[];
  dietary: string[];
  isAlternative: boolean;
  replacesItemId: string | null;
  alternativeFor: string[];
  status: 'confirmed' | 'tbc';
  internalNotes?: string;
  sortOrder: number;
}

// ---------------------------------------------------------------- summary

/** "32 items · 17 alternatives · Contains: gluten, milk…" for a meal card. */
export function mealSummary(items: Pick<MealItem, 'isAlternative' | 'contains'>[]) {
  const main = items.filter((i) => !i.isAlternative);
  const alternatives = items.length - main.length;
  const contains = [...new Set(main.flatMap((i) => i.contains))].sort(
    (a, b) => (ALLERGENS as readonly string[]).indexOf(a) - (ALLERGENS as readonly string[]).indexOf(b) || a.localeCompare(b),
  );
  return { items: items.length, alternatives, contains };
}

// ---------------------------------------------------------------- JSON import

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 07:30');
const importItemSchema = z.object({
  name: z.string().trim().min(1, 'Every item needs a name').max(200),
  category: z.string().trim().default('Other'),
  ingredients: z.string().max(5000).default(''),
  contains: z.array(z.string()).max(30).default([]),
  may_contain: z.array(z.string()).max(30).default([]),
  dietary: z.array(z.string()).max(30).default([]),
  is_alternative: z.boolean().default(false),
  replaces: z.string().trim().max(200).optional(),
  alternative_for: z.array(z.string()).max(30).default([]),
  status: z.string().trim().default('confirmed'),
  internal_notes: z.string().max(2000).default(''),
});
const importMealSchema = z.object({
  name: z.string().trim().min(1, 'Every meal needs a name').max(80),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a day like 2026-12-05'),
  start: hhmm,
  end: z.union([hhmm, z.literal('')]).optional(),
  place: z.string().trim().max(120).default(''),
  menu: z.string().trim().max(1000).default(''),
  notes: z.string().max(10000).default(''),
  items: z.array(importItemSchema).max(300).default([]),
});
export const mealImportSchema = z.array(importMealSchema).min(1, 'There are no meals in it').max(100);

export interface PreparedMealItem extends MealItemInput {
  /** Name of the item this replaces, matched within the same meal. */
  replacesName: string | null;
}
export interface PreparedMeal {
  name: string;
  day: string;
  start: string;
  end: string | null;
  place: string;
  menu: string;
  notes: string;
  items: PreparedMealItem[];
}

const categoryOf = (raw: string): MealCategory | null => MEAL_CATEGORIES.find((c) => c.toLowerCase() === raw.trim().toLowerCase()) ?? null;
const clean = (list: string[], known: readonly string[]) => [...new Set(list.filter((x) => x.trim()).map((x) => normalizeLabel(x, known).slice(0, 40)))];

/**
 * Check a JSON import against the camp's days and turn it into meals and
 * items. Unknown allergen and dietary words are kept as custom ones.
 * Errors say where ("Meal 2 (Saturday lunch), item 4: …").
 */
export function prepareMealImport(raw: unknown, days: readonly string[]): { meals: PreparedMeal[]; errors: string[] } {
  const parsed = mealImportSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      meals: [],
      errors: parsed.error.issues.slice(0, 20).map((i) => {
        const [m, field, item, itemField] = i.path;
        const where = typeof m === 'number' ? `Meal ${m + 1}` : 'The file';
        const deeper = field === 'items' && typeof item === 'number' ? `, item ${item + 1}${itemField ? ` (${String(itemField)})` : ''}` : field ? ` (${String(field)})` : '';
        return `${where}${deeper}: ${i.message}`;
      }),
    };
  }
  const errors: string[] = [];
  const meals: PreparedMeal[] = parsed.data.map((m, mi) => {
    const where = `Meal ${mi + 1} (${m.name})`;
    if (!days.includes(m.day)) errors.push(`${where}: ${m.day} isn’t one of the camp’s days (${days[0]} to ${days[days.length - 1]}).`);
    if (m.end && m.end <= m.start) errors.push(`${where}: it ends before it starts.`);
    const names = new Set<string>();
    const items: PreparedMealItem[] = m.items.map((it, ii) => {
      const at = `${where}, item ${ii + 1} (${it.name})`;
      const category = categoryOf(it.category);
      if (!category) errors.push(`${at}: “${it.category}” isn’t a category. Use one of: ${MEAL_CATEGORIES.join(', ')}.`);
      const st = it.status.toLowerCase();
      const status = st.includes('tbc') ? 'tbc' : st === 'confirmed' ? 'confirmed' : null;
      if (!status) errors.push(`${at}: status must be “confirmed” or “TBC”.`);
      names.add(it.name.toLowerCase());
      return {
        name: it.name,
        category: category ?? 'Other',
        ingredients: it.ingredients,
        contains: clean(it.contains, ALLERGENS),
        mayContain: clean(it.may_contain, ALLERGENS),
        dietary: clean(it.dietary, DIETARY_TAGS),
        isAlternative: it.is_alternative,
        replacesItemId: null,
        replacesName: it.replaces?.trim() || null,
        alternativeFor: clean(it.alternative_for, [...DIETARY_TAGS, ...ALLERGENS]),
        status: status ?? 'confirmed',
        internalNotes: it.internal_notes.trim(),
      };
    });
    items.forEach((it, ii) => {
      if (it.replacesName && !items.some((o) => o !== it && o.name.toLowerCase() === it.replacesName!.toLowerCase())) {
        errors.push(`${where}, item ${ii + 1} (${it.name}): replaces “${it.replacesName}”, but this meal has no item with that name.`);
      }
    });
    return { name: m.name, day: m.day, start: m.start, end: m.end || null, place: m.place, menu: m.menu, notes: m.notes, items };
  });
  const seen = new Set<string>();
  for (const m of meals) {
    const k = `${m.day}|${m.name.toLowerCase()}`;
    if (seen.has(k)) errors.push(`${m.name} on ${m.day} is in the file twice.`);
    seen.add(k);
  }
  return { meals, errors };
}

// ---------------------------------------------------------------- participants

/** What someone needs to avoid, and the labels that suit them, worked out from their recorded dietary needs. */
export interface DietProfile {
  avoid: Set<string>;
  suits: Set<string>;
}

const AVOID_RULES: { re: RegExp; avoid: string[]; suits: string[] }[] = [
  { re: /peanut/i, avoid: ['peanut'], suits: ['nut free'] },
  { re: /tree ?nut|almond|cashew|walnut|hazelnut|pecan|pistachio|macadamia|\bnuts?\b/i, avoid: ['tree nuts'], suits: ['nut free'] },
  { re: /sesame/i, avoid: ['sesame'], suits: [] },
  { re: /shell ?fish|crustacean|prawn|crab|lobster/i, avoid: ['crustacean', 'mollusc'], suits: [] },
  { re: /mollusc|squid|oyster|mussel/i, avoid: ['mollusc'], suits: [] },
  { re: /\bfish\b/i, avoid: ['fish'], suits: [] },
  { re: /\beggs?\b/i, avoid: ['egg'], suits: ['egg free'] },
  { re: /\bsoy|soya/i, avoid: ['soy'], suits: ['soy free'] },
  { re: /lupin/i, avoid: ['lupin'], suits: [] },
  { re: /sulphite|sulfite/i, avoid: ['sulphites'], suits: [] },
  { re: /mustard/i, avoid: ['mustard'], suits: [] },
  { re: /celery/i, avoid: ['celery'], suits: [] },
  { re: /\brice\b/i, avoid: ['rice'], suits: [] },
  { re: /coeliac|celiac|gluten/i, avoid: ['gluten', 'wheat'], suits: ['gluten free'] },
  { re: /wheat/i, avoid: ['wheat'], suits: [] },
  { re: /lactose/i, avoid: ['milk'], suits: ['lactose free', 'dairy free'] },
  { re: /dairy|\bmilk\b/i, avoid: ['milk'], suits: ['dairy free'] },
  { re: /fructose|fodmap/i, avoid: ['fructose'], suits: ['low FODMAP/fructose free'] },
  { re: /diabet/i, avoid: [], suits: ['diabetic friendly'] },
  { re: /\bvegan\b/i, avoid: ['milk', 'egg', 'pork', 'fish', 'crustacean', 'mollusc'], suits: ['vegan'] },
  { re: /vegetarian|veggie/i, avoid: ['pork', 'fish', 'crustacean', 'mollusc'], suits: ['vegetarian', 'vegan'] },
  { re: /halal|no pork|\bpork\b/i, avoid: ['pork'], suits: ['halal'] },
];

/**
 * A participant's dietary needs (as recorded: category and item, e.g.
 * "allergy: Peanut", "medical diet: Gluten free (coeliac)") as allergens
 * to avoid and labels that suit them. Anything that names a custom
 * allergen used at camp counts too.
 */
export function dietProfile(entries: { category: string; item: string; note?: string }[], customAllergens: readonly string[] = []): DietProfile {
  const avoid = new Set<string>();
  const suits = new Set<string>();
  for (const e of entries) {
    const text = `${e.item} ${e.note ?? ''}`;
    for (const r of AVOID_RULES) {
      if (!r.re.test(text)) continue;
      r.avoid.forEach((a) => avoid.add(a));
      r.suits.forEach((s) => suits.add(s));
    }
    for (const c of customAllergens) if (c && text.toLowerCase().includes(c.toLowerCase())) avoid.add(c);
  }
  return { avoid, suits };
}

export type Conflict = 'contains' | 'may_contain' | null;

/** Whether an item has something they must avoid (red), might (amber), or neither. */
export function conflictOf(item: Pick<MealItem, 'contains' | 'mayContain'>, p: DietProfile): Conflict {
  if (item.contains.some((a) => p.avoid.has(a))) return 'contains';
  if (item.mayContain.some((a) => p.avoid.has(a))) return 'may_contain';
  return null;
}

/** Is this alternative meant for them ("gluten free", "sesame allergy"…)? */
export function alternativeSuits(item: Pick<MealItem, 'alternativeFor'>, p: DietProfile): boolean {
  return item.alternativeFor.some((f) => {
    const t = f.toLowerCase();
    return p.suits.has(f) || [...p.suits].some((s) => s.toLowerCase() === t) || [...p.avoid].some((a) => t.includes(a.toLowerCase()));
  });
}

export interface ParticipantItem {
  id: string;
  name: string;
  category: MealCategory;
  ingredients: string;
  contains: string[];
  mayContain: string[];
  dietary: string[];
  isAlternative: boolean;
  replaces: string | null;
  alternativeFor: string[];
  tbc: boolean;
  conflict: Conflict;
  /** For an item they can't have: the alternative meant for them, if there is one. */
  yourAlternative: string | null;
  /** An alternative meant for them. */
  forYou: boolean;
}

/**
 * A meal's items for one participant: no staff notes, and (when they have
 * dietary needs recorded) each item marked if it conflicts, with their
 * alternative where there is one.
 */
export function participantItems(items: MealItem[], p: DietProfile | null): ParticipantItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const profile = p && (p.avoid.size || p.suits.size) ? p : null;
  return items.map((i) => {
    const conflict = profile ? conflictOf(i, profile) : null;
    const forYou = !!profile && i.isAlternative && alternativeSuits(i, profile) && conflictOf(i, profile) !== 'contains';
    const alt = profile && conflict && !i.isAlternative ? items.find((a) => a.isAlternative && a.replacesItemId === i.id && alternativeSuits(a, profile) && conflictOf(a, profile) !== 'contains') : undefined;
    return {
      id: i.id,
      name: i.name,
      category: i.category,
      ingredients: i.ingredients,
      contains: i.contains,
      mayContain: i.mayContain,
      dietary: i.dietary,
      isAlternative: i.isAlternative,
      replaces: i.replacesItemId ? (byId.get(i.replacesItemId)?.name ?? null) : null,
      alternativeFor: i.alternativeFor,
      tbc: i.status === 'tbc',
      conflict,
      yourAlternative: alt?.name ?? null,
      forYou,
    };
  });
}
