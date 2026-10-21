import { checkCommentStatic, type AnalysisDTO, type PromptVersion } from '@context/shared';
import type { LlmClient } from '../clients/llm.ts';
import { MockLlmClient } from '../clients/mockLlm.ts';
import type { AppContext } from '../context.ts';
import { newId } from '../lib/ids.ts';
import { localDate } from '../lib/time.ts';
import { PRIORITY } from '../orchestrator/queue.ts';
import { getAnalysis, startAnalysis } from '../services/analysis.ts';
import { videoRow } from '../agents/research.ts';
import { isRunnable, loadDataset, type EvalCase } from './dataset.ts';
import { HallucinationInjectingLlm } from './faultLlm.ts';
import { createSandbox, seedVideo } from './sandbox.ts';
import { systemPrompt, untrusted } from '../agents/prompts.ts';

export interface CaseMetrics {
  readonly caseId: string;
  readonly kind: string;
  readonly label: string;
  readonly status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
  readonly candidates: number;
  readonly formatPass: number;
  readonly hallucinatedQuotes: number;
  readonly sceneReferencePass: number;
  readonly qualityPass: number;
  readonly avgScore: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedUsd: number;
  readonly latencyMs: number;
  readonly calls: number;
  readonly errors: number;
  readonly expectation: { readonly defined: boolean; readonly met: boolean | null; readonly detail: string };
  readonly aiTopStrategy: string | null;
  readonly aiRatings: Record<string, Record<string, number | null>>;
}

export interface RunSummary {
  readonly cases: number;
  readonly completed: number;
  readonly skipped: number;
  readonly formatComplianceRate: number | null;
  readonly hallucinatedQuotes: number;
  readonly hardGateViolations: number;
  readonly qualityPassRate: number | null;
  readonly expectationsMet: number;
  readonly expectationsDefined: number;
  readonly totalUsd: number;
  readonly totalTokens: number;
  readonly avgLatencyMs: number | null;
  readonly aiMode: 'LIVE' | 'MOCK';
  readonly promptVersion: string;
  readonly notMeasured: readonly string[];
}

function videoIdFor(c: EvalCase): string {
  return `EV${c.caseId.padEnd(9, 'x')}`.slice(0, 11);
}

/** 한 사례를 격리 환경에서 전체 파이프라인(Context→Marketing→Quality, 필요 시 Fit)으로 실행. */
export async function runCase(c: EvalCase, llm: LlmClient, promptVersion: PromptVersion): Promise<{ metrics: CaseMetrics; output: unknown }> {
  const injected = c.fault === 'HALLUCINATED_QUOTE' ? new HallucinationInjectingLlm(llm) : llm;
  const sbx = createSandbox({ llm: injected });
  const started = Date.now();
  try {
    sbx.ctx.settings.update({ promptVersion });
    const videoId = videoIdFor(c);
    seedVideo(sbx.ctx, { videoId, title: c.title ?? '', evidence: c.evidence });
    const fitJob = sbx.queue.enqueue({ type: 'VIDEO_FIT', subjectId: videoId, priority: PRIORITY.PRESCORE, idempotencyKey: `fit:${videoId}`, payload: { videoId } });
    let analysis = await startAnalysis(sbx.ctx, sbx.queue, videoId);
    await sbx.queue.drain();
    analysis = getAnalysis(sbx.ctx, analysis.id);
    const fit = videoRow(sbx.ctx, videoId)?.fit_json ? JSON.parse(videoRow(sbx.ctx, videoId)!.fit_json!) : null;
    void fitJob;
    const usage = sbx.ctx.db
      .prepare('SELECT COUNT(*) n, COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o, COALESCE(SUM(estimated_cost),0) c, COALESCE(SUM(CASE WHEN error_code IS NOT NULL THEN 1 ELSE 0 END),0) e FROM ai_usage')
      .get() as { n: number; i: number; o: number; c: number; e: number };
    const metrics = computeMetrics(c, analysis, fit, usage, Date.now() - started, sbx.ctx, promptVersion);
    return { metrics, output: { coreProblem: analysis.coreProblem, status: analysis.status, error: analysis.errorMessage, candidates: analysis.candidates.map((x) => ({ strategy: x.strategy, content: x.latestRevision.content, review: x.review && { status: x.review.status, score: x.review.score, hardChecks: x.review.hardChecks } })), fit } };
  } finally {
    await sbx.dispose();
  }
}

function computeMetrics(
  c: EvalCase,
  a: AnalysisDTO,
  fit: { tier?: string | null } | null,
  usage: { n: number; i: number; o: number; c: number; e: number },
  latencyMs: number,
  ctx: AppContext,
  promptVersion: PromptVersion,
): CaseMetrics {
  const cands = a.candidates;
  const reviews = cands.map((x) => x.review).filter((r): r is NonNullable<typeof r> => r !== null);
  const check = (code: string, state: string) => reviews.filter((r) => r.hardChecks.some((h) => h.code === code && h.state === state)).length;
  const scores = reviews.map((r) => r.score).filter((s): s is number => s !== null);
  const top = [...cands].sort((x, y) => (y.review?.score ?? -1) - (x.review?.score ?? -1))[0];
  const expect = (c.expect ?? {}) as Record<string, unknown>;
  const details: string[] = [];
  let met: boolean | null = null;
  if (Object.keys(expect).length) {
    met = true;
    if (expect.check) {
      const ok = check(String(expect.check), String(expect.state)) > 0;
      details.push(`${String(expect.check)}=${String(expect.state)} ${ok ? '확인' : '미확인'}`);
      met &&= ok;
    }
    if (expect.reviewStatus) {
      const ok = reviews.length > 0 && reviews.every((r) => r.status === expect.reviewStatus);
      details.push(`리뷰 상태 ${String(expect.reviewStatus)} ${ok ? '일치' : '불일치'}`);
      met &&= ok;
    }
    if (expect.noPass) {
      const ok = reviews.length > 0 && reviews.every((r) => r.status !== 'PASS');
      details.push(ok ? '승인 가능한(PASS) 후보 없음 — 보류' : 'PASS 후보 존재');
      met &&= ok;
    }
    if (expect.fitTierMax === 'LOW') {
      const ok = fit?.tier === 'LOW' || fit?.tier === null || fit === null;
      details.push(`적합도 tier=${fit?.tier ?? 'N/A'}`);
      met &&= ok;
    }
    if (expect.analysisCompletes) {
      const ok = a.status === 'COMPLETED';
      details.push(`분석 상태 ${a.status}`);
      met &&= ok;
    }
    if (expect.noCommentEvidence) {
      const ok = !a.evidence.some((e) => e.sourceType === 'COMMENT');
      details.push(ok ? '댓글 근거 없음 처리' : '댓글 근거 존재');
      met &&= ok;
    }
    if (expect.noLinkInCandidates) {
      const ok = cands.every((x) => !checkCommentStatic(x.latestRevision.content).violations.some((v) => v.code === 'HAS_LINK'));
      details.push(ok ? '후보에 링크 없음' : '후보에 링크 포함');
      met &&= ok;
    }
    if (expect.noSecretPattern) {
      const ok = cands.every((x) => !/(sk-ant-|AIza|API\s?키)/.test(x.latestRevision.content));
      details.push(ok ? '비밀값/키 언급 없음' : '키 관련 문구 포함');
      met &&= ok;
    }
    if (expect.untrustedWrapped) {
      const prompt = untrusted('evidence', a.evidence.map((e) => e.text));
      const ok = prompt.startsWith('<untrusted_data') && systemPrompt(promptVersion, 'CONTEXT').includes('지시가 아니다');
      details.push(ok ? '외부 데이터 untrusted 태그 격리' : '격리 실패');
      met &&= ok;
    }
  }
  void ctx;
  return {
    caseId: c.caseId,
    kind: c.kind,
    label: c.label ?? c.caseId,
    status: a.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
    candidates: cands.length,
    formatPass: cands.filter((x) => x.latestRevision.staticCheck.ok).length,
    hallucinatedQuotes: check('QUOTE_MATCH', 'BLOCK'),
    sceneReferencePass: check('SCENE_REFERENCE', 'PASS'),
    qualityPass: reviews.filter((r) => r.status === 'PASS').length,
    avgScore: scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : null,
    inputTokens: usage.i,
    outputTokens: usage.o,
    estimatedUsd: Number(usage.c.toFixed(6)),
    latencyMs,
    calls: usage.n,
    errors: usage.e,
    expectation: { defined: met !== null, met, detail: details.join(' · ') },
    aiTopStrategy: top?.strategy ?? null,
    aiRatings: Object.fromEntries(cands.map((x) => [x.strategy, Object.fromEntries(Object.entries(x.review?.ratings ?? {}).map(([k, v]) => [k, v.rating]))])),
  };
}

export function summarize(metrics: readonly CaseMetrics[], skipped: number, aiMode: 'LIVE' | 'MOCK', promptVersion: string): RunSummary {
  const done = metrics.filter((m) => m.status !== 'SKIPPED');
  const totalCands = done.reduce((s, m) => s + m.candidates, 0);
  const goldenDone = done.filter((m) => m.kind === 'GOLDEN').length;
  const notMeasured = [
    ...(goldenDone === 0 ? ['골든 15개 실제 영상 품질(수집·라벨 전)'] : []),
    ...(aiMode === 'MOCK' ? ['실제 모델 품질(모의 모드 결과는 성능 수치가 아님)'] : []),
    '사람 평가 일치율(라벨 입력 시 별도 계산)',
  ];
  return {
    cases: metrics.length + skipped,
    completed: done.filter((m) => m.status === 'COMPLETED').length,
    skipped,
    formatComplianceRate: totalCands ? Number((done.reduce((s, m) => s + m.formatPass, 0) / totalCands).toFixed(4)) : null,
    hallucinatedQuotes: done.filter((m) => m.kind === 'GOLDEN').reduce((s, m) => s + m.hallucinatedQuotes, 0),
    hardGateViolations: done.reduce((s, m) => s + (m.candidates - m.formatPass), 0),
    qualityPassRate: totalCands ? Number((done.reduce((s, m) => s + m.qualityPass, 0) / totalCands).toFixed(4)) : null,
    expectationsMet: done.filter((m) => m.expectation.met === true).length,
    expectationsDefined: done.filter((m) => m.expectation.defined).length,
    totalUsd: Number(done.reduce((s, m) => s + m.estimatedUsd, 0).toFixed(6)),
    totalTokens: done.reduce((s, m) => s + m.inputTokens + m.outputTokens, 0),
    avgLatencyMs: done.length ? Math.round(done.reduce((s, m) => s + m.latencyMs, 0) / done.length) : null,
    aiMode,
    promptVersion,
    notMeasured,
  };
}

export async function executeQualityRun(
  ctx: AppContext,
  input: { kind: 'SINGLE' | 'AB_A' | 'AB_B' | 'REGRESSION'; promptVersion: PromptVersion; llm: LlmClient; label: string; caseIds?: readonly string[] },
): Promise<string> {
  const dataset = loadDataset();
  const runId = newId('evr');
  const now = ctx.clock().toISOString();
  ctx.db.prepare('INSERT INTO eval_runs (run_id, kind, label, prompt_version, ai_mode, status, created_at) VALUES (?,?,?,?,?,?,?)').run(runId, input.kind, input.label, input.promptVersion, input.llm.mode, 'RUNNING', now);
  const selected = dataset.cases.filter((c) => !input.caseIds || input.caseIds.includes(c.caseId));
  const runnable = selected.filter(isRunnable);
  const metrics: CaseMetrics[] = [];
  try {
    for (const c of runnable) {
      const { metrics: m, output } = await runCase(c, input.llm, input.promptVersion);
      metrics.push(m);
      ctx.db.prepare('INSERT INTO eval_results (result_id, run_id, case_id, metrics_json, output_json, created_at) VALUES (?,?,?,?,?,?)').run(newId('evres'), runId, c.caseId, JSON.stringify(m), JSON.stringify(output), ctx.clock().toISOString());
    }
    const summary = summarize(metrics, selected.length - runnable.length, input.llm.mode, input.promptVersion);
    ctx.db.prepare("UPDATE eval_runs SET status='COMPLETED', summary_json=?, finished_at=? WHERE run_id=?").run(JSON.stringify(summary), ctx.clock().toISOString(), runId);
    if (input.llm.mode === 'LIVE') {
      // 격리 환경의 사용량을 본 DB에도 반영 (예산·사용량 추적 일관성). 청구액은 METERED일 때만.
      const total = summary.totalUsd;
      ctx.db
        .prepare(`INSERT INTO ai_usage (usage_id, job_type, model_id, ai_mode, input_tokens, output_tokens, estimated_cost, local_date, created_at, provider, billing) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(newId('use'), 'EVAL', 'eval-aggregate', 'LIVE', metrics.reduce((s, m) => s + m.inputTokens, 0), metrics.reduce((s, m) => s + m.outputTokens, 0), input.llm.billing === 'METERED' ? total : 0, localDate(ctx.clock()), now, input.llm.provider, input.llm.billing);
    }
  } catch (error) {
    ctx.db.prepare("UPDATE eval_runs SET status='FAILED', summary_json=?, finished_at=? WHERE run_id=?").run(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), ctx.clock().toISOString(), runId);
  }
  ctx.audit.record('eval_run', runId, 'EVAL_RUN_FINISHED', 'SYSTEM', { kind: input.kind, aiMode: input.llm.mode });
  return runId;
}

export function defaultEvalLlm(): LlmClient {
  return new MockLlmClient();
}
