import { ShieldCheck } from 'lucide-react';
import type { ApprovalDTO, CandidateDTO, ProfileDTO, TestTargetDTO } from '@context/shared';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { qk } from '../../api/queries.ts';
import { PROFILE_STATUS } from '../../lib/status.ts';
import { Badge, Button, Notice, type Tone } from '../ui/primitives.tsx';
import { Field, ServerError, inputClass } from '../ui/overlay.tsx';
import { OwnVideoForm } from './OwnVideoForm.tsx';

export type ApprovalState = 'DISABLED' | 'READY' | 'APPROVED' | 'INVALIDATED';

interface Props {
  readonly candidate: CandidateDTO;
  readonly analysisId: string;
  readonly targets: readonly TestTargetDTO[];
  readonly profiles: readonly ProfileDTO[];
  readonly targetId: string;
  readonly profileId: string;
  readonly onTargetId: (id: string) => void;
  readonly onProfileId: (id: string) => void;
  /** 이 후보에서 이전에 본 승인 (수정으로 사라진 승인을 INVALIDATED로 보여 주기 위함). */
  readonly previousApproval: ApprovalDTO | null;
}

const STATE_TONE: Record<ApprovalState, Tone> = { DISABLED: 'neutral', READY: 'accent', APPROVED: 'success', INVALIDATED: 'danger' };
const STATE_LABEL: Record<ApprovalState, string> = {
  DISABLED: '승인 불가',
  READY: '승인 가능',
  APPROVED: '승인됨',
  INVALIDATED: '승인 무효',
};

export function deriveApprovalState(candidate: CandidateDTO, previousApproval: ApprovalDTO | null, selectionReady: boolean): { state: ApprovalState; reason: string | null } {
  const { approval, review } = candidate;
  if (approval?.valid) return { state: 'APPROVED', reason: null };
  if (approval && !approval.valid) return { state: 'INVALIDATED', reason: approval.invalidReason ?? '승인이 무효화되었습니다.' };
  if (previousApproval && previousApproval.revisionId !== candidate.latestRevision.id) {
    return { state: 'INVALIDATED', reason: '댓글 수정으로 승인 무효화 — 재검증 후 다시 승인하세요.' };
  }
  if (!review) return { state: 'DISABLED', reason: '이 버전의 품질 평가가 없습니다. AI 재검증이 필요합니다.' };
  if (review.stale) return { state: 'DISABLED', reason: '근거가 바뀌어 평가가 무효입니다. 재검증이 필요합니다.' };
  if (review.status !== 'PASS') return { state: 'DISABLED', reason: `품질 평가가 PASS가 아닙니다 (${review.status}).` };
  if (!candidate.latestRevision.staticCheck.ok) return { state: 'DISABLED', reason: '정적 규칙(길이·링크·해시태그·후기) 위반이 있습니다.' };
  if (!selectionReady) return { state: 'DISABLED', reason: '테스트 영상과 프로필을 선택하세요.' };
  return { state: 'READY', reason: null };
}

export function ApprovalControl({ candidate, analysisId, targets, profiles, targetId, profileId, onTargetId, onProfileId, previousApproval }: Props) {
  const approval = useApiMutation(
    () =>
      api.post<ApprovalDTO>('/api/approvals', {
        revisionId: candidate.latestRevision.id,
        reviewId: candidate.review?.id,
        testTargetId: targetId,
        profileId,
      }),
    { invalidate: [qk.analysis(analysisId), qk.activity] },
  );
  const selectionReady = targetId !== '' && profileId !== '';
  const { state, reason } = deriveApprovalState(candidate, previousApproval, selectionReady);
  const freshState = deriveApprovalState({ ...candidate, approval: null }, null, selectionReady).state;
  const current = candidate.approval;
  const selectionChanged = current?.valid === true && (current.testTargetId !== targetId || current.profileId !== profileId);
  const canApprove = state === 'READY' || ((state === 'INVALIDATED' || selectionChanged) && freshState === 'READY');
  const selectedTarget = targets.find((t) => t.id === targetId);

  return (
    <section aria-label="운영자 승인" className="space-y-3">
      <Field label="테스트 대상 영상 (본인 소유 확인된 영상만)" htmlFor="target-select">
        <select id="target-select" data-testid="target-select" value={targetId} onChange={(e) => onTargetId(e.target.value)} className={inputClass}>
          <option value="">— 선택 —</option>
          {targets.map((t) => (
            <option key={t.id} value={t.id} disabled={t.ownershipState !== 'VERIFIED'}>
              {t.isFixture && !(t.title ?? '').includes('픽스처') ? '[로컬 픽스처] ' : ''}
              {t.title ?? t.videoId}
              {t.ownershipState !== 'VERIFIED' ? ' (소유 미확인)' : ''}
              {t.claimStatus ? ` — 이미 게시 기록 있음(${t.claimStatus})` : ''}
            </option>
          ))}
        </select>
      </Field>
      {targets.every((t) => t.ownershipState !== 'VERIFIED' || t.claimStatus) ? (
        <div className="space-y-2 rounded-lg border border-line bg-bg/60 p-3">
          <Notice tone="warning">댓글을 달 본인 테스트 영상이 없습니다. 내 채널 영상 URL을 한 번만 등록하면 바로 선택됩니다.</Notice>
          <OwnVideoForm idPrefix="inline-target" onRegistered={(t) => (t.ownershipState === 'VERIFIED' ? onTargetId(t.id) : undefined)} />
        </div>
      ) : null}
      {selectedTarget ? (
        <div className="flex flex-wrap gap-1">
          {selectedTarget.isFixture ? <Badge tone="warning">로컬 픽스처</Badge> : <Badge tone="success" icon>소유 확인 · {selectedTarget.verificationMethod ?? 'VERIFIED'}</Badge>}
          {selectedTarget.claimStatus ? <Badge tone="danger" icon>이미 게시 기록 있음 · {selectedTarget.claimStatus}</Badge> : null}
        </div>
      ) : null}

      <Field label="댓글 달 프로필" htmlFor="profile-select">
        <select id="profile-select" data-testid="profile-select" value={profileId} onChange={(e) => onProfileId(e.target.value)} className={inputClass}>
          <option value="">— 선택 —</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.alias} · {p.status} ({PROFILE_STATUS[p.status].label})
            </option>
          ))}
        </select>
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" data-testid="approve-button" icon={<ShieldCheck size={15} aria-hidden />} onClick={() => approval.mutate()} loading={approval.isPending} disabled={!canApprove}>
          운영자 승인
        </Button>
        <Badge tone={STATE_TONE[state]} icon testId="approval-state">
          {state} · {STATE_LABEL[state]}
        </Badge>
      </div>
      {reason ? <p className="text-[12px] text-muted">{reason}</p> : null}
      {candidate.approval?.valid ? (
        <p className="text-[12px] text-muted">
          승인 해시 <span className="font-mono text-fg">{candidate.approval.contentHash.slice(0, 12)}</span> · 대상·프로필이 승인에 결속됩니다. 바꾸려면 다시 승인하세요.
        </p>
      ) : null}
      <ServerError error={approval.error} />
    </section>
  );
}
