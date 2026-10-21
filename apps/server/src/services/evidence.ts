import type { EvidenceDTO, EvidenceSourceType, EvidenceState, TrustGrade } from '@context/shared';
import type { AppContext } from '../context.ts';
import { newId, sha256, stableStringify } from '../lib/ids.ts';
import { AppError, notFound } from '../lib/errors.ts';

interface EvidenceRow {
  evidence_id: string;
  video_id: string;
  source_type: EvidenceSourceType;
  original_excerpt: string;
  timestamp_label: string | null;
  verified_by: string;
  trust_grade: TrustGrade;
  created_at: string;
}

const MAX_EXCERPT = 600;
const TIMESTAMP_PATTERN = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;

export function toEvidenceDTO(r: EvidenceRow): EvidenceDTO {
  return {
    id: r.evidence_id,
    videoId: r.video_id,
    sourceType: r.source_type,
    text: r.original_excerpt,
    timestamp: r.timestamp_label,
    trustGrade: r.trust_grade,
    verifiedBy: r.verified_by,
    createdAt: r.created_at,
  };
}

export function listEvidence(ctx: AppContext, videoId: string): EvidenceDTO[] {
  const rows = ctx.db
    .prepare("SELECT * FROM evidence WHERE video_id = ? AND removed_at IS NULL ORDER BY trust_grade ASC, created_at ASC, rowid ASC")
    .all(videoId) as EvidenceRow[];
  return rows.map(toEvidenceDTO);
}

/** 활성 근거 집합의 스냅샷 해시. 근거가 바뀌면 평가·승인이 무효화된다 (docs/03 §4). */
export function evidenceHash(evidence: readonly EvidenceDTO[]): string {
  return sha256(stableStringify(evidence.map((e) => [e.id, e.trustGrade, e.text, e.timestamp]).sort()));
}

export function evidenceStateOf(evidence: readonly EvidenceDTO[]): EvidenceState {
  if (evidence.length === 0) return 'NEEDS_EVIDENCE';
  return evidence.some((e) => e.trustGrade === 'A') ? 'VERIFIED' : 'PARTIAL';
}

export function insertEvidence(
  ctx: AppContext,
  input: { videoId: string; sourceType: EvidenceSourceType; text: string; grade: TrustGrade; verifiedBy: string; timestamp?: string | null },
): string | null {
  const text = Array.from(input.text.trim()).slice(0, MAX_EXCERPT).join('');
  if (!text) return null;
  const id = newId('ev');
  const res = ctx.db
    .prepare(
      `INSERT OR IGNORE INTO evidence (evidence_id, video_id, source_type, original_excerpt, timestamp_label, verified_by, trust_grade, text_hash, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, input.videoId, input.sourceType, text, input.timestamp ?? null, input.verifiedBy, input.grade, sha256(text), ctx.clock().toISOString());
  return res.changes === 1 ? id : null;
}

/**
 * 운영자가 영상을 직접 보고 확인한 발언/장면을 A 등급 근거로 등록 (docs/05 §2-3).
 * 근거가 바뀌므로 해당 영상의 기존 승인은 무효화된다.
 */
export function addOperatorQuote(ctx: AppContext, videoId: string, text: string, timestamp: string | null): EvidenceDTO {
  const video = ctx.db.prepare('SELECT video_id FROM videos WHERE video_id = ?').get(videoId);
  if (!video) throw notFound('영상');
  const trimmed = text.trim();
  if (Array.from(trimmed).length < 4 || Array.from(trimmed).length > 300) throw new AppError('INVALID_QUOTE', '확인한 발언은 4~300자로 입력해 주세요.');
  if (timestamp !== null && !TIMESTAMP_PATTERN.test(timestamp)) throw new AppError('INVALID_TIMESTAMP', '타임스탬프는 mm:ss 또는 h:mm:ss 형식이어야 합니다.');
  const id = insertEvidence(ctx, { videoId, sourceType: 'OPERATOR_QUOTE', text: trimmed, grade: 'A', verifiedBy: 'OPERATOR', timestamp });
  if (!id) throw new AppError('DUPLICATE_EVIDENCE', '이미 등록된 발언입니다.', 409);
  ctx.audit.record('evidence', id, 'OPERATOR_QUOTE_ADDED', 'OPERATOR', { videoId, timestamp });
  invalidateApprovalsForVideo(ctx, videoId, '근거 스냅샷 변경');
  return listEvidence(ctx, videoId).find((e) => e.id === id)!;
}

export function removeEvidence(ctx: AppContext, evidenceId: string): void {
  const row = ctx.db.prepare('SELECT video_id, source_type FROM evidence WHERE evidence_id = ? AND removed_at IS NULL').get(evidenceId) as
    | { video_id: string; source_type: string }
    | undefined;
  if (!row) throw notFound('근거');
  if (row.source_type !== 'OPERATOR_QUOTE') throw new AppError('EVIDENCE_LOCKED', '운영자가 추가한 근거만 삭제할 수 있습니다.');
  ctx.db.prepare('UPDATE evidence SET removed_at = ? WHERE evidence_id = ?').run(ctx.clock().toISOString(), evidenceId);
  ctx.audit.record('evidence', evidenceId, 'EVIDENCE_REMOVED', 'OPERATOR', { videoId: row.video_id });
  invalidateApprovalsForVideo(ctx, row.video_id, '근거 스냅샷 변경');
}

export function invalidateApprovalsForVideo(ctx: AppContext, videoId: string, reason: string): number {
  const res = ctx.db
    .prepare('UPDATE approvals SET invalidated_at = ?, invalid_reason = ? WHERE source_video_id = ? AND invalidated_at IS NULL')
    .run(ctx.clock().toISOString(), reason, videoId);
  if (res.changes > 0) ctx.audit.record('approval', videoId, 'APPROVALS_INVALIDATED', 'SYSTEM', { reason, count: res.changes });
  return res.changes;
}
