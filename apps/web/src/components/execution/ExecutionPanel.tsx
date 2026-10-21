import { useEffect, useState } from 'react';
import { Copy, Rocket, ShieldOff } from 'lucide-react';
import { STRATEGY_LABEL, type ApprovalDTO, type ExecutionDTO } from '@context/shared';
import { api, type ApiError } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { useQueryClient } from '@tanstack/react-query';
import { isTerminalExecution, qk, useAnalysis, useExecution, useExecutions, useProfiles, useTargets } from '../../api/queries.ts';
import { REVIEW_STATUS } from '../../lib/status.ts';
import { newRequestId } from '../../lib/format.ts';
import { Badge, Button, EmptyState, Notice, Panel, SectionLabel } from '../ui/primitives.tsx';
import { Modal, ServerError } from '../ui/overlay.tsx';
import { ApprovalControl } from './ApprovalControl.tsx';
import { ExecutionTimeline } from './ExecutionTimeline.tsx';

interface Props {
  readonly analysisId: string | null;
  readonly candidateId: string | null;
  readonly className?: string;
}

/** 고를 수 있는 항목이 하나뿐이면 그 ID를 기본값으로 쓴다 (처음 보는 사람도 바로 진행). */
function soleOption(items: readonly { id: string }[]): string {
  return items.length === 1 ? items[0]!.id : '';
}

const DISCLOSURE = '※ 광고 관계 공개: 이 댓글은 운명원(연애 사주) 마케팅 목적으로 작성되었습니다.';

function ConfirmDialog({ open, onClose, onConfirm, pending, approval, error }: { open: boolean; onClose: () => void; onConfirm: () => void; pending: boolean; approval: ApprovalDTO; error: ApiError | null }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      width="md"
      title="댓글 달기 확인"
      subtitle="승인과 실행은 별개입니다. 아래 내용을 확인한 뒤 실행하세요."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="danger" data-testid="confirm-execute" loading={pending} onClick={onConfirm} icon={<Rocket size={14} aria-hidden />}>
            실제로 입력·게시
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-[13px]">
        <Notice tone="warning">본인 소유 테스트 영상에 실제로 댓글을 입력·게시합니다. 게시 후 결과가 불확실하면 UNKNOWN으로 보류하며 자동으로 다시 게시하지 않습니다.</Notice>
        <p className="text-muted">
          승인 해시 <span className="font-mono text-fg">{approval.contentHash.slice(0, 12)}</span> · 영상당 1개 · 하루 상한은 서버가 강제합니다.
        </p>
        <ServerError error={error} />
      </div>
    </Modal>
  );
}

export function ExecutionPanel({ analysisId, candidateId, className }: Props) {
  const analysis = useAnalysis(analysisId, false).data;
  const candidate = analysis?.candidates.find((c) => c.id === candidateId) ?? null;
  const targets = useTargets().data?.targets ?? [];
  const profiles = useProfiles().data?.profiles ?? [];
  const executions = useExecutions().data?.executions ?? [];
  const [targetId, setTargetId] = useState('');
  const [profileId, setProfileId] = useState('');
  const [seenApprovals, setSeenApprovals] = useState<Readonly<Record<string, ApprovalDTO>>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [requestId, setRequestId] = useState('');
  const [activeExecId, setActiveExecId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const approval = candidate?.approval ?? null;
  useEffect(() => {
    if (!candidate || !approval?.valid) return;
    setSeenApprovals((prev) => (prev[candidate.id]?.id === approval.id ? prev : { ...prev, [candidate.id]: approval }));
  }, [candidate, approval]);

  const latestForApproval = approval ? executions.find((e) => e.approvalId === approval.id) : undefined;
  const execId = activeExecId && (!latestForApproval || latestForApproval.id === activeExecId) ? activeExecId : (latestForApproval?.id ?? null);
  const execution = useExecution(execId).data;
  const qc = useQueryClient();
  const executionDone = execution ? isTerminalExecution(execution.status) : false;
  useEffect(() => {
    if (!executionDone) return;
    for (const key of [qk.profiles, qk.targets, qk.health, qk.executions]) void qc.invalidateQueries({ queryKey: key });
  }, [executionDone, qc]);

  const execute = useApiMutation(
    (vars: { approvalId: string; profileId: string; requestId: string }) => api.post<ExecutionDTO>('/api/executions/test', { ...vars, confirm: true }),
    {
      invalidate: [qk.executions, qk.health, qk.targets, qk.profiles],
      onSuccess: (res) => {
        setActiveExecId(res.id);
        setDialogOpen(false);
      },
    },
  );

  if (!analysisId || !candidate) {
    return (
      <Panel step="3" title="승인 · 실행" labelledBy="panel-execution" className={className}>
        <EmptyState icon={<ShieldOff size={22} aria-hidden />} title="선택한 댓글 후보가 없습니다" hint="가운데에서 후보를 선택하면 품질 상태·승인·테스트 실행이 여기에 표시됩니다." />
      </Panel>
    );
  }

  const rev = candidate.latestRevision;
  const review = candidate.review;
  const reviewMeta = review ? REVIEW_STATUS[review.status] : null;
  const effectiveTarget = targetId !== '' ? targetId : approval?.valid ? approval.testTargetId : soleOption(targets.filter((t) => t.ownershipState === 'VERIFIED' && !t.claimStatus));
  const effectiveProfile = profileId !== '' ? profileId : approval?.valid ? approval.profileId : soleOption(profiles.length === 1 ? profiles : profiles.filter((p) => p.status === 'READY'));

  const openDialog = () => {
    execute.reset();
    setRequestId(newRequestId());
    setDialogOpen(true);
  };
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`${rev.content}\n\n${DISCLOSURE}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Panel step="3" title="승인 · 실행" labelledBy="panel-execution" className={className}>
      <div className="space-y-4">
        <section aria-label="승인 대상 문구" className="space-y-2">
          <SectionLabel right={<Badge tone="neutral">{STRATEGY_LABEL[candidate.strategy]} v{rev.versionNo}</Badge>}>최종 문구</SectionLabel>
          <p className="whitespace-pre-wrap rounded-lg border border-line bg-bg/60 px-3 py-2.5 text-[13.5px] leading-[1.6]" data-testid="approval-content">
            {rev.content}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
            <span>
              해시 <span className="font-mono text-fg" data-testid="content-hash">{rev.contentHash.slice(0, 12)}</span>
            </span>
            {reviewMeta && review ? (
              <Badge tone={review.stale ? 'warning' : reviewMeta.tone} icon>
                {review.stale ? '평가 무효 (근거 변경)' : `${review.status} · ${reviewMeta.label}`}
              </Badge>
            ) : (
              <Badge tone="warning" icon>
                평가 없음
              </Badge>
            )}
            {analysis?.mode === 'MOCK' ? <Badge tone="warning">모의 분석 결과</Badge> : null}
          </div>
          <div className="flex items-start gap-2">
            <Button size="sm" variant="ghost" className="shrink-0 whitespace-nowrap" icon={<Copy size={13} aria-hidden />} onClick={() => void handleCopy()} data-testid="copy-draft">
              {copied ? '복사됨' : '초안 복사'}
            </Button>
            <span className="text-[11.5px] text-muted">지정(제3자) 채널 영상에는 자동 게시하지 않습니다 — 광고 관계 공개 문구와 함께 복사·검토만.</span>
          </div>
        </section>

        <ApprovalControl
          candidate={candidate}
          analysisId={analysisId}
          targets={targets}
          profiles={profiles}
          targetId={effectiveTarget}
          profileId={effectiveProfile}
          onTargetId={setTargetId}
          onProfileId={setProfileId}
          previousApproval={seenApprovals[candidate.id] ?? null}
        />

        <section aria-label="댓글 달기" className="space-y-2 border-t border-line pt-4">
          <SectionLabel>댓글 달기</SectionLabel>
          <Button variant="danger" data-testid="execute-button" icon={<Rocket size={15} aria-hidden />} onClick={openDialog} disabled={!approval?.valid}>
            댓글 달기
          </Button>
          {!approval?.valid ? <p className="text-[12px] text-muted">운영자 승인 후 누르면 Chrome 프로필이 열리고 한 글자씩 입력·게시·확인합니다.</p> : null}
          {dialogOpen ? null : <ServerError error={execute.error} />}
          {approval?.valid ? (
            <ConfirmDialog
              open={dialogOpen}
              onClose={() => setDialogOpen(false)}
              approval={approval}
              pending={execute.isPending}
              error={execute.error}
              onConfirm={() => execute.mutate({ approvalId: approval.id, profileId: approval.profileId, requestId })}
            />
          ) : null}
        </section>

        {execution ? <ExecutionTimeline execution={execution} /> : null}
      </div>
    </Panel>
  );
}
