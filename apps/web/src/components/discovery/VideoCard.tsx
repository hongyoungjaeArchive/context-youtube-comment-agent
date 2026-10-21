import { useState } from 'react';
import { ChevronDown, Eye, Flame, ImageOff, Sparkles } from 'lucide-react';
import type { VideoDTO } from '@context/shared';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { qk } from '../../api/queries.ts';
import { Badge, Button } from '../ui/primitives.tsx';
import { ServerError } from '../ui/overlay.tsx';
import { cx, fmtCount, fmtDate } from '../../lib/format.ts';

interface Props {
  readonly video: VideoDTO;
  readonly selected: boolean;
  readonly onSelect: (videoId: string) => void;
}

const TIER_LABEL = { PRIORITY: '우선 추천', NORMAL: '일반', LOW: '낮음' } as const;
const FIT_ITEM_LABEL: Record<string, string> = {
  romance_relevance: '연애 관련성',
  brand_fit: '브랜드 적합',
  evidence_depth: '근거 깊이',
  audience_interest: '시청자 관심',
};

function FitScore({ fit }: { fit: VideoDTO['fit'] }) {
  if (fit.state === 'PENDING') return <Badge tone="neutral">평가 대기</Badge>;
  if (fit.state === 'NOT_ASSESSED' || fit.score === null) return <Badge tone="warning" icon>평가 불가</Badge>;
  const tone = fit.tier === 'PRIORITY' ? 'success' : fit.tier === 'NORMAL' ? 'accent' : 'neutral';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[17px] font-bold leading-none tnum">{fit.score}</span>
      <span className="text-[11px] text-muted">/100</span>
      {fit.tier ? <Badge tone={tone}>{TIER_LABEL[fit.tier]}</Badge> : null}
    </span>
  );
}

export function VideoCard({ video, selected, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { fit } = video;
  const score = useApiMutation(() => api.post<{ jobId: string; created: boolean }>(`/api/videos/${video.videoId}/score`), {
    invalidate: [qk.jobs, ['videos']],
  });
  const hasReason = fit.state === 'SCORED' && (fit.summary || fit.ratings);

  return (
    <article
      data-testid="video-card"
      data-video-id={video.videoId}
      data-selected={selected}
      onClick={() => onSelect(video.videoId)}
      className={cx(
        'lift group cursor-pointer rounded-card border p-3',
        selected ? 'border-accent/70 bg-accent/[0.08] shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line bg-elevated/50 hover:border-line-strong hover:bg-elevated/80',
      )}
    >
      <div className="flex gap-3">
        <div className="relative h-[54px] w-[96px] shrink-0 overflow-hidden rounded-lg bg-bg">
          {video.thumbnailUrl ? (
            <img src={video.thumbnailUrl} alt="" width={96} height={54} loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full w-full place-items-center text-muted" aria-label="썸네일 없음">
              <ImageOff size={16} aria-hidden />
            </div>
          )}
          {video.source === 'SYNTHETIC' ? (
            <span className="absolute bottom-0 left-0 right-0 bg-warning/90 px-1 text-center text-[10px] font-bold text-surface">합성 데이터</span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            aria-pressed={selected}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(video.videoId);
            }}
            className="line-clamp-2 rounded text-left text-[13.5px] font-medium leading-[1.35] hover:text-accent-strong"
          >
            {video.title}
          </button>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-muted tnum">
            <span className="truncate">{video.channelName}</span>
            <span aria-hidden>·</span>
            <span>{fmtDate(video.publishedAt)}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-0.5">
              <Eye size={11} aria-hidden />
              {fmtCount(video.viewCount)}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <FitScore fit={fit} />
        {video.trend.isRising ? (
          <Badge tone="warning" icon={<Flame size={12} aria-hidden />} title="연애 키워드·조회수 1,000~5,000·시간당 150 이상 — 초안까지만">
            뜨기 직전 · 초안까지만
          </Badge>
        ) : null}
        {video.latestAnalysisId ? <Badge tone="accent" icon={<Sparkles size={11} aria-hidden />}>분석 있음</Badge> : null}
        {video.draftOnly ? (
          <Badge tone="neutral" title="지정 채널 밖 영상 — 분석·초안만 가능, 승인·게시 불가">지정 채널 밖 · 게시 불가</Badge>
        ) : !video.allowed ? (
          <Badge tone="danger" icon>허용 외 채널</Badge>
        ) : null}
        {fit.state === 'PENDING' && video.allowed ? (
          <Button
            size="sm"
            variant="ghost"
            data-testid="score-video"
            className="ml-auto h-7"
            loading={score.isPending}
            disabled={score.isSuccess}
            onClick={(e) => {
              e.stopPropagation();
              score.mutate();
            }}
          >
            {score.isSuccess ? '평가 요청됨' : '적합도 평가'}
          </Button>
        ) : null}
      </div>
      <ServerError error={score.error} className="mt-2" />

      {fit.keywordHits.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {fit.keywordHits.slice(0, 6).map((k) => (
            <span key={k} className="rounded-full bg-fg/[0.05] px-2 py-px text-[11px] text-muted">
              #{k}
            </span>
          ))}
        </div>
      ) : null}

      {hasReason ? (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="inline-flex items-center gap-1 rounded text-[12px] text-muted hover:text-fg"
          >
            <ChevronDown size={13} aria-hidden className={cx('transition-transform', expanded && 'rotate-180')} />
            추천 이유 {expanded ? '접기' : '펼치기'}
          </button>
          {expanded ? (
            <div className="fade-in mt-1.5 space-y-1.5 rounded-lg bg-bg/60 p-2.5 text-[12px] leading-5">
              {fit.summary ? <p>{fit.summary}</p> : null}
              {fit.ratings
                ? Object.entries(fit.ratings).map(([k, r]) => (
                    <p key={k} className="text-muted">
                      <span className="font-medium text-fg">{FIT_ITEM_LABEL[k] ?? k}</span>{' '}
                      <span className="tnum">{r.rating === null ? '평가 불가' : `${r.rating}/5`}</span> — {r.reason}
                    </p>
                  ))
                : null}
              <p className="text-[11px] text-muted">자체 적합도 점수(심사 점수 아님)</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
