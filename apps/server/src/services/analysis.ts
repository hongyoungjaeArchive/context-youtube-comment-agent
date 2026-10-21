import {
  checkCommentStatic,
  type AnalysisDTO,
  type ApprovalDTO,
  type CandidateDTO,
  type ContextOutput,
  type FitRating,
  type HardCheckDTO,
  type JobStatus,
  type PromptVersion,
  type ReviewDTO,
  type RevisionDTO,
  type Strategy,
} from '@context/shared';
import { runContextAgent } from '../agents/context.ts';
import { runMarketingAgent } from '../agents/marketing.ts';
import { hardChecks, reviewStatus, runQualityAgent, weightedQualityScore } from '../agents/quality.ts';
import { collectEvidence, isDraftOnly, scoreVideoFit, selectForPrescore, videoRow } from '../agents/research.ts';
import type { AppContext } from '../context.ts';
import { AppError, notFound } from '../lib/errors.ts';
import { newId, sha256 } from '../lib/ids.ts';
import { PRIORITY, type JobQueue, type JobRow } from '../orchestrator/queue.ts';
import { evidenceHash, evidenceStateOf, listEvidence } from './evidence.ts';

interface AnalysisRow {
  analysis_id: string;
  video_id: string;
  status: JobStatus;
  evidence_hash: string;
  evidence_state: AnalysisDTO['evidenceState'];
  core_problem: string | null;
  result_json: string | null;
  model_id: string | null;
  prompt_version: PromptVersion;
  ai_mode: 'LIVE' | 'MOCK';
  error_message: string | null;
  created_at: string;
}

interface RevisionRow {
  revision_id: string;
  candidate_id: string;
  version_no: number;
  content: string;
  content_hash: string;
  edited_by: 'AI' | 'OPERATOR';
  used_evidence_json: string;
  created_at: string;
}

interface ReviewRow {
  review_id: string;
  revision_id: string;
  content_hash: string;
  evidence_snapshot_hash: string;
  status: ReviewDTO['status'];
  score: number | null;
  ratings_json: string;
  hard_checks_json: string;
  risk_flags_json: string;
  improvement: string | null;
  model_id: string;
  prompt_version: string;
  ai_mode: 'LIVE' | 'MOCK';
  created_at: string;
}

interface ApprovalRow {
  approval_id: string;
  revision_id: string;
  review_id: string;
  content_hash: string;
  evidence_snapshot_hash: string;
  source_video_id: string;
  test_target_id: string;
  profile_id: string;
  approved_at: string;
  invalidated_at: string | null;
  invalid_reason: string | null;
}

export function contentHash(content: string): string {
  return sha256(content.normalize('NFC'));
}

function analysisRow(ctx: AppContext, id: string): AnalysisRow {
  const r = ctx.db.prepare('SELECT * FROM video_analyses WHERE analysis_id = ?').get(id) as AnalysisRow | undefined;
  if (!r) throw notFound('분석');
  return r;
}

function setAnalysis(ctx: AppContext, id: string, patch: Partial<Pick<AnalysisRow, 'status' | 'core_problem' | 'result_json' | 'model_id' | 'error_message' | 'evidence_hash' | 'evidence_state' | 'ai_mode'>>): void {
  const sets = Object.keys(patch).map((k) => `${k} = @${k}`);
  ctx.db.prepare(`UPDATE video_analyses SET ${[...sets, 'updated_at = @updated_at'].join(', ')} WHERE analysis_id = @id`).run({ ...patch, updated_at: ctx.clock().toISOString(), id });
}

/** 영상 분석 시작 (POST /api/analyses). 같은 근거·프롬프트 버전의 분석이 있으면 재사용 (새로고침 중복 실행 방지). */
export async function startAnalysis(ctx: AppContext, queue: JobQueue, videoId: string, opts: { force?: boolean } = {}): Promise<AnalysisDTO> {
  const video = videoRow(ctx, videoId);
  if (!video) throw notFound('영상');
  if (video.allowed !== 1 && !isDraftOnly(ctx, video)) throw new AppError('CHANNEL_NOT_ALLOWED', '허용 채널 영상만 분석할 수 있습니다.', 403);
  await collectEvidence(ctx, videoId);
  const evidence = listEvidence(ctx, videoId);
  const hash = evidenceHash(evidence);
  const promptVersion = ctx.settings.get().promptVersion;
  const llm = await ctx.getLlm();
  if (!opts.force) {
    const existing = ctx.db
      .prepare("SELECT analysis_id FROM video_analyses WHERE video_id = ? AND evidence_hash = ? AND prompt_version = ? AND ai_mode = ? AND status NOT IN ('FAILED','BUDGET_BLOCKED','CANCELLED') ORDER BY created_at DESC LIMIT 1")
      .get(videoId, hash, promptVersion, llm.mode) as { analysis_id: string } | undefined;
    if (existing) return getAnalysis(ctx, existing.analysis_id);
  }
  const id = newId('ana');
  const now = ctx.clock().toISOString();
  ctx.db
    .prepare(
      `INSERT INTO video_analyses (analysis_id, video_id, status, evidence_hash, evidence_state, prompt_version, ai_mode, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, videoId, 'QUEUED', hash, evidenceStateOf(evidence), promptVersion, llm.mode, now, now);
  const c = queue.enqueue({ type: 'CONTEXT', subjectId: id, priority: PRIORITY.CONTEXT, idempotencyKey: `context:${id}`, payload: { analysisId: id } });
  const m = queue.enqueue({ type: 'MARKETING', subjectId: id, priority: PRIORITY.GENERATE, idempotencyKey: `marketing:${id}`, dependencies: [c.job.job_id], payload: { analysisId: id } });
  queue.enqueue({ type: 'QUALITY', subjectId: id, priority: PRIORITY.GENERATE, idempotencyKey: `quality:${id}:initial`, dependencies: [m.job.job_id], payload: { analysisId: id } });
  ctx.audit.record('analysis', id, 'ANALYSIS_STARTED', 'OPERATOR', { videoId, evidenceHash: hash, promptVersion, aiMode: llm.mode });
  return getAnalysis(ctx, id);
}

export function enqueuePrescore(ctx: AppContext, queue: JobQueue): number {
  const promptVersion = ctx.settings.get().promptVersion;
  let n = 0;
  for (const videoId of selectForPrescore(ctx)) {
    const r = queue.enqueue({ type: 'VIDEO_FIT', subjectId: videoId, priority: PRIORITY.PRESCORE, idempotencyKey: `fit:${videoId}:${promptVersion}`, payload: { videoId }, maxAttempts: 2 });
    if (r.created) n++;
  }
  return n;
}

/** 다른 영상에 실제로 승인되었거나 게시 시도된 댓글 (영상 고유성 비교용 — 쓰지 않은 초안은 제외). */
function otherVideoComments(ctx: AppContext, videoId: string): string[] {
  const approved = ctx.db
    .prepare(
      `SELECT r.content FROM approvals ap JOIN comment_revisions r ON r.revision_id = ap.revision_id
       WHERE ap.source_video_id != ? ORDER BY ap.approved_at DESC LIMIT 60`,
    )
    .all(videoId) as { content: string }[];
  const posted = ctx.db.prepare('SELECT content FROM execution_jobs WHERE source_video_id != ? ORDER BY created_at DESC LIMIT 40').all(videoId) as { content: string }[];
  return [...new Set([...approved, ...posted].map((r) => r.content))];
}

export function registerAnalysisHandlers(ctx: AppContext, queue: JobQueue): void {
  queue.register('VIDEO_FIT', async (job, attemptId) => {
    const { videoId } = JSON.parse(job.payload_json) as { videoId: string };
    const modelId = await scoreVideoFit(ctx, videoId, job.job_id, attemptId, ctx.settings.get().promptVersion);
    return { status: 'COMPLETED', modelId };
  });

  queue.register('CONTEXT', async (job, attemptId) => {
    const { analysisId } = JSON.parse(job.payload_json) as { analysisId: string };
    const a = analysisRow(ctx, analysisId);
    setAnalysis(ctx, analysisId, { status: 'RUNNING' });
    const video = videoRow(ctx, a.video_id)!;
    const evidence = listEvidence(ctx, a.video_id);
    const hash = evidenceHash(evidence);
    const res = await runContextAgent(ctx, { jobId: job.job_id, attemptId, title: video.title, evidence, evidenceHash: hash, promptVersion: a.prompt_version });
    setAnalysis(ctx, analysisId, {
      core_problem: res.data.core_problem,
      result_json: JSON.stringify({ context: res.data }),
      model_id: res.modelId,
      evidence_hash: hash,
      evidence_state: evidenceStateOf(evidence),
      ai_mode: res.aiMode,
    });
    return { status: 'COMPLETED', modelId: res.modelId };
  });

  queue.register('MARKETING', async (job, attemptId) => {
    const { analysisId } = JSON.parse(job.payload_json) as { analysisId: string };
    const a = analysisRow(ctx, analysisId);
    const existing = ctx.db.prepare('SELECT COUNT(*) n FROM comment_candidates WHERE analysis_id = ?').get(analysisId) as { n: number };
    if (existing.n > 0) return { status: 'COMPLETED' };
    const context = (JSON.parse(a.result_json ?? '{}') as { context?: ContextOutput }).context;
    if (!context) throw new AppError('CONTEXT_MISSING', '맥락 분석 결과가 없습니다.');
    const evidence = listEvidence(ctx, a.video_id);
    const res = await runMarketingAgent(ctx, {
      jobId: job.job_id,
      attemptId,
      context,
      evidence,
      evidenceHash: evidenceHash(evidence),
      promptVersion: a.prompt_version,
      otherComments: otherVideoComments(ctx, a.video_id),
    });
    const now = ctx.clock().toISOString();
    ctx.db.transaction(() => {
      for (const c of res.data.candidates) {
        const candidateId = newId('cand');
        ctx.db
          .prepare('INSERT INTO comment_candidates (candidate_id, analysis_id, strategy, rationale, no_fit, created_at) VALUES (?,?,?,?,?,?)')
          .run(candidateId, analysisId, c.strategy, c.rationale, c.no_fit ? 1 : 0, now);
        ctx.db
          .prepare('INSERT INTO comment_revisions (revision_id, candidate_id, version_no, content, content_hash, edited_by, used_evidence_json, created_at) VALUES (?,?,?,?,?,?,?,?)')
          .run(newId('rev'), candidateId, 1, c.content, contentHash(c.content), 'AI', JSON.stringify(c.used_evidence_ids), now);
      }
      const prev = JSON.parse(a.result_json ?? '{}') as Record<string, unknown>;
      setAnalysis(ctx, analysisId, { result_json: JSON.stringify({ ...prev, marketing: { strategy_summary: res.data.strategy_summary, brand_facts_used: res.data.brand_facts_used } }) });
    })();
    return { status: 'COMPLETED', modelId: res.modelId };
  });

  queue.register('QUALITY', async (job, attemptId) => {
    const payload = JSON.parse(job.payload_json) as { analysisId: string; revisionIds?: string[]; revalidate?: boolean };
    const a = analysisRow(ctx, payload.analysisId);
    const revisions = payload.revisionIds?.length ? payload.revisionIds.map((id) => revisionRow(ctx, id)) : latestRevisions(ctx, payload.analysisId);
    const evidence = listEvidence(ctx, a.video_id);
    const hash = evidenceHash(evidence);
    const forReview = revisions.map((r) => ({ id: r.revision_id, content: r.content, usedEvidenceIds: JSON.parse(r.used_evidence_json) as string[] }));
    const res = await runQualityAgent(ctx, { jobId: job.job_id, attemptId, revisions: forReview, evidence, evidenceHash: hash, promptVersion: a.prompt_version, coreProblem: a.core_problem });
    const others = otherVideoComments(ctx, a.video_id);
    const now = ctx.clock().toISOString();
    let passCount = 0;
    ctx.db.transaction(() => {
      for (const rev of forReview) {
        const modelReview = res.data.reviews.find((x) => x.candidate_ref === rev.id);
        const ratings: Record<string, FitRating> = modelReview?.ratings ?? {};
        const checks: HardCheckDTO[] = hardChecks(rev, evidence, others);
        if (!modelReview) checks.push({ code: 'MODEL_REVIEW', state: 'BLOCK', message: '모델 평가 결과에 이 revision이 없습니다.' });
        const score = modelReview ? weightedQualityScore(ratings) : null;
        const status = reviewStatus(score, checks);
        if (status === 'PASS') passCount++;
        ctx.db
          .prepare(
            `INSERT INTO quality_reviews (review_id, revision_id, content_hash, evidence_snapshot_hash, status, score, ratings_json, hard_checks_json, risk_flags_json, improvement, model_id, prompt_version, ai_mode, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(newId('qr'), rev.id, contentHash(rev.content), hash, status, score, JSON.stringify(ratings), JSON.stringify(checks), JSON.stringify(modelReview?.risk_flags ?? []), modelReview?.improvement ?? null, res.modelId, a.prompt_version, res.aiMode, now);
      }
      if (!payload.revalidate) setAnalysis(ctx, payload.analysisId, { status: 'COMPLETED' });
    })();
    ctx.audit.record('analysis', payload.analysisId, payload.revalidate ? 'REVALIDATED' : 'QUALITY_REVIEWED', 'AI', { revisions: forReview.length, pass: passCount, aiMode: res.aiMode });
    return { status: 'COMPLETED', modelId: res.modelId };
  });

  queue.onTerminalFailure((job: JobRow, status, message) => {
    if (!['CONTEXT', 'MARKETING', 'QUALITY'].includes(job.job_type)) return;
    const payload = JSON.parse(job.payload_json) as { analysisId?: string; revalidate?: boolean };
    if (!payload.analysisId) return;
    if (payload.revalidate) {
      setAnalysis(ctx, payload.analysisId, { error_message: `재검증 실패: ${message}` });
      return;
    }
    // 선행 작업 실패로 연쇄 실패한 경우 최초 원인(예: BUDGET_BLOCKED)을 덮어쓰지 않는다.
    const current = analysisRow(ctx, payload.analysisId).status;
    if (['FAILED', 'BUDGET_BLOCKED', 'NEEDS_REVIEW', 'CANCELLED'].includes(current)) return;
    setAnalysis(ctx, payload.analysisId, { status, error_message: message });
  });
}

function revisionRow(ctx: AppContext, id: string): RevisionRow {
  const r = ctx.db.prepare('SELECT * FROM comment_revisions WHERE revision_id = ?').get(id) as RevisionRow | undefined;
  if (!r) throw notFound('댓글 버전');
  return r;
}

function latestRevisions(ctx: AppContext, analysisId: string): RevisionRow[] {
  return ctx.db
    .prepare(
      `SELECT r.* FROM comment_revisions r JOIN comment_candidates c ON c.candidate_id = r.candidate_id
       WHERE c.analysis_id = ? AND r.version_no = (SELECT MAX(version_no) FROM comment_revisions WHERE candidate_id = r.candidate_id)`,
    )
    .all(analysisId) as RevisionRow[];
}

export function latestRevisionOf(ctx: AppContext, candidateId: string): RevisionRow | null {
  return (ctx.db.prepare('SELECT * FROM comment_revisions WHERE candidate_id = ? ORDER BY version_no DESC LIMIT 1').get(candidateId) as RevisionRow | undefined) ?? null;
}

function toRevisionDTO(r: RevisionRow): RevisionDTO {
  return {
    id: r.revision_id,
    candidateId: r.candidate_id,
    versionNo: r.version_no,
    content: r.content,
    contentHash: r.content_hash,
    editedBy: r.edited_by,
    usedEvidenceIds: JSON.parse(r.used_evidence_json) as string[],
    createdAt: r.created_at,
    staticCheck: checkCommentStatic(r.content),
  };
}

export function toReviewDTO(r: ReviewRow, currentEvidenceHash: string): ReviewDTO {
  return {
    id: r.review_id,
    revisionId: r.revision_id,
    status: r.status,
    score: r.score,
    ratings: JSON.parse(r.ratings_json) as Record<string, FitRating>,
    hardChecks: JSON.parse(r.hard_checks_json) as HardCheckDTO[],
    riskFlags: JSON.parse(r.risk_flags_json) as string[],
    improvement: r.improvement,
    evidenceSnapshotHash: r.evidence_snapshot_hash,
    modelId: r.model_id,
    promptVersion: r.prompt_version,
    mode: r.ai_mode,
    createdAt: r.created_at,
    stale: r.evidence_snapshot_hash !== currentEvidenceHash,
  };
}

export function reviewRow(ctx: AppContext, reviewId: string): ReviewRow | null {
  return (ctx.db.prepare('SELECT * FROM quality_reviews WHERE review_id = ?').get(reviewId) as ReviewRow | undefined) ?? null;
}

export function toApprovalDTO(r: ApprovalRow): ApprovalDTO {
  return {
    id: r.approval_id,
    revisionId: r.revision_id,
    reviewId: r.review_id,
    contentHash: r.content_hash,
    testTargetId: r.test_target_id,
    profileId: r.profile_id,
    approvedAt: r.approved_at,
    invalidatedAt: r.invalidated_at,
    invalidReason: r.invalid_reason,
    valid: r.invalidated_at === null,
  };
}

export function getAnalysis(ctx: AppContext, id: string): AnalysisDTO {
  const a = analysisRow(ctx, id);
  const evidence = listEvidence(ctx, a.video_id);
  const currentHash = evidenceHash(evidence);
  const result = JSON.parse(a.result_json ?? '{}') as { context?: ContextOutput };
  const candidates = ctx.db.prepare('SELECT * FROM comment_candidates WHERE analysis_id = ? ORDER BY strategy').all(id) as {
    candidate_id: string;
    strategy: Strategy;
    rationale: string;
    no_fit: number;
  }[];
  const order: Strategy[] = ['EMPATHY', 'QUESTION', 'INFO'];
  const candidateDTOs: CandidateDTO[] = candidates
    .sort((x, y) => order.indexOf(x.strategy) - order.indexOf(y.strategy))
    .map((c) => {
      const latest = latestRevisionOf(ctx, c.candidate_id)!;
      const review = ctx.db.prepare('SELECT * FROM quality_reviews WHERE revision_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(latest.revision_id) as ReviewRow | undefined;
      // 후보의 모든 revision 중 가장 최근 승인 — 편집으로 무효화된 직전 승인도 사유와 함께 보여준다.
      const approval = ctx.db
        .prepare('SELECT a.* FROM approvals a JOIN comment_revisions r ON r.revision_id = a.revision_id WHERE r.candidate_id = ? ORDER BY a.approved_at DESC, a.rowid DESC LIMIT 1')
        .get(c.candidate_id) as ApprovalRow | undefined;
      const count = ctx.db.prepare('SELECT COUNT(*) n FROM comment_revisions WHERE candidate_id = ?').get(c.candidate_id) as { n: number };
      return {
        id: c.candidate_id,
        analysisId: id,
        strategy: c.strategy,
        rationale: c.rationale,
        noFit: c.no_fit === 1,
        latestRevision: toRevisionDTO(latest),
        revisionCount: count.n,
        review: review ? toReviewDTO(review, currentHash) : null,
        approval: approval ? toApprovalDTO(approval) : null,
      };
    });
  return {
    id: a.analysis_id,
    videoId: a.video_id,
    status: a.status,
    evidenceState: evidenceStateOf(evidence),
    evidenceHash: currentHash,
    coreProblem: a.core_problem,
    evidenceIds: result.context?.evidence_ids ?? [],
    audienceInsights: result.context?.audience_insights ?? [],
    limitations: result.context?.limitations ?? [],
    requestedChecks: result.context?.requested_checks ?? [],
    modelId: a.model_id,
    promptVersion: a.prompt_version,
    mode: a.ai_mode,
    errorMessage: a.error_message,
    createdAt: a.created_at,
    stale: a.evidence_hash !== currentHash,
    candidates: candidateDTOs,
    evidence,
  };
}

/**
 * 운영자 편집 → 새 불변 revision (REQ-CMT-004).
 * 이전 revision에 결속된 승인은 즉시 무효화되고, 새 revision은 평가가 없으므로 재검증 전에는 승인 불가.
 */
export function createRevision(ctx: AppContext, candidateId: string, content: string): RevisionDTO {
  const latest = latestRevisionOf(ctx, candidateId);
  if (!latest) throw notFound('댓글 후보');
  const trimmed = content.trim();
  if (Array.from(trimmed).length > 500) throw new AppError('CONTENT_TOO_LONG', '댓글이 너무 깁니다.');
  const hash = contentHash(trimmed);
  if (hash === latest.content_hash) return toRevisionDTO(latest);
  const id = newId('rev');
  ctx.db.transaction(() => {
    ctx.db
      .prepare('INSERT INTO comment_revisions (revision_id, candidate_id, version_no, content, content_hash, edited_by, used_evidence_json, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, candidateId, latest.version_no + 1, trimmed, hash, 'OPERATOR', latest.used_evidence_json, ctx.clock().toISOString());
    const res = ctx.db
      .prepare(
        `UPDATE approvals SET invalidated_at = ?, invalid_reason = '댓글 수정으로 승인 무효화'
         WHERE invalidated_at IS NULL AND revision_id IN (SELECT revision_id FROM comment_revisions WHERE candidate_id = ?)`,
      )
      .run(ctx.clock().toISOString(), candidateId);
    ctx.audit.record('comment_revision', id, 'REVISION_CREATED', 'OPERATOR', { candidateId, versionNo: latest.version_no + 1, invalidatedApprovals: res.changes });
  })();
  return toRevisionDTO(revisionRow(ctx, id));
}

/** [AI 재검증]: 편집된 revision만 평가 (P0). */
export function requestRevalidation(ctx: AppContext, queue: JobQueue, revisionId: string): { jobId: string; created: boolean } {
  const rev = revisionRow(ctx, revisionId);
  const latest = latestRevisionOf(ctx, rev.candidate_id)!;
  if (latest.revision_id !== revisionId) throw new AppError('STALE_REVISION', '최신 버전만 재검증할 수 있습니다.', 409);
  const cand = ctx.db.prepare('SELECT analysis_id FROM comment_candidates WHERE candidate_id = ?').get(rev.candidate_id) as { analysis_id: string };
  const a = analysisRow(ctx, cand.analysis_id);
  const hash = evidenceHash(listEvidence(ctx, a.video_id));
  const r = queue.enqueue({
    type: 'QUALITY',
    subjectId: a.analysis_id,
    priority: PRIORITY.REVALIDATE,
    idempotencyKey: `revalidate:${revisionId}:${hash}:${a.prompt_version}`,
    payload: { analysisId: a.analysis_id, revisionIds: [revisionId], revalidate: true },
  });
  ctx.audit.record('comment_revision', revisionId, 'REVALIDATION_REQUESTED', 'OPERATOR', { jobId: r.job.job_id });
  return { jobId: r.job.job_id, created: r.created };
}

export type { ApprovalRow, ReviewRow, RevisionRow };
export function getRevisionRow(ctx: AppContext, id: string): RevisionRow {
  return revisionRow(ctx, id);
}
export function getAnalysisRow(ctx: AppContext, id: string): AnalysisRow {
  return analysisRow(ctx, id);
}
