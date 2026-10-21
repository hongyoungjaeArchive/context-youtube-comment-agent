import type { EvidenceState, ExecutionStatus, JobStatus, ProfileStatus, ReviewStatus } from '@context/shared';
import type { Tone } from '../components/ui/primitives.tsx';

export const JOB_STATUS: Record<JobStatus, { tone: Tone; label: string }> = {
  QUEUED: { tone: 'neutral', label: '대기' },
  WAITING_DEPENDENCY: { tone: 'neutral', label: '선행 작업 대기' },
  RUNNING: { tone: 'accent', label: '진행 중' },
  RATE_LIMITED: { tone: 'warning', label: '속도 제한' },
  RETRY_SCHEDULED: { tone: 'warning', label: '재시도 예정' },
  COMPLETED: { tone: 'success', label: '완료' },
  FAILED: { tone: 'danger', label: '실패' },
  CANCELLED: { tone: 'neutral', label: '취소' },
  NEEDS_REVIEW: { tone: 'warning', label: '검토 필요' },
  BUDGET_BLOCKED: { tone: 'danger', label: '예산 차단' },
};

export const REVIEW_STATUS: Record<ReviewStatus, { tone: Tone; label: string }> = {
  PASS: { tone: 'success', label: '품질 통과' },
  FAIL: { tone: 'danger', label: '수정 필요' },
  NEEDS_EVIDENCE: { tone: 'warning', label: '자료 부족' },
};

export const EVIDENCE_STATE: Record<EvidenceState, { tone: Tone; label: string }> = {
  VERIFIED: { tone: 'success', label: '직접 확인 근거 있음' },
  PARTIAL: { tone: 'warning', label: '부분 근거 (공식 메타·댓글)' },
  NEEDS_EVIDENCE: { tone: 'warning', label: '근거 부족' },
  BLOCKED_EVIDENCE: { tone: 'danger', label: '근거 차단' },
};

export const PROFILE_STATUS: Record<ProfileStatus, { tone: Tone; label: string }> = {
  REGISTERED: { tone: 'neutral', label: '등록됨 · 로그인 미확인' },
  READY: { tone: 'success', label: '로그인 확인됨' },
  AUTH_REQUIRED: { tone: 'warning', label: '로그인 필요' },
  LOCKED: { tone: 'accent', label: '실행 중 잠금' },
  ERROR: { tone: 'danger', label: '오류' },
};

export const EXECUTION_STATUS: Record<ExecutionStatus, { tone: Tone; label: string }> = {
  QUEUED: { tone: 'neutral', label: '대기' },
  PREFLIGHT: { tone: 'accent', label: '사전 점검' },
  LAUNCHING: { tone: 'accent', label: '프로필 여는 중' },
  AUTH_CHECK: { tone: 'accent', label: '로그인 확인' },
  NAVIGATING: { tone: 'accent', label: '영상 이동' },
  EDITOR_READY: { tone: 'accent', label: '입력창 준비' },
  TYPING: { tone: 'accent', label: '입력 중' },
  SUBMITTING: { tone: 'accent', label: '게시 중' },
  VERIFYING: { tone: 'accent', label: '게시 확인 중' },
  SUCCESS: { tone: 'success', label: '게시 완료' },
  UNKNOWN: { tone: 'warning', label: '게시 여부 불확실' },
  FAILED_PRE_SUBMIT: { tone: 'danger', label: '게시 전 실패' },
  AUTH_REQUIRED: { tone: 'danger', label: '로그인 필요' },
  CANCELLED: { tone: 'neutral', label: '취소' },
  POLICY_BLOCKED: { tone: 'danger', label: '정책 차단' },
  PROFILE_LOCKED: { tone: 'danger', label: '프로필 잠금' },
  INTERRUPTED: { tone: 'warning', label: '중단됨' },
};

export const QUALITY_ITEMS = [
  { key: 'context_match', label: '영상 맥락', weight: 30 },
  { key: 'brand_relevance', label: '브랜드', weight: 25 },
  { key: 'naturalness', label: '자연스러움', weight: 20 },
  { key: 'uniqueness', label: '고유성', weight: 15 },
  { key: 'factuality', label: '사실성', weight: 10 },
] as const;

export const ERROR_ACTION_PATTERN = /(FAILED|BLOCKED|UNKNOWN|ERROR)/;
