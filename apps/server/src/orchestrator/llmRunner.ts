import type { PromptVersion } from '@context/shared';
import type { z } from 'zod';
import { LlmError, type AgentRole, type LlmClient } from '../clients/llm.ts';
import type { AppContext } from '../context.ts';
import { newId } from '../lib/ids.ts';
import { localDate } from '../lib/time.ts';
import { estimateCost, releaseReservation, reserveBudget } from './budget.ts';
import { cacheGet, cacheKey, cachePut } from './cache.ts';

export class BudgetBlockedError extends Error {}

export interface AgentCall<T> {
  readonly jobId: string | null;
  readonly attemptId: string | null;
  readonly role: Exclude<AgentRole, 'EXECUTION'>;
  readonly tier: 'light' | 'heavy';
  readonly system: string;
  readonly prompt: string;
  readonly schema: z.ZodType<T>;
  readonly maxTokens: number;
  readonly input: unknown;
  readonly promptVersion: PromptVersion;
  /** 결과 캐시용 데이터 해시. null이면 캐시하지 않는다. */
  readonly dataHash: string | null;
}

export interface AgentResult<T> {
  readonly data: T;
  readonly modelId: string;
  readonly aiMode: 'LIVE' | 'MOCK';
  readonly cacheHit: boolean;
}

const ESTIMATED_OUTPUT_RATIO = 0.6;

/**
 * 단일 Claude 호출 경로: 캐시 → 예산 예약 → 호출(모델 대체 포함) → 사용량 기록.
 * 재시도는 하지 않는다 — 재시도/백오프 판단은 JobQueue 한 곳에서만 (중복 재시도 방지).
 */
export async function runAgentCall<T>(ctx: AppContext, call: AgentCall<T>): Promise<AgentResult<T>> {
  const settings = ctx.settings.get();
  const llm = await ctx.getLlm();
  const primary = call.tier === 'light' ? settings.lightModel : settings.heavyModel;
  const models = [primary, ...settings.fallbackModels.filter((m) => m !== primary)];
  const effort = call.tier === 'light' ? 'low' : 'medium';

  const key = call.dataHash ? cacheKey({ kind: call.role, dataHash: call.dataHash, promptVersion: call.promptVersion, modelId: primary, aiMode: llm.mode }) : null;
  if (key) {
    const cached = cacheGet<T>(ctx, key);
    if (cached) {
      recordUsage(ctx, call, primary, llm, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, 0, true, null);
      return { data: call.schema.parse(cached), modelId: primary, aiMode: llm.mode, cacheHit: true };
    }
  }

  let lastError: LlmError | null = null;
  for (const model of models) {
    const estInput = Math.ceil((call.system.length + call.prompt.length) / 2);
    const est = estimateCost(ctx, model, estInput, Math.ceil(call.maxTokens * ESTIMATED_OUTPUT_RATIO));
    const decision = reserveBudget(ctx, call.jobId ?? 'adhoc', est, llm.billing);
    if (!decision.ok) throw new BudgetBlockedError(decision.reason);
    try {
      const res = await llm.generate({ role: call.role, model, system: call.system, prompt: call.prompt, schema: call.schema, maxTokens: call.maxTokens, effort, input: call.input });
      recordUsage(ctx, call, res.modelId, llm, res.usage, res.latencyMs, false, null);
      if (key && model === primary) cachePut(ctx, key, res.data, { dataHash: call.dataHash!, promptVersion: call.promptVersion, modelId: primary });
      return { data: res.data, modelId: res.modelId, aiMode: llm.mode, cacheHit: false };
    } catch (error) {
      const err = error instanceof LlmError ? error : new LlmError('INVALID_OUTPUT', error instanceof Error ? error.message : '알 수 없는 오류');
      recordUsage(ctx, call, model, llm, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, 0, false, err.kind);
      lastError = err;
      // 모델 미지원일 때만 승인된 대체 목록으로 넘어간다 (docs/07 §6).
      if (err.kind !== 'MODEL_UNAVAILABLE') throw err;
      ctx.audit.record('ai_model', model, 'MODEL_FALLBACK', 'SYSTEM', { from: model, role: call.role });
    } finally {
      releaseReservation(ctx, decision.reservationId);
    }
  }
  throw lastError ?? new LlmError('MODEL_UNAVAILABLE', '사용 가능한 모델이 없습니다.');
}

function recordUsage(
  ctx: AppContext,
  call: AgentCall<unknown>,
  modelId: string,
  llm: Pick<LlmClient, 'mode' | 'provider' | 'billing'>,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number },
  latencyMs: number,
  cacheHit: boolean,
  errorCode: string | null,
): void {
  const now = ctx.clock();
  const aiMode = llm.mode;
  const cost = cacheHit ? 0 : estimateCost(ctx, modelId, usage.inputTokens + usage.cacheWriteTokens * 1.25 + usage.cacheReadTokens * 0.1, usage.outputTokens);
  ctx.db
    .prepare(
      `INSERT INTO ai_usage (usage_id, attempt_id, job_type, model_id, ai_mode, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
       estimated_cost, latency_ms, cache_hit, error_code, local_date, created_at, provider, billing, notional_cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      newId('use'),
      call.attemptId,
      call.role,
      modelId,
      aiMode,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens,
      usage.cacheWriteTokens,
      llm.billing === 'METERED' ? cost : 0,
      latencyMs,
      cacheHit ? 1 : 0,
      errorCode,
      localDate(now),
      now.toISOString(),
      llm.provider,
      llm.billing,
      llm.billing === 'SUBSCRIPTION' ? cost : 0,
    );
}
