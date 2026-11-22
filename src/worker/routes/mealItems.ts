import { Hono } from 'hono';
import { z } from 'zod';
import { isEditable } from '../../shared/lifecycle';
import type { MealItem, MealItemInput, PreparedMeal } from '../../shared/mealItems';
import { mealItemInputSchema, mealItemPatchSchema, prepareMealImport } from '../../shared/mealItems';
import { eventDays, zonedIso } from '../../shared/time';
import type { AppContext, AppEnv } from '../context';
import { parseBody, requirePermission, requirePrincipal, requireUser } from '../context';
import { badRequest, conflict, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import { auditStatement } from '../services/audit';
import { can } from '../services/principal';
import { getEventRow } from './events';

/**
 * Meal items (Meals page): the products in each meal, with ingredients,
 * allergens, dietary labels and alternatives. Meal managers change them;
 * anyone who can see the meals list can read them (with staff notes).
 */
export const mealItemRoutes = new Hono<AppEnv>();

const uuid = (v: string | undefined) => {
  const p = z.uuid().safeParse(v);
  if (!p.success) throw notFound();
  return p.data;
};

async function editableEvent(c: AppContext, eventId: string) {
  requirePermission(c, 'meals.manage', { eventId });
  const event = await getEventRow(c.env.DB, eventId);
  if (!event) throw notFound();
  if (!isEditable(event.status)) throw conflict('This event is closed. Reopen it to make changes.');
  return event;
}

type Row = Record<string, string | number | null>;
const list = (v: unknown): string[] => {
  try {
    const x = JSON.parse(String(v ?? '[]')) as unknown;
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
};

export function itemFromRow(r: Row, withNotes: boolean): MealItem {
  return {
    id: String(r.id),
    mealId: String(r.meal_id),
    name: String(r.name),
    category: String(r.category) as MealItem['category'],
    ingredients: String(r.ingredients ?? ''),
    contains: list(r.contains),
    mayContain: list(r.may_contain),
    dietary: list(r.dietary),
    isAlternative: r.is_alternative === 1,
    replacesItemId: (r.replaces_item_id as string | null) ?? null,
    alternativeFor: list(r.alternative_for),
    status: r.status === 'tbc' ? 'tbc' : 'confirmed',
    ...(withNotes ? { internalNotes: String(r.internal_notes ?? '') } : {}),
    sortOrder: Number(r.sort_order ?? 0),
  };
}

const COLUMNS = `id, meal_id, name, category, ingredients, contains, may_contain, dietary, is_alternative, replaces_item_id, alternative_for, status, internal_notes, sort_order`;

/** All items for an event's meals (or one meal), in order. */
export async function loadItems(db: D1Database, eventId: string, mealId?: string): Promise<Row[]> {
  const { results } = await db
    .prepare(`SELECT ${COLUMNS} FROM meal_items WHERE event_id = ? ${mealId ? 'AND meal_id = ?' : ''} ORDER BY meal_id, sort_order, created_at`)
    .bind(...(mealId ? [eventId, mealId] : [eventId]))
    .all<Row>();
  return results;
}

function insertItem(db: D1Database, eventId: string, mealId: string, id: string, it: MealItemInput, sortOrder: number, now: string): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO meal_items (id, meal_id, event_id, name, category, ingredients, contains, may_contain, dietary, is_alternative, replaces_item_id, alternative_for, status, internal_notes, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      mealId,
      eventId,
      it.name,
      it.category,
      it.ingredients,
      JSON.stringify(it.contains),
      JSON.stringify(it.mayContain),
      JSON.stringify(it.dietary),
      it.isAlternative ? 1 : 0,
      it.replacesItemId,
      JSON.stringify(it.alternativeFor),
      it.status,
      it.internalNotes,
      sortOrder,
      now,
      now,
    );
}

async function mealRow(c: AppContext, eventId: string, mealId: string) {
  const m = await c.env.DB.prepare(`SELECT id, name, location, starts_at, ends_at, menu, ingredients FROM meal_services WHERE id = ? AND event_id = ?`)
    .bind(mealId, eventId)
    .first<{ id: string; name: string; location: string; starts_at: string | null; ends_at: string | null; menu: string; ingredients: string }>();
  if (!m) throw notFound();
  return m;
}

/** An item's replacesItemId must be another item in the same meal. */
async function checkReplaces(c: AppContext, mealId: string, replacesItemId: string | null | undefined, selfId?: string) {
  if (!replacesItemId) return;
  if (replacesItemId === selfId) throw badRequest('An item can’t replace itself.');
  const ok = await c.env.DB.prepare(`SELECT 1 FROM meal_items WHERE id = ? AND meal_id = ?`).bind(replacesItemId, mealId).first();
  if (!ok) throw badRequest('Choose an item from the same meal for it to replace.');
}

// ---------------------------------------------------------------- read

mealItemRoutes.get('/meal-items', async (c) => {
  const eventId = c.req.param('eventId')!;
  const principal = requirePrincipal(c);
  if (!can(principal, 'meals.manage', { eventId }) && !can(principal, 'meal.scan', { eventId })) requirePermission(c, 'meals.manage', { eventId });
  return c.json({ items: (await loadItems(c.env.DB, eventId)).map((r) => itemFromRow(r, true)) });
});

// ---------------------------------------------------------------- one item

mealItemRoutes.post('/meals/:mealId/items', async (c) => {
  const eventId = c.req.param('eventId')!;
  const mealId = uuid(c.req.param('mealId'));
  await editableEvent(c, eventId);
  const user = requireUser(c);
  const input = await parseBody(c, mealItemInputSchema);
  await mealRow(c, eventId, mealId);
  await checkReplaces(c, mealId, input.replacesItemId);
  const last = await c.env.DB.prepare(`SELECT COALESCE(max(sort_order), -1) AS n FROM meal_items WHERE meal_id = ?`).bind(mealId).first<{ n: number }>();
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    insertItem(c.env.DB, eventId, mealId, id, input, (last?.n ?? -1) + 1, nowIso()),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'meal_item.create', eventId, targetType: 'meal', targetId: mealId }),
  ]);
  return c.json({ id }, 201);
});

mealItemRoutes.patch('/meal-items/:itemId', async (c) => {
  const eventId = c.req.param('eventId')!;
  const itemId = uuid(c.req.param('itemId'));
  await editableEvent(c, eventId);
  const user = requireUser(c);
  const input = await parseBody(c, mealItemPatchSchema);
  const row = await c.env.DB.prepare(`SELECT meal_id FROM meal_items WHERE id = ? AND event_id = ?`).bind(itemId, eventId).first<{ meal_id: string }>();
  if (!row) throw notFound();
  await checkReplaces(c, row.meal_id, input.replacesItemId, itemId);
  const map: Record<string, [string, (v: unknown) => unknown]> = {
    name: ['name', (v) => v],
    category: ['category', (v) => v],
    ingredients: ['ingredients', (v) => v],
    contains: ['contains', (v) => JSON.stringify(v)],
    mayContain: ['may_contain', (v) => JSON.stringify(v)],
    dietary: ['dietary', (v) => JSON.stringify(v)],
    isAlternative: ['is_alternative', (v) => (v ? 1 : 0)],
    replacesItemId: ['replaces_item_id', (v) => v],
    alternativeFor: ['alternative_for', (v) => JSON.stringify(v)],
    status: ['status', (v) => v],
    internalNotes: ['internal_notes', (v) => v],
  };
  const keys = Object.keys(input).filter((k) => k in map && input[k as keyof typeof input] !== undefined);
  if (keys.length === 0) return c.json({ ok: true });
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE meal_items SET ${keys.map((k) => `${map[k]![0]} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND event_id = ?`).bind(
      ...keys.map((k) => map[k]![1](input[k as keyof typeof input]) as string | number | null),
      nowIso(),
      itemId,
      eventId,
    ),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'meal_item.update', eventId, targetType: 'meal', targetId: row.meal_id, detail: { fields: keys.join(',') } }),
  ]);
  return c.json({ ok: true });
});

mealItemRoutes.delete('/meal-items/:itemId', async (c) => {
  const eventId = c.req.param('eventId')!;
  const itemId = uuid(c.req.param('itemId'));
  await editableEvent(c, eventId);
  const user = requireUser(c);
  const res = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE meal_items SET replaces_item_id = NULL WHERE replaces_item_id = ? AND event_id = ?`).bind(itemId, eventId),
    c.env.DB.prepare(`DELETE FROM meal_items WHERE id = ? AND event_id = ?`).bind(itemId, eventId),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'meal_item.delete', eventId, targetType: 'meal_item', targetId: itemId }),
  ]);
  if (res[1]!.meta.changes !== 1) throw notFound();
  return c.json({ ok: true });
});

mealItemRoutes.post('/meal-items/:itemId/duplicate', async (c) => {
  const eventId = c.req.param('eventId')!;
  const itemId = uuid(c.req.param('itemId'));
  await editableEvent(c, eventId);
  const user = requireUser(c);
  const row = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM meal_items WHERE id = ? AND event_id = ?`).bind(itemId, eventId).first<Row>();
  if (!row) throw notFound();
  const it = itemFromRow(row, true);
  const id = crypto.randomUUID();
  const now = nowIso();
  await c.env.DB.batch([
    // Straight after the original.
    c.env.DB.prepare(`UPDATE meal_items SET sort_order = sort_order + 1 WHERE meal_id = ? AND sort_order > ?`).bind(it.mealId, it.sortOrder),
    insertItem(c.env.DB, eventId, it.mealId, id, { ...it, name: `${it.name} (copy)`.slice(0, 200), internalNotes: it.internalNotes ?? '' }, it.sortOrder + 1, now),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'meal_item.duplicate', eventId, targetType: 'meal', targetId: it.mealId }),
  ]);
  return c.json({ id }, 201);
});

/** New order for a meal's items (all of them, or one category's). */
mealItemRoutes.post('/meals/:mealId/items/reorder', async (c) => {
  const eventId = c.req.param('eventId')!;
  const mealId = uuid(c.req.param('mealId'));
  await editableEvent(c, eventId);
  const { ids } = await parseBody(c, z.strictObject({ ids: z.array(z.uuid()).min(1).max(500) }));
  const { results } = await c.env.DB.prepare(`SELECT id, sort_order FROM meal_items WHERE meal_id = ? AND event_id = ? ORDER BY sort_order`)
    .bind(mealId, eventId)
    .all<{ id: string; sort_order: number }>();
  const known = new Set(results.map((r) => r.id));
  if (!ids.every((i) => known.has(i))) throw badRequest('Those items aren’t all in this meal.');
  // The moved ones take the places the listed items held, in their new order.
  const slots = results.filter((r) => ids.includes(r.id)).map((r) => r.sort_order);
  await c.env.DB.batch(ids.map((id, i) => c.env.DB.prepare(`UPDATE meal_items SET sort_order = ? WHERE id = ?`).bind(slots[i]!, id)));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- copying

/** Statements that copy items into a meal, keeping "replaces" links between copied items. */
function copyStatements(c: AppContext, eventId: string, toMealId: string, items: MealItem[], startAt: number, now: string): D1PreparedStatement[] {
  const ids = new Map(items.map((i) => [i.id, crypto.randomUUID()]));
  return items.map((it, i) =>
    insertItem(
      c.env.DB,
      eventId,
      toMealId,
      ids.get(it.id)!,
      { ...it, replacesItemId: it.replacesItemId ? (ids.get(it.replacesItemId) ?? null) : null, internalNotes: it.internalNotes ?? '' },
      startAt + i,
      now,
    ),
  );
}

mealItemRoutes.post('/meals/:mealId/items/copy', async (c) => {
  const eventId = c.req.param('eventId')!;
  const mealId = uuid(c.req.param('mealId'));
  await editableEvent(c, eventId);
  const user = requireUser(c);
  const { fromMealId, itemIds } = await parseBody(c, z.strictObject({ fromMealId: z.uuid(), itemIds: z.array(z.uuid()).max(500).optional() }));
  if (fromMealId === mealId) throw badRequest('Choose a different meal to copy from.');
  await mealRow(c, eventId, mealId);
  await mealRow(c, eventId, fromMealId);
  const items = (await loadItems(c.env.DB, eventId, fromMealId)).map((r) => itemFromRow(r, true)).filter((i) => !itemIds || itemIds.includes(i.id));
  if (items.length === 0) throw badRequest('There’s nothing to copy.');
  const last = await c.env.DB.prepare(`SELECT COALESCE(max(sort_order), -1) AS n FROM meal_items WHERE meal_id = ?`).bind(mealId).first<{ n: number }>();
  await c.env.DB.batch([
    ...copyStatements(c, eventId, mealId, items, (last?.n ?? -1) + 1, nowIso()),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'meal_item.copy', eventId, targetType: 'meal', targetId: mealId, detail: { from: fromMealId, items: items.length } }),
  ]);
  return c.json({ copied: items.length });
});

/** The same meal on another day: same times, place, menu, notes and items. */
mealItemRoutes.post('/meals/:mealId/duplicate', async (c) => {
  const eventId = c.req.param('eventId')!;
  const mealId = uuid(c.req.param('mealId'));
  const event = await editableEvent(c, eventId);
  const user = requireUser(c);
  const { day, name } = await parseBody(c, z.strictObject({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(1).max(80).optional() }));
  if (!eventDays(event.starts_on, event.ends_on).includes(day)) throw badRequest('Choose one of the camp’s days.');
  const m = await mealRow(c, eventId, mealId);
  const tz = event.timezone;
  const shift = (iso: string | null) => (iso ? zonedIso(day, new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)), tz) : null);
  const items = (await loadItems(c.env.DB, eventId, mealId)).map((r) => itemFromRow(r, true));
  const id = crypto.randomUUID();
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO meal_services (id, event_id, name, location, starts_at, ends_at, menu, ingredients, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, eventId, name ?? m.name, m.location, shift(m.starts_at), shift(m.ends_at), m.menu, m.ingredients, now, now),
    ...copyStatements(c, eventId, id, items, 0, now),
    auditStatement(c.env.DB, { actor: { type: 'user', id: user.userId }, action: 'meal.duplicate', eventId, targetType: 'meal', targetId: id, detail: { from: mealId, day } }),
  ]);
  return c.json({ id }, 201);
});

// ---------------------------------------------------------------- JSON import

const importBody = z.strictObject({
  meals: z.unknown(),
  mode: z.enum(['replace', 'add']).default('replace'),
  preview: z.boolean().default(false),
});

/**
 * Import meals and their items from JSON (Meals › More actions › Import
 * meals). Preview first: what would be made or replaced, and any problems.
 * "replace": a meal with the same name and day keeps its scans and gets the
 * new details and items; "add": always new meals.
 */
mealItemRoutes.post('/meals/import', async (c) => {
  const eventId = c.req.param('eventId')!;
  const event = await editableEvent(c, eventId);
  const user = requireUser(c);
  const { meals: raw, mode, preview } = await parseBody(c, importBody);
  const days = eventDays(event.starts_on, event.ends_on);
  const { meals, errors } = prepareMealImport(raw, days);
  const tz = event.timezone;
  const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  const existing = await c.env.DB.prepare(`SELECT id, name, starts_at FROM meal_services WHERE event_id = ?`).bind(eventId).all<{ id: string; name: string; starts_at: string | null }>();
  const match = (m: PreparedMeal) => (mode === 'replace' ? existing.results.find((e) => e.name.toLowerCase() === m.name.toLowerCase() && e.starts_at && dayOf(e.starts_at) === m.day) : undefined);
  const plan = meals.map((m) => ({
    name: m.name,
    day: m.day,
    items: m.items.filter((i) => !i.isAlternative).length,
    alternatives: m.items.filter((i) => i.isAlternative).length,
    action: match(m) ? ('replace' as const) : ('create' as const),
  }));
  if (preview || errors.length) return c.json({ ok: errors.length === 0, errors, meals: plan }, errors.length && !preview ? 400 : 200);

  const now = nowIso();
  const statements: D1PreparedStatement[] = [];
  for (const m of meals) {
    const found = match(m);
    const id = found?.id ?? crypto.randomUUID();
    const startsAt = zonedIso(m.day, m.start, tz);
    const endsAt = m.end ? zonedIso(m.day, m.end, tz) : null;
    if (found) {
      statements.push(
        c.env.DB.prepare(`UPDATE meal_services SET location = ?, starts_at = ?, ends_at = ?, menu = ?, ingredients = ?, updated_at = ? WHERE id = ?`).bind(m.place, startsAt, endsAt, m.menu, m.notes, now, id),
        c.env.DB.prepare(`DELETE FROM meal_items WHERE meal_id = ?`).bind(id),
      );
    } else {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO meal_services (id, event_id, name, location, starts_at, ends_at, menu, ingredients, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(id, eventId, m.name, m.place, startsAt, endsAt, m.menu, m.notes, now, now),
      );
    }
    // Items first without links, then "replaces" by name within the meal.
    const ids = m.items.map(() => crypto.randomUUID());
    const byName = new Map<string, string>();
    m.items.forEach((it, i) => {
      if (!byName.has(it.name.toLowerCase())) byName.set(it.name.toLowerCase(), ids[i]!);
    });
    m.items.forEach((it, i) => statements.push(insertItem(c.env.DB, eventId, id, ids[i]!, { ...it, replacesItemId: null }, i, now)));
    m.items.forEach((it, i) => {
      const target = it.replacesName ? byName.get(it.replacesName.toLowerCase()) : undefined;
      if (target && target !== ids[i]) statements.push(c.env.DB.prepare(`UPDATE meal_items SET replaces_item_id = ? WHERE id = ?`).bind(target, ids[i]!));
    });
  }
  statements.push(
    auditStatement(c.env.DB, {
      actor: { type: 'user', id: user.userId },
      action: 'meal.import',
      eventId,
      targetType: 'event',
      targetId: eventId,
      detail: { meals: meals.length, items: meals.reduce((n, m) => n + m.items.length, 0), mode },
    }),
  );
  // Large imports go in chunks; every statement is keyed, so a retry after a failure only repeats work.
  for (let i = 0; i < statements.length; i += 80) await c.env.DB.batch(statements.slice(i, i + 80));
  return c.json({ ok: true, errors: [], meals: plan });
});
