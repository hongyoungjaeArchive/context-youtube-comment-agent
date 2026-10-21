import { DEFAULT_MODELS, DEFAULT_PROMPT_VERSION, OPERATION_LIMITS, PROMPT_VERSIONS, isValidChannelId } from '@context/shared';
import { z } from 'zod';
import type { Db } from '../db/database.ts';
import type { Clock } from './time.ts';

/**
 * 모델 단가 카탈로그 (USD / 1M tokens). 비용 "추정"에만 쓰며 실제 청구액이 아니다.
 * 2026-10-06 기준 공개 단가 — 사용자가 설정에서 갱신 가능 (docs/07 §4: 재검증 필요).
 */
export const DEFAULT_PRICE_CATALOG = [
  { modelId: 'claude-haiku-5-5', inputPerMTok: 0.1, outputPerMTok: 0.5, note: '2026-10-06 공개 단가 · REVERIFY' },
  { modelId: 'claude-sonnet-5-5', inputPerMTok: 2, outputPerMTok: 10, note: '2026-10-06 공개 단가 · REVERIFY' },
  { modelId: 'claude-sonnet-5', inputPerMTok: 2, outputPerMTok: 10, note: '대체 모델 · REVERIFY' },
] as const;

export const SettingsSchema = z.object({
  /** CLAUDE_CLI(기본, 구독 사용량) | ANTHROPIC_API(종량 과금, 명시적 확인 필요) | MOCK. */
  llmProvider: z.enum(['CLAUDE_CLI', 'ANTHROPIC_API', 'MOCK']),
  youtubeModePreference: z.enum(['AUTO', 'LIVE', 'SYNTHETIC']),
  lightModel: z.string().min(3).max(64),
  heavyModel: z.string().min(3).max(64),
  fallbackModels: z.array(z.string().min(3).max(64)).max(4),
  promptVersion: z.enum(PROMPT_VERSIONS),
  ownerChannelId: z.string().refine(isValidChannelId, 'Channel ID 형식이 아닙니다.').nullable(),
  dailyMaxComments: z.number().int().min(1).max(OPERATION_LIMITS.dailyMaxComments),
  maxConcurrency: z.number().int().min(1).max(4),
  /** 영상 불러오기 후 상위 15개 예비 적합도(Haiku) 자동 평가 여부. */
  autoPrescore: z.boolean(),
  priceCatalog: z.array(z.object({ modelId: z.string(), inputPerMTok: z.number().min(0), outputPerMTok: z.number().min(0), note: z.string() })),
});
export type AppSettings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  llmProvider: 'CLAUDE_CLI',
  youtubeModePreference: 'AUTO',
  lightModel: DEFAULT_MODELS.light,
  heavyModel: DEFAULT_MODELS.heavy,
  fallbackModels: ['claude-sonnet-5'],
  promptVersion: DEFAULT_PROMPT_VERSION,
  ownerChannelId: null,
  dailyMaxComments: OPERATION_LIMITS.dailyMaxComments,
  maxConcurrency: 2,
  autoPrescore: true,
  priceCatalog: DEFAULT_PRICE_CATALOG.map((p) => ({ ...p })),
};

export class SettingsRepo {
  private readonly db: Db;
  private readonly clock: Clock;
  constructor(db: Db, clock: Clock) {
    this.db = db;
    this.clock = clock;
  }

  get(): AppSettings {
    const rows = this.db.prepare('SELECT key, value_json FROM settings').all() as { key: string; value_json: string }[];
    const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value_json) as unknown]));
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    const parsed = SettingsSchema.safeParse(merged);
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }

  update(patch: Partial<AppSettings>): AppSettings {
    const next = SettingsSchema.parse({ ...this.get(), ...patch });
    const upsert = this.db.prepare(
      'INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
    );
    const now = this.clock().toISOString();
    this.db.transaction(() => {
      for (const key of Object.keys(patch) as (keyof AppSettings)[]) {
        upsert.run(key, JSON.stringify(next[key]), now);
      }
    })();
    return next;
  }
}
