import type { AuditEventDTO } from '@context/shared';
import type { Db } from '../db/database.ts';
import { redactValue } from '../security/redact.ts';
import { newId } from './ids.ts';
import { localDate, type Clock } from './time.ts';

export type Actor = 'OPERATOR' | 'SYSTEM' | 'AI' | 'BROWSER';

export class AuditLog {
  private readonly db: Db;
  private readonly clock: Clock;
  constructor(db: Db, clock: Clock) {
    this.db = db;
    this.clock = clock;
  }

  record(entityType: string, entityId: string, action: string, actor: Actor, metadata: Record<string, unknown> = {}): void {
    const now = this.clock();
    this.db
      .prepare(
        'INSERT INTO audit_events (event_id, entity_type, entity_id, action, actor, created_at, local_date, metadata_redacted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(newId('aud'), entityType, entityId, action, actor, now.toISOString(), localDate(now), JSON.stringify(redactValue(metadata)));
  }

  list(limit = 200, entityType?: string): AuditEventDTO[] {
    const rows = (
      entityType
        ? this.db.prepare('SELECT * FROM audit_events WHERE entity_type = ? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(entityType, limit)
        : this.db.prepare('SELECT * FROM audit_events ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit)
    ) as AuditRow[];
    return rows.map((r) => ({
      id: r.event_id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      actor: r.actor,
      createdAt: r.created_at,
      localDate: r.local_date,
      metadata: JSON.parse(r.metadata_redacted) as Record<string, unknown>,
    }));
  }
}

interface AuditRow {
  event_id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  actor: string;
  created_at: string;
  local_date: string;
  metadata_redacted: string;
}
