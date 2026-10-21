import { checkCommentStatic, type ApprovalDTO } from '@context/shared';
import { isDraftOnly, videoRow } from '../agents/research.ts';
import type { AppContext } from '../context.ts';
import { AppError, notFound, policyBlocked } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { getRevisionRow, latestRevisionOf, reviewRow, toApprovalDTO, type ApprovalRow } from '../services/analysis.ts';
import { evidenceHash, listEvidence } from '../services/evidence.ts';
import { profileRow } from './profiles.ts';
import { targetRow } from './targets.ts';

/** revision → 소속 분석의 원본 영상 ID. */
export function sourceVideoOfRevision(ctx: AppContext, revisionId: string): string {
  const r = ctx.db
    .prepare(
      `SELECT a.video_id FROM comment_revisions r JOIN comment_candidates c ON c.candidate_id = r.candidate_id
       JOIN video_analyses a ON a.analysis_id = c.analysis_id WHERE r.revision_id = ?`,
    )
    .get(revisionId) as { video_id: string } | undefined;
  if (!r) throw notFound('댓글 버전');
  return r.video_id;
}

/**
 * 승인 게이트 — 승인이 결속되는 대상이 모두 현재 상태와 일치해야 한다 (docs/05 §6, REQ-CMT-004).
 * 반환하는 사유 코드는 실행 Preflight에서도 그대로 재검사한다.
 */
export function assertApprovable(ctx: AppContext, revisionId: string, reviewId: string): { contentHash: string; evidenceHash: string; sourceVideoId: string } {
  const revision = getRevisionRow(ctx, revisionId);
  const latest = latestRevisionOf(ctx, revision.candidate_id);
  if (!latest || latest.revision_id !== revisionId) throw policyBlocked('STALE_REVISION', '최신 댓글 버전이 아닙니다. 다시 확인해 주세요.');
  const review = reviewRow(ctx, reviewId);
  if (!review || review.revision_id !== revisionId) throw policyBlocked('REVIEW_MISMATCH', '이 댓글 버전에 대한 품질 평가가 아닙니다. 재검증해 주세요.');
  if (review.content_hash !== revision.content_hash) throw policyBlocked('HASH_MISMATCH', '평가된 문장과 현재 문장이 다릅니다.');
  const sourceVideoId = sourceVideoOfRevision(ctx, revisionId);
  const source = videoRow(ctx, sourceVideoId);
  if (source && isDraftOnly(ctx, source)) throw policyBlocked('TREND_DRAFT_ONLY', '지정 채널 밖 뜨기 직전 영상은 초안까지만 만들 수 있습니다 (승인·게시 불가).');
  const currentHash = evidenceHash(listEvidence(ctx, sourceVideoId));
  if (review.evidence_snapshot_hash !== currentHash) throw policyBlocked('EVIDENCE_CHANGED', '근거가 바뀌어 기존 평가가 무효입니다. 재검증해 주세요.');
  if (review.status !== 'PASS') throw policyBlocked('QUALITY_NOT_PASSED', `품질 평가가 PASS가 아닙니다 (${review.status}).`);
  if (!checkCommentStatic(revision.content).ok) throw policyBlocked('STATIC_RULES', '길이·링크·해시태그·후기 규칙 위반이 있습니다.');
  return { contentHash: revision.content_hash, evidenceHash: currentHash, sourceVideoId };
}

export function approve(ctx: AppContext, input: { revisionId: string; reviewId: string; testTargetId: string; profileId: string }): ApprovalDTO {
  const bound = assertApprovable(ctx, input.revisionId, input.reviewId);
  const target = targetRow(ctx, input.testTargetId);
  if (!target.ownership_verified_at) throw policyBlocked('TARGET_NOT_VERIFIED', '본인 소유가 확인된 테스트 영상만 승인할 수 있습니다.');
  profileRow(ctx, input.profileId);
  const id = newId('apr');
  const now = ctx.clock().toISOString();
  ctx.db.transaction(() => {
    ctx.db
      .prepare("UPDATE approvals SET invalidated_at = ?, invalid_reason = '새 승인으로 대체' WHERE revision_id = ? AND invalidated_at IS NULL")
      .run(now, input.revisionId);
    ctx.db
      .prepare(
        `INSERT INTO approvals (approval_id, revision_id, review_id, content_hash, evidence_snapshot_hash, source_video_id, test_target_id, profile_id, approved_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, input.revisionId, input.reviewId, bound.contentHash, bound.evidenceHash, bound.sourceVideoId, input.testTargetId, input.profileId, now);
  })();
  ctx.audit.record('approval', id, 'APPROVED', 'OPERATOR', { revisionId: input.revisionId, contentHash: bound.contentHash, testTargetId: input.testTargetId, profileId: input.profileId });
  return toApprovalDTO(approvalRow(ctx, id));
}

export function approvalRow(ctx: AppContext, id: string): ApprovalRow {
  const r = ctx.db.prepare('SELECT * FROM approvals WHERE approval_id = ?').get(id) as ApprovalRow | undefined;
  if (!r) throw notFound('승인');
  return r;
}

export function revokeApproval(ctx: AppContext, id: string): ApprovalDTO {
  const r = approvalRow(ctx, id);
  if (r.invalidated_at) throw new AppError('ALREADY_INVALID', '이미 무효화된 승인입니다.', 409);
  ctx.db.prepare("UPDATE approvals SET invalidated_at = ?, invalid_reason = '운영자 승인 철회' WHERE approval_id = ?").run(ctx.clock().toISOString(), id);
  ctx.audit.record('approval', id, 'APPROVAL_REVOKED', 'OPERATOR', {});
  return toApprovalDTO(approvalRow(ctx, id));
}
