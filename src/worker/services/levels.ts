import type { LevelSetting } from '../../shared/levels';
import { parseLevelSettings } from '../../shared/levels';

/** A camp's levels (Settings › Levels), or the starting pair. */
export async function loadLevels(db: D1Database, eventId: string): Promise<LevelSetting[]> {
  const row = await db.prepare(`SELECT level_settings, youth_levels FROM events WHERE id = ?`).bind(eventId).first<{ level_settings: string | null; youth_levels: string }>();
  return parseLevelSettings(row?.level_settings, row?.youth_levels);
}
