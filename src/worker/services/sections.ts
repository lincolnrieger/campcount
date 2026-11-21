import type { SectionSetting } from '../../shared/sections';
import { parseSectionSettings } from '../../shared/sections';

/** A camp's sections (Settings › Sections), or the built-ins. */
export async function loadSections(db: D1Database, eventId: string): Promise<SectionSetting[]> {
  const row = await db.prepare(`SELECT section_settings, youth_sections FROM events WHERE id = ?`).bind(eventId).first<{ section_settings: string | null; youth_sections: string }>();
  return parseSectionSettings(row?.section_settings, row?.youth_sections);
}
