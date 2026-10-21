import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ALLOWED_CHANNELS, OPERATION_LIMITS } from '@context/shared';
import { MIGRATIONS } from './migrations.ts';

export type Db = Database.Database;

/** 사용자 전용 권한(디렉터리 0700, 파일 0600)으로 디렉터리를 만든다. */
export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

export function openDatabase(file: string): Db {
  if (file !== ':memory:') {
    ensurePrivateDir(path.dirname(file));
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (file !== ':memory:') {
    for (const f of [file, `${file}-wal`, `${file}-shm`]) {
      if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
    }
  }
  migrate(db);
  seed(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(m.version, new Date().toISOString());
    })();
  }
}

function seed(db: Db): void {
  const insertChannel = db.prepare('INSERT OR IGNORE INTO channels (channel_id, name, allowed_for_listing) VALUES (?, ?, 1)');
  for (const c of ALLOWED_CHANNELS) insertChannel.run(c.channelId, c.name);

  db.prepare(
    'INSERT OR IGNORE INTO budget_policies (policy_id, daily_limit_usd, monthly_limit_usd, warning_ratio) VALUES (?, ?, ?, ?)',
  ).run('default', 2, 20, 0.7);

  const insertFact = db.prepare('INSERT OR IGNORE INTO brand_facts (fact_id, text, source, status) VALUES (?, ?, ?, ?)');
  insertFact.run('BF-1', '운명원은 연애 사주(연애운·인연·궁합)를 볼 수 있는 곳이다.', '과제 원문 PDF p.2', 'APPROVED');
  insertFact.run(
    'BF-2',
    '운명원은 연애 사주를 잘 봐주는 곳으로 유명하다.',
    '과제 원문 PDF p.2 (평판 주장 — 독립 근거 미확인)',
    'UNVERIFIED',
  );
  void OPERATION_LIMITS;
}

/** WAL 포함 일관성 있는 온라인 백업 (docs/08 §5). */
export async function backupDatabase(db: Db, destination: string): Promise<void> {
  ensurePrivateDir(path.dirname(destination));
  await db.backup(destination);
  fs.chmodSync(destination, 0o600);
}
