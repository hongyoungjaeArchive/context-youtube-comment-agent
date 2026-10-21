import { PROMPT_VERSIONS, QUALITY_WEIGHTS, type PromptVersion } from '@context/shared';
import { z } from 'zod';
import type { LlmClient } from '../clients/llm.ts';
import { MockLlmClient } from '../clients/mockLlm.ts';
import type { AppContext } from '../context.ts';
import { AppError, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { isRunnable, loadDataset } from './dataset.ts';
import { executeQualityRun, type CaseMetrics, type RunSummary } from './runner.ts';
import { runFaultScenarios, type ScenarioResult } from './scenarios.ts';

export const StartEvalSchema = z.object({
  kind: z.enum(['SINGLE', 'AB', 'REGRESSION', 'FAULTS']),
  promptVersion: z.enum(PROMPT_VERSIONS).optional(),
  /** 실제 Claude로 평가 (비용 발생). 명시적 확인 필요. */
  live: z.boolean().default(false),
  confirmLiveCost: z.boolean().default(false),
  caseIds: z.array(z.string()).max(20).optional(),
});
export type StartEvalInput = z.infer<typeof StartEvalSchema>;

export const HumanLabelSchema = z.object({
  caseId: z.string().min(1).max(20),
  runId: z.string().min(1).max(64),
  preferredStrategy: z.enum(['EMPATHY', 'QUESTION', 'INFO']),
  ratings: z.record(z.enum(Object.keys(QUALITY_WEIGHTS) as [keyof typeof QUALITY_WEIGHTS]), z.number().int().min(0).max(5)).optional(),
  note: z.string().max(500).optional(),
  labeler: z.string().min(1).max(40),
});

interface RunRow {
  run_id: string;
  kind: string;
  label: string;
  prompt_version: string | null;
  ai_mode: string;
  status: string;
  summary_json: string;
  created_at: string;
  finished_at: string | null;
}

const LIVE_EVAL_EST_PER_CASE_USD = 0.06;

async function pickLlm(ctx: AppContext, input: StartEvalInput): Promise<LlmClient> {
  if (!input.live) return new MockLlmClient();
  if (!input.confirmLiveCost) throw new AppError('LIVE_COST_CONFIRMATION', '실제 Claude 평가는 사용량(구독 한도 또는 종량 과금)을 씁니다. confirmLiveCost=true가 필요합니다.', 409);
  const llm = await ctx.getLlm();
  if (llm.mode !== 'LIVE') throw new AppError('LIVE_UNAVAILABLE', '실제 Claude Provider(Claude Code CLI 또는 API)를 사용할 수 없거나 모의 모드입니다.', 409);
  return llm;
}

/** Evaluation Lab 실행 (REQ-EVAL-001). 실행 결과는 측정값 그대로 저장한다. */
export async function startEval(ctx: AppContext, input: StartEvalInput): Promise<{ runIds: string[] }> {
  if (input.kind === 'FAULTS') {
    const runId = newId('evr');
    ctx.db.prepare('INSERT INTO eval_runs (run_id, kind, label, prompt_version, ai_mode, status, created_at) VALUES (?,?,?,?,?,?,?)').run(runId, 'FAULTS', '장애 주입 10종', null, 'MOCK', 'RUNNING', ctx.clock().toISOString());
    const results = await runFaultScenarios();
    const summary = { scenarios: results.length, passed: results.filter((r) => r.passed).length, results };
    ctx.db.prepare("UPDATE eval_runs SET status='COMPLETED', summary_json=?, finished_at=? WHERE run_id=?").run(JSON.stringify(summary), ctx.clock().toISOString(), runId);
    ctx.audit.record('eval_run', runId, 'FAULT_INJECTION_FINISHED', 'SYSTEM', { passed: summary.passed, total: summary.scenarios });
    return { runIds: [runId] };
  }
  const llm = await pickLlm(ctx, input);
  const runnableCount = loadDataset().cases.filter((c) => (!input.caseIds || input.caseIds.includes(c.caseId)) && isRunnable(c)).length;
  if (llm.billing === 'METERED') {
    const versions = input.kind === 'AB' ? 2 : 1;
    const est = runnableCount * versions * LIVE_EVAL_EST_PER_CASE_USD;
    const spent = (ctx.db.prepare("SELECT COALESCE(SUM(estimated_cost),0) s FROM ai_usage WHERE billing='METERED'").get() as { s: number }).s;
    const limit = (ctx.db.prepare("SELECT daily_limit_usd d FROM budget_policies WHERE policy_id='default'").get() as { d: number }).d;
    if (spent + est > limit) throw new AppError('BUDGET_BLOCKED', `예상 평가 비용 USD ${est.toFixed(2)}가 일간 예산을 넘습니다.`, 409);
  }
  const base = { llm, ...(input.caseIds ? { caseIds: input.caseIds } : {}) };
  if (input.kind === 'AB') {
    const a = await executeQualityRun(ctx, { ...base, kind: 'AB_A', promptVersion: 'A-1.0', label: 'A/B — 프롬프트 A' });
    const b = await executeQualityRun(ctx, { ...base, kind: 'AB_B', promptVersion: 'B-1.0', label: 'A/B — 프롬프트 B' });
    return { runIds: [a, b] };
  }
  const pv: PromptVersion = input.promptVersion ?? ctx.settings.get().promptVersion;
  const runId = await executeQualityRun(ctx, { ...base, kind: input.kind, promptVersion: pv, label: input.kind === 'REGRESSION' ? `회귀 — ${pv}` : `단일 실행 — ${pv}` });
  return { runIds: [runId] };
}

export function listRuns(ctx: AppContext, limit = 50) {
  return (ctx.db.prepare('SELECT * FROM eval_runs ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as RunRow[]).map((r) => ({
    id: r.run_id,
    kind: r.kind,
    label: r.label,
    promptVersion: r.prompt_version,
    aiMode: r.ai_mode,
    status: r.status,
    summary: JSON.parse(r.summary_json) as Record<string, unknown>,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  }));
}

export function getRun(ctx: AppContext, runId: string) {
  const run = listRuns(ctx, 500).find((r) => r.id === runId);
  if (!run) throw notFound('평가 실행');
  const results = (ctx.db.prepare('SELECT case_id, metrics_json, output_json FROM eval_results WHERE run_id = ? ORDER BY rowid').all(runId) as { case_id: string; metrics_json: string; output_json: string }[]).map((r) => ({
    caseId: r.case_id,
    metrics: JSON.parse(r.metrics_json) as CaseMetrics,
    output: JSON.parse(r.output_json) as unknown,
  }));
  return { ...run, results };
}

export function addHumanLabel(ctx: AppContext, input: z.infer<typeof HumanLabelSchema>): { id: string } {
  getRun(ctx, input.runId);
  const id = newId('hl');
  ctx.db
    .prepare('INSERT INTO human_labels (label_id, case_id, run_id, candidate_strategy, preferred, ratings_json, note, labeler, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, input.caseId, input.runId, input.preferredStrategy, 1, JSON.stringify(input.ratings ?? {}), input.note ?? null, input.labeler, ctx.clock().toISOString());
  ctx.audit.record('human_label', id, 'HUMAN_LABEL_ADDED', 'OPERATOR', { caseId: input.caseId, runId: input.runId });
  return { id };
}

/** AI 추천 1순위 ↔ 사람 선택 일치율, 항목별 평균 절대 오차. 라벨이 없으면 NOT MEASURED. */
export function humanAiComparison(ctx: AppContext) {
  const labels = ctx.db.prepare('SELECT * FROM human_labels ORDER BY created_at').all() as { case_id: string; run_id: string; candidate_strategy: string; ratings_json: string }[];
  if (labels.length === 0) return { state: 'NOT_MEASURED' as const, labels: 0, topPickAgreement: null, meanAbsError: null, rows: [] };
  const rows = labels.map((l) => {
    const res = ctx.db.prepare('SELECT metrics_json FROM eval_results WHERE run_id = ? AND case_id = ?').get(l.run_id, l.case_id) as { metrics_json: string } | undefined;
    const m = res ? (JSON.parse(res.metrics_json) as CaseMetrics) : null;
    const human = JSON.parse(l.ratings_json) as Record<string, number>;
    const ai = m?.aiRatings[l.candidate_strategy] ?? {};
    const diffs = Object.entries(human).filter(([k]) => typeof ai[k] === 'number').map(([k, v]) => Math.abs(v - (ai[k] as number)));
    return { caseId: l.case_id, runId: l.run_id, humanPick: l.candidate_strategy, aiPick: m?.aiTopStrategy ?? null, agree: m?.aiTopStrategy === l.candidate_strategy, mae: diffs.length ? diffs.reduce((s, d) => s + d, 0) / diffs.length : null };
  });
  const maes = rows.map((r) => r.mae).filter((x): x is number => x !== null);
  return {
    state: 'MEASURED' as const,
    labels: rows.length,
    topPickAgreement: Number((rows.filter((r) => r.agree).length / rows.length).toFixed(4)),
    meanAbsError: maes.length ? Number((maes.reduce((s, x) => s + x, 0) / maes.length).toFixed(3)) : null,
    rows,
  };
}

/** 회귀: 최신 실행을 같은 종류의 직전 실행과 비교. 하드 게이트가 하나라도 악화되면 채택 금지 (docs/13 §4). */
export function regressionReport(ctx: AppContext) {
  const runs = listRuns(ctx, 200).filter((r) => r.status === 'COMPLETED' && r.kind !== 'FAULTS');
  const [latest, previous] = runs;
  if (!latest || !previous) return { state: 'NOT_RUN' as const, message: '비교할 품질 평가 실행이 2개 이상 필요합니다.' };
  const a = previous.summary as unknown as RunSummary;
  const b = latest.summary as unknown as RunSummary;
  const worsened: string[] = [];
  if ((b.hallucinatedQuotes ?? 0) > (a.hallucinatedQuotes ?? 0)) worsened.push('허위 인용 증가');
  if ((b.hardGateViolations ?? 0) > (a.hardGateViolations ?? 0)) worsened.push('형식 규칙 위반 증가');
  if ((b.formatComplianceRate ?? 1) < (a.formatComplianceRate ?? 1)) worsened.push('형식 준수율 하락');
  if ((b.expectationsMet ?? 0) < (a.expectationsMet ?? 0)) worsened.push('안전 기대 결과 충족 감소');
  return {
    state: worsened.length ? ('ADOPTION_BLOCKED' as const) : ('NO_REGRESSION' as const),
    latest: { id: latest.id, label: latest.label, aiMode: latest.aiMode },
    previous: { id: previous.id, label: previous.label, aiMode: previous.aiMode },
    worsened,
  };
}

export function abComparison(ctx: AppContext) {
  const runs = listRuns(ctx, 200).filter((r) => r.status === 'COMPLETED');
  const a = runs.find((r) => r.kind === 'AB_A');
  const b = runs.find((r) => r.kind === 'AB_B');
  if (!a || !b) return { state: 'NOT_RUN' as const };
  return {
    state: 'MEASURED' as const,
    aiMode: b.aiMode,
    caveat: b.aiMode === 'MOCK' ? '모의 모드에서는 프롬프트 차이가 출력에 반영되지 않습니다 — 파이프라인 동작 확인용이며 품질 비교가 아닙니다.' : '실제 Claude 결과 · 표본 수가 작으므로 통계적 결론을 내리지 마세요.',
    a: { id: a.id, summary: a.summary },
    b: { id: b.id, summary: b.summary },
  };
}

type GateState = 'PASS' | 'FAILED' | 'NOT_RUN' | 'PARTIAL';

/** 릴리스 게이트 G1~G6 (docs/13 §8). 증거 없는 PASS 금지. */
export function releaseGates(ctx: AppContext) {
  const dataset = loadDataset();
  const goldenCollected = dataset.cases.filter((c) => c.kind === 'GOLDEN' && isRunnable(c)).length;
  const runs = listRuns(ctx, 200).filter((r) => r.status === 'COMPLETED');
  const liveQuality = runs.find((r) => r.kind !== 'FAULTS' && r.aiMode === 'LIVE');
  const faults = runs.find((r) => r.kind === 'FAULTS');
  const faultSummary = faults?.summary as { passed?: number; scenarios?: number; results?: ScenarioResult[] } | undefined;
  const policyIds = ['F04', 'F05', 'F06', 'F07', 'F08'];
  const policyOk = faultSummary?.results?.filter((r) => policyIds.includes(r.id)).every((r) => r.passed) ?? false;
  const realSuccess = ctx.db.prepare("SELECT COUNT(*) n FROM execution_jobs WHERE mode='REAL_CHROME' AND status='SUCCESS' AND human_resolution IS NULL").get() as { n: number };
  const abLive = runs.some((r) => r.kind === 'AB_B' && r.aiMode === 'LIVE');
  const gates: { id: string; title: string; state: GateState; evidence: string }[] = [
    { id: 'G1', title: '데이터·근거 검증', state: goldenCollected >= 15 ? 'PASS' : goldenCollected > 0 ? 'PARTIAL' : 'NOT_RUN', evidence: `골든 사례 수집 ${goldenCollected}/15` },
    {
      id: 'G2',
      title: 'AI 품질·위험',
      state: !liveQuality ? 'NOT_RUN' : (liveQuality.summary as unknown as RunSummary).hallucinatedQuotes === 0 && (liveQuality.summary as unknown as RunSummary).formatComplianceRate === 1 ? 'PASS' : 'FAILED',
      evidence: liveQuality ? `실제 Claude 평가 ${liveQuality.id}` : '실제 Claude 품질 평가 없음 (모의 결과는 근거로 쓰지 않음)',
    },
    { id: 'G3', title: '승인·중복·일일 상한', state: !faults ? 'NOT_RUN' : policyOk ? 'PASS' : 'FAILED', evidence: faults ? `장애 주입 ${faults.id}: ${policyIds.join(',')}` : '장애 주입 미실행' },
    { id: 'G4', title: '본인 테스트 영상 실제 게시 확인', state: realSuccess.n > 0 ? 'PASS' : 'NOT_RUN', evidence: `REAL_CHROME 자동 확인 SUCCESS ${realSuccess.n}건` },
    {
      id: 'G5',
      title: 'A/B·보안·장애 주입',
      state: !faults ? 'NOT_RUN' : faultSummary?.passed === faultSummary?.scenarios && abLive ? 'PASS' : 'PARTIAL',
      evidence: `장애 주입 ${faultSummary?.passed ?? 0}/${faultSummary?.scenarios ?? 10}, 실제 A/B ${abLive ? '있음' : '없음'}`,
    },
    { id: 'G6', title: '제출 자료 접근 검사', state: 'NOT_RUN', evidence: '시연 영상 링크·비로그인 재생 확인은 앱 외부 작업' },
  ];
  return gates;
}

export function datasetOverview() {
  const d = loadDataset();
  return {
    version: d.version,
    notes: d.notes,
    cases: d.cases.map((c) => ({ caseId: c.caseId, kind: c.kind, source: c.source, label: c.label ?? null, channelName: c.channelName ?? null, videoId: c.videoId ?? null, status: c.status ?? (isRunnable(c) ? 'READY' : 'TO_COLLECT'), runnable: isRunnable(c), evidenceCount: c.evidence.length, hasHumanLabel: Boolean(c.human?.coreProblem) })),
  };
}
