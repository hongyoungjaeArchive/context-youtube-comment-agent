import type { UsageBucket, UsageSummaryDTO } from '@context/shared';
import type { AppContext } from '../context.ts';
import { newId } from '../lib/ids.ts';
import { localDate, localMonth } from '../lib/time.ts';

export interface BudgetPolicy {
  readonly dailyLimitUsd: number;
  readonly monthlyLimitUsd: number;
  readonly warningRatio: number;
}

export function getBudgetPolicy(ctx: AppContext): BudgetPolicy {
  const row = ctx.db.prepare("SELECT * FROM budget_policies WHERE policy_id = 'default'").get() as
    | { daily_limit_usd: number; monthly_limit_usd: number; warning_ratio: number }
    | undefined;
  return { dailyLimitUsd: row?.daily_limit_usd ?? 2, monthlyLimitUsd: row?.monthly_limit_usd ?? 20, warningRatio: row?.warning_ratio ?? 0.7 };
}

export function updateBudgetPolicy(ctx: AppContext, policy: BudgetPolicy): BudgetPolicy {
  if (policy.dailyLimitUsd < 0 || policy.monthlyLimitUsd < 0 || policy.warningRatio <= 0 || policy.warningRatio > 1) {
    throw new Error('예산 값이 올바르지 않습니다.');
  }
  ctx.db
    .prepare("UPDATE budget_policies SET daily_limit_usd = ?, monthly_limit_usd = ?, warning_ratio = ? WHERE policy_id = 'default'")
    .run(policy.dailyLimitUsd, policy.monthlyLimitUsd, policy.warningRatio);
  return policy;
}

export function priceFor(ctx: AppContext, modelId: string): { input: number; output: number } {
  const entry = ctx.settings.get().priceCatalog.find((p) => modelId.startsWith(p.modelId));
  // 단가 미등록 모델은 보수적으로 Sonnet 단가로 추정한다.
  return entry ? { input: entry.inputPerMTok, output: entry.outputPerMTok } : { input: 2, output: 10 };
}

export function estimateCost(ctx: AppContext, modelId: string, inputTokens: number, outputTokens: number): number {
  const p = priceFor(ctx, modelId);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

function spent(ctx: AppContext, where: string, arg: string): number {
  // 예산은 실제 청구가 생기는 종량 과금(METERED)만 집계한다. 구독(CLI)·모의는 0원.
  const row = ctx.db.prepare(`SELECT COALESCE(SUM(estimated_cost),0) s FROM ai_usage WHERE billing = 'METERED' AND ${where}`).get(arg) as { s: number };
  return row.s;
}

function reserved(ctx: AppContext, day: string): number {
  const row = ctx.db.prepare('SELECT COALESCE(SUM(amount_usd),0) s FROM budget_reservations WHERE released_at IS NULL AND local_date = ?').get(day) as { s: number };
  return row.s;
}

export type BudgetDecision = { readonly ok: true; readonly reservationId: string } | { readonly ok: false; readonly reason: string };

/** 호출 전 예상 비용을 예약한다. 일간/월간 한도를 넘으면 신규 AI 작업을 차단 (docs/07 §4). */
export function reserveBudget(ctx: AppContext, jobId: string, estimatedUsd: number, billing: 'METERED' | 'SUBSCRIPTION' | 'NONE'): BudgetDecision {
  const metered = billing === 'METERED';
  const now = ctx.clock();
  const day = localDate(now);
  const month = localMonth(now);
  const policy = getBudgetPolicy(ctx);
  return ctx.db.transaction((): BudgetDecision => {
    if (metered) {
      const daySpent = spent(ctx, 'local_date = ?', day) + reserved(ctx, day);
      if (daySpent + estimatedUsd > policy.dailyLimitUsd) {
        return { ok: false, reason: `일간 예산 한도 USD ${policy.dailyLimitUsd} 초과 예상 (사용+예약 ${daySpent.toFixed(4)})` };
      }
      const monthSpent = spent(ctx, "substr(local_date,1,7) = ?", month);
      if (monthSpent + estimatedUsd > policy.monthlyLimitUsd) {
        return { ok: false, reason: `월간 예산 한도 USD ${policy.monthlyLimitUsd} 초과 예상` };
      }
    }
    const reservationId = newId('bud');
    ctx.db
      .prepare('INSERT INTO budget_reservations (reservation_id, job_id, amount_usd, local_date) VALUES (?, ?, ?, ?)')
      .run(reservationId, jobId, metered ? estimatedUsd : 0, day);
    return { ok: true, reservationId };
  })();
}

export function releaseReservation(ctx: AppContext, reservationId: string): void {
  ctx.db.prepare('UPDATE budget_reservations SET released_at = ? WHERE reservation_id = ?').run(ctx.clock().toISOString(), reservationId);
}

function bucket(ctx: AppContext, where: string, args: unknown[]): UsageBucket {
  const r = ctx.db
    .prepare(
      `SELECT COUNT(*) calls, COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o, COALESCE(SUM(cache_read_tokens),0) cr,
       COALESCE(SUM(estimated_cost),0) c, COALESCE(SUM(notional_cost),0) n, COALESCE(SUM(cache_hit),0) h, COALESCE(SUM(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END),0) e
       FROM ai_usage WHERE ${where}`,
    )
    .get(...args) as { calls: number; i: number; o: number; cr: number; c: number; n: number; h: number; e: number };
  return { calls: r.calls, inputTokens: r.i, outputTokens: r.o, cacheReadTokens: r.cr, estimatedUsd: Number(r.c.toFixed(6)), notionalUsd: Number(r.n.toFixed(6)), cacheHits: r.h, errors: r.e };
}

export function usageSummary(ctx: AppContext): UsageSummaryDTO {
  const now = ctx.clock();
  const day = localDate(now);
  const month = localMonth(now);
  const policy = getBudgetPolicy(ctx);
  const today = bucket(ctx, 'local_date = ?', [day]);
  const monthB = bucket(ctx, 'substr(local_date,1,7) = ?', [month]);
  const liveToday = spent(ctx, 'local_date = ?', day);
  const liveMonth = spent(ctx, 'substr(local_date,1,7) = ?', month);
  const ratio = Math.max(liveToday / (policy.dailyLimitUsd || 1), liveMonth / (policy.monthlyLimitUsd || 1));
  const models = ctx.db.prepare('SELECT DISTINCT model_id FROM ai_usage WHERE substr(local_date,1,7) = ?').all(month) as { model_id: string }[];
  return {
    today,
    month: monthB,
    budget: { ...policy, state: ratio >= 1 ? 'BLOCKED' : ratio >= policy.warningRatio ? 'WARNING' : 'OK' },
    byModel: models.map((m) => ({ modelId: m.model_id, ...bucket(ctx, 'model_id = ? AND substr(local_date,1,7) = ?', [m.model_id, month]) })),
    priceCatalog: ctx.settings.get().priceCatalog,
  };
}
