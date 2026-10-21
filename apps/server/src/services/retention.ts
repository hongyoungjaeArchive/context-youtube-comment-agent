import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../context.ts';

const USAGE_RETENTION_DAYS = 90;

/**
 * 보관 정책 (docs/08 §5): AI 사용량 90일, 오류 스크린샷 30일(artifacts.retention_deadline).
 * 실행 이력·claim·감사 로그는 영상당 1개·중복 방지의 근거이므로 자동 삭제하지 않는다.
 */
export function applyRetention(ctx: AppContext): { usageDeleted: number; artifactsDeleted: number } {
  const now = ctx.clock();
  const usageCutoff = new Date(now.getTime() - USAGE_RETENTION_DAYS * 86400_000).toISOString();
  const usage = ctx.db.prepare('DELETE FROM ai_usage WHERE created_at < ?').run(usageCutoff);
  const root = path.resolve(ctx.config.paths.artifactsDir);
  const expired = ctx.db.prepare('SELECT artifact_id, path FROM artifacts WHERE retention_deadline < ?').all(now.toISOString()) as { artifact_id: string; path: string }[];
  for (const a of expired) {
    const file = path.resolve(a.path);
    if (file.startsWith(root + path.sep)) fs.rmSync(file, { force: true });
    ctx.db.prepare('DELETE FROM artifacts WHERE artifact_id = ?').run(a.artifact_id);
  }
  if (usage.changes || expired.length) ctx.audit.record('system', 'retention', 'RETENTION_APPLIED', 'SYSTEM', { usageDeleted: usage.changes, artifactsDeleted: expired.length });
  return { usageDeleted: usage.changes, artifactsDeleted: expired.length };
}
