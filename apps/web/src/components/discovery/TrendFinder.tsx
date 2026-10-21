import { useState, type CSSProperties } from 'react';
import { ChevronDown, Flame } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { TREND_RULES, type VideoDTO } from '@context/shared';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { cx, fmtCount } from '../../lib/format.ts';
import { Button, Notice } from '../ui/primitives.tsx';
import { ServerError } from '../ui/overlay.tsx';
import { VideoCard } from './VideoCard.tsx';

interface Props {
  readonly selectedVideoId: string | null;
  readonly onSelect: (videoId: string) => void;
}

const TRENDS_KEY = ['trends'] as const;

/** 과제 가점: '연애' 키워드로 뜨기 직전 영상 찾기 — 지정 채널 밖 영상은 초안까지만 (서버가 승인을 막는다). */
export function TrendFinder({ selectedVideoId, onSelect }: Props) {
  const trends = useQuery({ queryKey: TRENDS_KEY, queryFn: () => api.get<{ videos: readonly VideoDTO[] }>('/api/trends') });
  // 기본 목록(지정 5개 채널)을 밀어내지 않도록 결과는 접어 두고, 방금 찾았을 때만 펼친다.
  const [open, setOpen] = useState(false);
  const search = useApiMutation(() => api.post<{ videos: readonly VideoDTO[]; scanned: number }>('/api/trends/search'), {
    invalidate: [TRENDS_KEY],
    onSuccess: () => setOpen(true),
  });
  const list = trends.data?.videos ?? [];

  return (
    <section aria-label="뜨기 직전 영상" className="space-y-2 rounded-card border border-line bg-elevated/40 p-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-[12px] text-muted">
          ‘{TREND_RULES.keyword}’ 최신 영상 중 조회수 {fmtCount(TREND_RULES.minViews)}~{fmtCount(TREND_RULES.maxViews)} · 시간당 {TREND_RULES.minViewsPerHour} 이상. 초안까지만 만듭니다.
        </p>
        <Button size="sm" variant="secondary" data-testid="trend-search" icon={<Flame size={13} aria-hidden />} onClick={() => search.mutate()} loading={search.isPending}>
          뜨기 직전 찾기
        </Button>
      </div>
      <ServerError error={search.error} />
      {search.data ? (
        <p className="text-[12px] text-muted tnum" data-testid="trend-summary">
          최근 영상 {search.data.scanned}개 확인 → 조건 충족 {search.data.videos.length}개
        </p>
      ) : null}
      {search.data && list.length === 0 ? <Notice tone="neutral">지금은 조건을 만족하는 영상이 없습니다.</Notice> : null}
      {list.length > 0 ? (
        <button
          type="button"
          aria-expanded={open}
          data-testid="trend-toggle"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg"
        >
          <ChevronDown size={13} aria-hidden className={cx('transition-transform', open && 'rotate-180')} />
          찾은 영상 {list.length}개 {open ? '접기' : '보기'}
        </button>
      ) : null}
      {open && list.length > 0 ? (
        <ul data-testid="trend-list" className="stagger space-y-2" aria-label="뜨기 직전 영상 목록">
          {list.map((v, i) => (
            <li key={v.videoId} style={{ '--i': i } as CSSProperties}>
              <VideoCard video={v} selected={v.videoId === selectedVideoId} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
