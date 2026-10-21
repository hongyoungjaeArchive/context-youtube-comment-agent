import { SCHEMA_VERSION } from '@context/shared';
import type { AppContext } from '../context.ts';
import { sha256, stableStringify } from '../lib/ids.ts';

const DEFAULT_TTL_MS = 7 * 24 * 3600_000;

/** Result Cache 키: (데이터 해시, 프롬프트 버전, 모델, 스키마 버전) — docs/07 §5. */
export function cacheKey(parts: { kind: string; dataHash: string; promptVersion: string; modelId: string; aiMode: string }): string {
  return sha256(stableStringify({ ...parts, schema: SCHEMA_VERSION }));
}

export function cacheGet<T>(ctx: AppContext, key: string): T | null {
  const row = ctx.db.prepare('SELECT result_json, expires_at FROM analysis_cache WHERE cache_key = ?').get(key) as
    | { result_json: string; expires_at: string }
    | undefined;
  if (!row) return null;
  if (row.expires_at < ctx.clock().toISOString()) {
    ctx.db.prepare('DELETE FROM analysis_cache WHERE cache_key = ?').run(key);
    return null;
  }
  ctx.db.prepare('UPDATE analysis_cache SET hit_count = hit_count + 1 WHERE cache_key = ?').run(key);
  return JSON.parse(row.result_json) as T;
}

export function cachePut(ctx: AppContext, key: string, value: unknown, meta: { dataHash: string; promptVersion: string; modelId: string }): void {
  const now = ctx.clock();
  ctx.db
    .prepare(
      `INSERT INTO analysis_cache (cache_key, result_json, data_hash, prompt_version, model_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(cache_key) DO UPDATE SET result_json = excluded.result_json, created_at = excluded.created_at, expires_at = excluded.expires_at`,
    )
    .run(key, JSON.stringify(value), meta.dataHash, meta.promptVersion, meta.modelId, now.toISOString(), new Date(now.getTime() + DEFAULT_TTL_MS).toISOString());
}
