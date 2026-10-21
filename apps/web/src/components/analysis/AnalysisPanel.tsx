import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { BrainCircuit, ChevronDown, MousePointerClick, Play, RotateCcw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { AnalysisDTO, VideoDTO } from '@context/shared';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { isActiveJobStatus, qk, useAnalysis } from '../../api/queries.ts';
import { useTrackedJob } from '../../api/useTrackedJob.ts';
import { JOB_STATUS } from '../../lib/status.ts';
import { cx, fmtCount, fmtDate, fmtDateTime } from '../../lib/format.ts';
import { pickRecommended } from '../../lib/recommend.ts';
import { Badge, Button, EmptyState, Notice, Panel, SectionLabel, Spinner } from '../ui/primitives.tsx';
import { ServerError } from '../ui/overlay.tsx';
import { CandidateCard } from './CandidateCard.tsx';
import { CommentEditor } from './CommentEditor.tsx';
import { EvidencePanel } from './EvidencePanel.tsx';

interface Props {
  readonly video: VideoDTO | null;
  readonly analysisId: string | null;
  readonly onAnalysisId: (videoId: string, analysisId: string) => void;
  readonly selectedCandidateId: string | null;
  readonly onSelectCandidate: (id: string) => void;
  readonly className?: string;
}

function VideoSummary({ video }: { video: VideoDTO }) {
  return (
    <div className="flex gap-3 rounded-card border border-line bg-elevated/40 p-3">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold leading-snug">{video.title}</p>
        <p className="mt-1 text-[12px] text-muted tnum">
          {video.channelName} · {fmtDate(video.publishedAt)} · 조회 {fmtCount(video.viewCount)} · 댓글 {fmtCount(video.commentCount)} ·{' '}
          <span className="font-mono">{video.videoId}</span>
        </p>
        {video.description ? <p className="mt-1.5 line-clamp-2 text-[12.5px] text-muted">{video.description}</p> : null}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {video.source === 'SYNTHETIC' ? <Badge tone="warning" icon>합성 데이터</Badge> : null}
        {video.trend.isRising ? <Badge tone="warning">뜨기 직전 · 초안까지만</Badge> : null}
      </div>
    </div>
  );
}

function AnalysisStatus({ analysis }: { analysis: AnalysisDTO }) {
  const meta = JOB_STATUS[analysis.status];
  const active = isActiveJobStatus(analysis.status);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5" data-testid="analysis-status">
        <Badge tone={meta.tone} icon>
          {analysis.status} · {meta.label}
        </Badge>
        {analysis.mode === 'MOCK' ? (
          <Badge tone="warning" icon title="실제 Claude 호출이 아닌 모의 결과">
            모의 분석
          </Badge>
        ) : (
          <Badge tone="accent">실제 Claude 분석</Badge>
        )}
        <span className="text-[11.5px] text-muted tnum" title={`${analysis.promptVersion} · ${analysis.modelId ?? '모델 미정'}`}>
          {fmtDateTime(analysis.createdAt)}
        </span>
        {active ? <Spinner label="진행 중" /> : null}
      </div>
      {analysis.stale ? (
        <Notice tone="warning" testId="analysis-stale">
          근거 변경됨 — 이 분석 이후 근거가 바뀌었습니다. 다시 분석하거나 후보를 재검증해야 합니다.
        </Notice>
      ) : null}
      {analysis.errorMessage ? <Notice tone={analysis.status === 'NEEDS_REVIEW' ? 'warning' : 'danger'}>{analysis.errorMessage}</Notice> : null}
    </div>
  );
}

export function AnalysisPanel({ video, analysisId, onAnalysisId, selectedCandidateId, onSelectCandidate, className }: Props) {
  const qc = useQueryClient();
  const tracked = useTrackedJob(qk.analysis(analysisId ?? 'none'));
  const analysisQ = useAnalysis(analysisId, tracked.active);
  const analysis = analysisQ.data;
  const start = useApiMutation((force: boolean) => api.post<AnalysisDTO>('/api/analyses', { videoId: video?.videoId, force }), {
    invalidate: [qk.jobs, qk.health, ['videos']],
    onSuccess: (res) => {
      qc.setQueryData(qk.analysis(res.id), res);
      onAnalysisId(res.videoId, res.id);
    },
  });

  // 과제 p.3: 영상을 고르면 바로 고민 한 줄과 초안이 보여야 한다 — 분석이 없으면 자동으로 한 번 시작한다.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!(video?.allowed || video?.draftOnly) || analysisId || autoStarted.current) return;
    autoStarted.current = true;
    start.mutate(false);
  }, [video?.allowed, video?.draftOnly, analysisId, start]);

  // 선택한 후보가 없으면 추천 초안을 자동 선택해 오른쪽 ③이 바로 열리게 한다.
  const recommended = analysis ? pickRecommended(analysis.candidates) : null;
  const finished = analysis ? !isActiveJobStatus(analysis.status) : false;
  useEffect(() => {
    if (finished && recommended && !analysis?.candidates.some((c) => c.id === selectedCandidateId)) onSelectCandidate(recommended.id);
  }, [finished, recommended, analysis, selectedCandidateId, onSelectCandidate]);

  const [showOthers, setShowOthers] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);

  if (!video) {
    return (
      <Panel step="2" title="AI 분석 · 댓글" labelledBy="panel-analysis" className={className}>
        <EmptyState icon={<MousePointerClick size={22} aria-hidden />} title="왼쪽에서 영상을 선택하세요" hint="영상을 고르면 AI가 자막·제목·인기 댓글을 읽고 영상 속 고민 한 줄과 댓글 초안을 만듭니다." />
      </Panel>
    );
  }

  const selected = analysis?.candidates.find((c) => c.id === selectedCandidateId) ?? null;
  const busy = analysis ? isActiveJobStatus(analysis.status) : false;

  return (
    <Panel
      step="2"
      title="AI 분석 · 댓글"
      labelledBy="panel-analysis"
      className={className}
      actions={
        analysisId ? (
          <Button size="sm" variant="secondary" data-testid="reanalyze" icon={<RotateCcw size={13} aria-hidden />} onClick={() => start.mutate(true)} loading={start.isPending} disabled={busy || !(video.allowed || video.draftOnly)}>
            다시 분석
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        <VideoSummary video={video} />
        {video.draftOnly ? (
          <Notice tone="warning" testId="draft-only-notice">
            지정 채널 밖의 뜨기 직전 영상입니다 — 초안까지만 만들고 승인·게시는 하지 않습니다.
          </Notice>
        ) : !video.allowed ? (
          <Notice tone="danger">허용 채널 영상이 아니므로 분석할 수 없습니다.</Notice>
        ) : null}

        {!analysisId && (video.allowed || video.draftOnly) ? (
          <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-line p-4">
            {start.isError ? (
              <Button variant="primary" data-testid="start-analysis" icon={<Play size={14} aria-hidden />} onClick={() => start.mutate(false)} loading={start.isPending}>
                다시 분석 시작
              </Button>
            ) : (
              <Spinner label="자막·제목·인기 댓글을 읽고 분석을 시작하는 중" />
            )}
          </div>
        ) : null}
        <ServerError error={start.error} />

        {analysisId && analysisQ.isLoading ? <Spinner label="분석 결과 불러오는 중" /> : null}
        {analysisQ.isError ? <Notice tone="danger">분석 결과를 불러오지 못했습니다.</Notice> : null}

        {analysis ? (
          <>
            <AnalysisStatus analysis={analysis} />
            <div className="rounded-card border border-accent/25 bg-accent/[0.06] px-4 py-3">
              <p className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-accent-strong">
                <BrainCircuit size={13} aria-hidden /> 영상 속 고민 한 줄
              </p>
              <p data-testid="core-problem" className="text-[16px] font-semibold leading-snug">
                {analysis.coreProblem ?? (busy ? '분석 중…' : '도출되지 않음')}
              </p>
            </div>
          </>
        ) : null}

        {analysis ? (
          <section aria-label="댓글 초안" className="space-y-2.5">
            {analysis.candidates.length === 0 ? (
              <Notice tone="neutral">{busy ? '자막·댓글을 읽고 초안을 쓰는 중입니다…' : '생성된 초안이 없습니다.'}</Notice>
            ) : (
              <>
                <SectionLabel>{selected && selected.id !== recommended?.id ? '선택한 댓글 초안' : '추천 댓글 초안'}</SectionLabel>
                <div data-testid="recommended-draft" className="blur-in">
                  {(selected ?? recommended) ? (
                    <CandidateCard candidate={(selected ?? recommended)!} selected={(selected ?? recommended)!.id === selectedCandidateId} onSelect={onSelectCandidate} />
                  ) : null}
                </div>
                {selected ? (
                  <div className="flex flex-wrap gap-2">
                    <Toggle open={showEditor} onClick={() => setShowEditor((v) => !v)} testId="edit-toggle">직접 고치기</Toggle>
                    {analysis.candidates.length > 1 ? (
                      <Toggle open={showOthers} onClick={() => setShowOthers((v) => !v)} testId="more-drafts">다른 초안 {analysis.candidates.length - 1}개 보기</Toggle>
                    ) : null}
                  </div>
                ) : null}
                {selected && showEditor ? (
                  <CommentEditor key={selected.latestRevision.id} candidate={selected} analysisId={analysis.id} revalidating={tracked.active} onRevalidateStarted={tracked.track} />
                ) : null}
                {showOthers ? (
                  <div className="stagger space-y-2.5" role="group" aria-label="다른 초안">
                    {analysis.candidates
                      .filter((c) => c.id !== (selected ?? recommended)?.id)
                      .map((c, i) => (
                        <div key={c.id} style={{ '--i': i } as CSSProperties}>
                          <CandidateCard candidate={c} selected={false} onSelect={onSelectCandidate} />
                        </div>
                      ))}
                  </div>
                ) : null}
              </>
            )}
            {tracked.finished && tracked.finished.status !== 'COMPLETED' ? (
              <Notice tone="danger">
                재검증 {tracked.finished.status}: {tracked.finished.errorMessage ?? tracked.finished.errorCode ?? '사유 없음'}
              </Notice>
            ) : null}
          </section>
        ) : null}

        <div className="border-t border-line pt-3">
          <Toggle open={showEvidence} onClick={() => setShowEvidence((v) => !v)} testId="evidence-toggle">
            AI가 읽은 근거 보기{analysis ? ` (${evidenceSummary(analysis)})` : ''}
          </Toggle>
          {showEvidence ? (
            <div className="mt-3">
              <EvidencePanel videoId={video.videoId} analysis={analysis} />
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function Toggle({ open, onClick, testId, children }: { open: boolean; onClick: () => void; testId: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      data-testid={testId}
      className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] text-muted hover:border-line-strong hover:text-fg"
    >
      <ChevronDown size={13} aria-hidden className={cx('transition-transform', open && 'rotate-180')} />
      {children}
    </button>
  );
}

function evidenceSummary(analysis: AnalysisDTO): string {
  const count = (t: string) => analysis.evidence.filter((e) => e.sourceType === t).length;
  const transcript = count('TRANSCRIPT');
  return [transcript ? `자막 ${transcript}구간` : '자막 없음', `댓글 ${count('COMMENT')}개`].join(' · ');
}
