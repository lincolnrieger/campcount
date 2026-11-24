import type { Env } from '../env';
import { normaliseShortCode } from '../../shared/credentials';
import { isSealed, participantKey, seal, shortCodeKey } from '../lib/vault';

/**
 * Encrypt participant data written before encryption existed (migration
 * 0036): names, participant IDs, groups, levels, car registrations, dietary
 * details and typed lanyard codes, and fill in the lookup hashes. Safe to run
 * any number of times: only values that aren't encrypted yet are touched.
 *
 * It must finish before anything new is written, or a person could be added
 * twice (once findable by hash, once not), so `ensureSealed` runs it before
 * the first request each Worker instance handles.
 */
export async function sealExisting(env: Env): Promise<{ people: number; registrations: number; dietary: number; cards: number }> {
  const raw = env.DB; // already-encrypted values may come back decrypted; re-sealing them is harmless
  const counts = { people: 0, registrations: 0, dietary: 0, cards: 0 };

  const people = await raw
    .prepare(`SELECT id, participant_id, participant_key, first_name, last_name FROM people WHERE participant_key IS NULL OR participant_id NOT LIKE 'enc1.%' OR first_name NOT LIKE 'enc1.%' OR (last_name <> '' AND last_name NOT LIKE 'enc1.%')`)
    .all<{ id: string; participant_id: string; participant_key: string | null; first_name: string; last_name: string }>();
  const seenKeys = new Set<string>();
  const stmts: D1PreparedStatement[] = [];
  for (const p of people.results) {
    const id = isSealed(p.participant_id) ? null : p.participant_id;
    let key = p.participant_key;
    if (!key && id !== null) {
      key = await participantKey(env, id);
      // Two old IDs that only differ by case or leading zeros: keep the first findable.
      if (seenKeys.has(key)) key = null;
      else seenKeys.add(key);
    }
    stmts.push(
      raw.prepare(`UPDATE people SET participant_id = ?, participant_key = COALESCE(participant_key, ?), first_name = ?, last_name = ? WHERE id = ?`).bind(
        id === null ? p.participant_id : await seal(env, id),
        key,
        isSealed(p.first_name) ? p.first_name : await seal(env, p.first_name),
        isSealed(p.last_name) || p.last_name === '' ? p.last_name : await seal(env, p.last_name),
        p.id,
      ),
    );
    counts.people++;
  }

  const regs = await raw
    .prepare(
      `SELECT id, level, group_name, car_rego FROM registrations
        WHERE (level <> '' AND level NOT LIKE 'enc1.%') OR (group_name <> '' AND group_name NOT LIKE 'enc1.%') OR (car_rego IS NOT NULL AND car_rego <> '' AND car_rego NOT LIKE 'enc1.%')`,
    )
    .all<{ id: string; level: string; group_name: string; car_rego: string | null }>();
  for (const r of regs.results) {
    const s = async (v: string | null) => (v === null || v === '' || isSealed(v) ? v : seal(env, v));
    stmts.push(raw.prepare(`UPDATE registrations SET level = ?, group_name = ?, car_rego = ? WHERE id = ?`).bind(await s(r.level), await s(r.group_name), await s(r.car_rego), r.id));
    counts.registrations++;
  }

  const diets = await raw
    .prepare(`SELECT id, item, note FROM dietary_entries WHERE (item <> '' AND item NOT LIKE 'enc1.%') OR (note <> '' AND note NOT LIKE 'enc1.%')`)
    .all<{ id: string; item: string; note: string }>();
  for (const d of diets.results) {
    const s = async (v: string) => (v === '' || isSealed(v) ? v : seal(env, v));
    stmts.push(raw.prepare(`UPDATE dietary_entries SET item = ?, note = ? WHERE id = ?`).bind(await s(d.item), await s(d.note), d.id));
    counts.dietary++;
  }

  const cards = await raw
    .prepare(`SELECT id, status, short_code FROM credentials WHERE short_code_key IS NULL OR short_code NOT LIKE 'enc1.%'`)
    .all<{ id: string; status: string; short_code: string }>();
  for (const c of cards.results) {
    if (isSealed(c.short_code)) continue;
    // Retired codes carry a "~xxxxxxxx" suffix so a new card can reuse the number.
    const [code = '', suffix] = c.short_code.split('~');
    const key = await shortCodeKey(env, normaliseShortCode(code));
    stmts.push(
      raw.prepare(`UPDATE credentials SET short_code = ?, short_code_key = ? WHERE id = ?`).bind(
        suffix ? `${await seal(env, code)}~${suffix}` : await seal(env, code),
        suffix ? `${key}~${suffix}` : key,
        c.id,
      ),
    );
    counts.cards++;
  }

  for (let i = 0; i < stmts.length; i += 90) await raw.batch(stmts.slice(i, i + 90));
  return counts;
}

let sealed: Promise<void> | null = null;

/** Run sealExisting once per Worker instance before anything else touches the data. */
export function ensureSealed(env: Env): Promise<void> {
  sealed ??= sealExisting(env).then(
    (r) => {
      if (r.people + r.registrations + r.dietary + r.cards > 0) console.log(JSON.stringify({ level: 'info', event: 'sealed_existing', ...r }));
    },
    (err: unknown) => {
      sealed = null; // try again on the next request
      throw err;
    },
  );
  return sealed;
}
