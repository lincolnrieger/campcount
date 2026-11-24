import { describe, expect, it } from 'vitest';
import type { MealItem } from '../src/shared/mealItems';
import { dietProfile, mealSummary, participantItems, prepareMealImport } from '../src/shared/mealItems';
import { api, createEvent, createUser, grant, json, testEnv } from './helpers';

// The example from the brief (made-up products).
const sample = [
  {
    name: 'Saturday breakfast',
    day: '2026-12-05',
    start: '07:30',
    end: '08:30',
    place: '',
    menu: 'Bacon, scrambled eggs, baked beans, toast…',
    notes: '',
    items: [
      {
        name: 'Drakes white bread rolls 6pk',
        category: 'Bread & wraps',
        ingredients: 'Wheat flour, water, yeast, canola oil, iodised salt, …',
        contains: ['wheat', 'gluten', 'soy', 'sesame'],
        may_contain: [],
        dietary: ['vegan', 'dairy free'],
        is_alternative: false,
        status: 'confirmed',
        internal_notes: '59 packs, Drakes Torrensville',
      },
      {
        name: 'Woolies Always gluten free soft white rolls 2pk',
        category: 'Bread & wraps',
        ingredients: 'Gluten-free flour mix (corn starch, potato starch, rice flour, …)',
        contains: [],
        may_contain: [],
        dietary: ['gluten free', 'dairy free', 'egg free'],
        is_alternative: true,
        replaces: 'Drakes white bread rolls 6pk',
        alternative_for: ['gluten free'],
        status: 'confirmed',
      },
    ],
  },
];
const DAYS = ['2026-12-05', '2026-12-06', '2026-12-07'];

describe('meal import validation', () => {
  it('accepts the sample, links "replaces" by name, and keeps unknown labels as custom', () => {
    const { meals, errors } = prepareMealImport(sample, DAYS);
    expect(errors).toEqual([]);
    expect(meals[0]!.items.map((i) => [i.name, i.isAlternative, i.replacesName])).toEqual([
      ['Drakes white bread rolls 6pk', false, null],
      ['Woolies Always gluten free soft white rolls 2pk', true, 'Drakes white bread rolls 6pk'],
    ]);
    const custom = prepareMealImport([{ ...sample[0], items: [{ name: 'X', category: 'snack', contains: ['Peanut', 'Lemon Myrtle'], dietary: ['Gluten Free', 'Keto'] }] }], DAYS);
    expect(custom.errors).toEqual([]);
    expect(custom.meals[0]!.items[0]).toMatchObject({ category: 'Snack', contains: ['peanut', 'lemon myrtle'], dietary: ['gluten free', 'keto'] });
  });

  it('explains what is wrong, and where', () => {
    const bad = prepareMealImport(
      [
        { ...sample[0], day: '2027-01-01', items: [{ name: 'A', category: 'Pizza' }, { name: 'B', category: 'Main', replaces: 'Nope', status: 'maybe' }] },
        { name: 'Lunch', day: '2026-12-05', start: '7pm', items: [] },
      ],
      DAYS,
    );
    expect(bad.errors.join('\n')).toMatch(/Meal 2 \(start\): Use a time like 07:30/);
    const bad2 = prepareMealImport([{ ...sample[0], day: '2027-01-01', items: [{ name: 'A', category: 'Pizza' }, { name: 'B', category: 'Main', replaces: 'Nope', status: 'maybe' }] }], DAYS);
    expect(bad2.errors).toEqual([
      'Meal 1 (Saturday breakfast): 2027-01-01 isn’t one of the camp’s days (2026-12-05 to 2026-12-07).',
      expect.stringMatching(/item 1 \(A\): “Pizza” isn’t a category/),
      'Meal 1 (Saturday breakfast), item 2 (B): status must be “confirmed” or “TBC”.',
      'Meal 1 (Saturday breakfast), item 2 (B): replaces “Nope”, but this meal has no item with that name.',
    ]);
    expect(prepareMealImport({ not: 'a list' }, DAYS).errors.length).toBe(1);
    expect(prepareMealImport([sample[0], sample[0]], DAYS).errors).toContain('Saturday breakfast on 2026-12-05 is in the file twice.');
  });
});

const item = (over: Partial<MealItem>): MealItem => ({
  id: over.name ?? 'x',
  mealId: 'm',
  name: 'x',
  category: 'Main',
  ingredients: '',
  contains: [],
  mayContain: [],
  dietary: [],
  isAlternative: false,
  replacesItemId: null,
  alternativeFor: [],
  status: 'confirmed',
  internalNotes: 'staff only',
  sortOrder: 0,
  ...over,
});

describe('participant conflicts', () => {
  const items = [
    item({ id: 'roll', name: 'White roll', contains: ['wheat', 'gluten', 'sesame'] }),
    item({ id: 'gf', name: 'GF roll', isAlternative: true, replacesItemId: 'roll', alternativeFor: ['gluten free'], dietary: ['gluten free'] }),
    item({ id: 'muesli', name: 'Muesli', mayContain: ['peanut'] }),
    item({ id: 'fruit', name: 'Fruit' }),
  ];

  it('marks what conflicts and their alternative, and never shows staff notes', () => {
    const p = dietProfile([{ category: 'medical_diet', item: 'Gluten free (coeliac)' }, { category: 'allergy', item: 'Peanut' }]);
    const out = participantItems(items, p);
    const by = (n: string) => out.find((i) => i.name === n)!;
    expect(by('White roll')).toMatchObject({ conflict: 'contains', yourAlternative: 'GF roll' });
    expect(by('GF roll')).toMatchObject({ forYou: true, replaces: 'White roll', conflict: null });
    expect(by('Muesli').conflict).toBe('may_contain');
    expect(by('Fruit').conflict).toBeNull();
    expect(JSON.stringify(out)).not.toContain('staff only');
  });

  it('shows everything with no warnings when nothing they need matches', () => {
    const none = participantItems(items, dietProfile([{ category: 'preference', item: 'Likes spicy food' }]));
    expect(none.every((i) => i.conflict === null && !i.forYou && i.yourAlternative === null)).toBe(true);
    expect(participantItems(items, null).every((i) => i.conflict === null)).toBe(true);
  });

  it('matches "sesame allergy" style alternatives to an allergy', () => {
    const p = dietProfile([{ category: 'allergy', item: 'Sesame' }]);
    const out = participantItems([...items, item({ id: 'ss', name: 'Sesame-free roll', isAlternative: true, replacesItemId: 'roll', alternativeFor: ['sesame allergy'] })], p);
    expect(out.find((i) => i.name === 'White roll')).toMatchObject({ conflict: 'contains', yourAlternative: 'Sesame-free roll' });
  });

  it('summarises a meal', () => {
    expect(mealSummary(items)).toEqual({ items: 4, alternatives: 1, contains: ['gluten', 'wheat', 'sesame'] });
  });
});

describe('meal items API', () => {
  it('imports the sample, links alternatives, replaces on re-import, and hides staff notes from participants', async () => {
    const admin = await createUser({ platformAdmin: true });
    const eventId = await createEvent(admin.id, { status: 'open' });
    await testEnv.DB.prepare(`UPDATE events SET feature_meals = 1, feature_dietary = 1 WHERE id = ?`).bind(eventId).run();
    const manager = await createUser();
    await grant(manager.id, 'event_manager', eventId);

    const preview = await json(await api(`/events/${eventId}/meals/import`, { cookie: manager.cookie, body: { meals: sample, preview: true } }));
    expect(preview).toMatchObject({ ok: true, meals: [{ name: 'Saturday breakfast', items: 1, alternatives: 1, action: 'create' }] });
    expect((await api(`/events/${eventId}/meals/import`, { cookie: manager.cookie, body: { meals: sample } })).status).toBe(200);
    const { items } = await json(await api(`/events/${eventId}/meal-items`, { cookie: manager.cookie }));
    const roll = items.find((i: MealItem) => !i.isAlternative);
    const gf = items.find((i: MealItem) => i.isAlternative);
    expect(gf.replacesItemId).toBe(roll.id);
    expect(roll.internalNotes).toBe('59 packs, Drakes Torrensville');

    // Again, replacing: still one meal, same items count.
    const again = await json(await api(`/events/${eventId}/meals/import`, { cookie: manager.cookie, body: { meals: sample, mode: 'replace' } }));
    expect(again.meals[0].action).toBe('replace');
    const meals = (await json(await api(`/events/${eventId}/meals`, { cookie: manager.cookie }))).meals;
    expect(meals).toHaveLength(1);
    expect((await json(await api(`/events/${eventId}/meal-items`, { cookie: manager.cookie }))).items).toHaveLength(2);

    // Invalid imports change nothing.
    const bad = await api(`/events/${eventId}/meals/import`, { cookie: manager.cookie, body: { meals: [{ ...sample[0], day: '2030-01-01' }] } });
    expect(bad.status).toBe(400);

    // Duplicate to another day, copying items (and their links).
    const dup = await json(await api(`/events/${eventId}/meals/${meals[0].id}/duplicate`, { cookie: manager.cookie, body: { day: '2026-12-06', name: 'Sunday breakfast' } }));
    const all = (await json(await api(`/events/${eventId}/meal-items`, { cookie: manager.cookie }))).items as MealItem[];
    const copied = all.filter((i) => i.mealId === dup.id);
    expect(copied).toHaveLength(2);
    expect(copied.find((i) => i.isAlternative)!.replacesItemId).toBe(copied.find((i) => !i.isAlternative)!.id);

    // A coeliac participant: their meals page flags the roll and offers the GF one; no staff notes.
    await api(`/events/${eventId}/import/commit`, {
      cookie: manager.cookie,
      body: {
        rows: [
          {
            participantId: '100',
            firstName: 'Ava',
            lastName: 'Example',
            kind: 'youth',
            level: 'Seniors',
            groupName: '',
            photoConsent: 'yes',
            dietary: [{ category: 'medical_diet', item: 'Gluten free (coeliac)', severity: 'standard', note: '' }],
          },
        ],
      },
    });
    await api(`/events/${eventId}/credentials/issue`, { cookie: manager.cookie, body: { mode: 'missing' } });
    const { cards } = await json(await api(`/events/${eventId}/credentials/print`, { cookie: manager.cookie, body: {} }));
    const view = await json(await api('/public/signup/identify', { body: { token: cards[0].qr.split('#')[1] } }));
    const res = await api('/public/signup/meals', { body: { pass: view.pass } });
    const text = await res.clone().text();
    expect(text).not.toContain('Drakes Torrensville');
    const mine = await json(res);
    expect(mine.hasNeeds).toBe(true);
    const sat = mine.meals[meals[0].id] as { name: string; conflict: string | null; yourAlternative: string | null }[];
    expect(sat.find((i) => i.name.startsWith('Drakes'))).toMatchObject({ conflict: 'contains', yourAlternative: 'Woolies Always gluten free soft white rolls 2pk' });

    // Scanners can't change items.
    const scanner = await createUser();
    await grant(scanner.id, 'scanner', eventId);
    expect((await api(`/events/${eventId}/meals/import`, { cookie: scanner.cookie, body: { meals: sample } })).status).toBe(403);
  });
});
