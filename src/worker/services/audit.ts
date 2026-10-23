import { nowIso } from '../lib/time';

export type AuditActor =
  | { type: 'user'; id: string }
  | { type: 'station'; id: string }
  | { type: 'system'; id?: null }
  | { type: 'public'; id?: null };

export interface AuditEntry {
  actor: AuditActor;
  action: string;
  eventId?: string | null;
  targetType?: string;
  targetId?: string;
  /** Identifiers and counts only. Never names, dietary or contact details. */
  detail?: Record<string, string | number | boolean | null>;
  /**
   * In a D1 batch, only write the entry if the immediately preceding statement
   * changed a row. Keeps the audit log exact when a guarded update is a no-op.
   */
  onlyIfChanged?: boolean;
}

export function auditStatement(db: D1Database, entry: AuditEntry): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_log (at, actor_type, actor_id, action, event_id, target_type, target_id, detail)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? ${entry.onlyIfChanged ? 'WHERE changes() > 0' : ''}`,
    )
    .bind(
      nowIso(),
      entry.actor.type,
      entry.actor.id ?? null,
      entry.action,
      entry.eventId ?? null,
      entry.targetType ?? null,
      entry.targetId ?? null,
      JSON.stringify(entry.detail ?? {}),
    );
}

export async function audit(db: D1Database, entry: AuditEntry): Promise<void> {
  await auditStatement(db, entry).run();
}
