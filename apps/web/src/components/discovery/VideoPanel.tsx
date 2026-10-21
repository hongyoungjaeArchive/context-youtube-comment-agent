import { useState, type CSSProperties } from 'react';
import { CheckCircle2, CloudDownload, Film, XCircle } from 'lucide-react';
import { ALLOWED_CHANNELS, type VideoDTO } from '@context/shared';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { isActiveJobStatus, qk, useJobs, useVideos } from '../../api/queries.ts';
import type { RefreshResult, VideoSort } from '../../api/types.ts';
import { fmtTime } from '../../lib/format.ts';
import { Badge, Button, EmptyState, Notice, Panel, SectionLabel, Spinner } from '../ui/primitives.tsx';
import { ServerError } from '../ui/overlay.tsx';
import { TrendFinder } from './TrendFinder.tsx';
import { UrlInspector } from './UrlInspector.tsx';
import { VideoCard } from './VideoCard.tsx';

interface Props {
  readonly selectedVideoId: string | null;
  readonly onSelect: (videoId: string) => void;
  readonly className?: string;
}

const SORTS: readonly { value: VideoSort; label: string }[] = [
  { value: 'recommended', label: '추천순' },
  { value: 'latest', label: '최신순' },
  { value: 'channel', label: '채널별' },
];

const REFRESH_TONE = { LIST_READY: 'success', PARTIAL: 'warning', ERROR: 'danger' } as const;

function RefreshSummary({ result, at }: { result: RefreshResult; at: string }) {
  return (
    <div className="space-y-1.5 rounded-lg border border-line bg-bg/40 p-2.5" data-testid="refresh-result">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <Badge tone={REFRESH_TONE[result.state]} icon>
          {result.state}
        </Badge>
        <span className="text-muted tnum">
          {result.fetched}개 수집 · {fmtTime(at)} 갱신 · 적합도 평가 {result.scoringQueued}건 대기열
        </span>
        {result.source === 'SYNTHETIC' ? <Badge tone="warning">합성 데이터</Badge> : null}
      </div>
      <ul className="grid gap-0.5 text-[12px]">
        {result.channels.map((c) => (
          <li key={c.channelId} className="flex items-center gap-1.5">
            {c.ok ? <CheckCircle2 size={12} className="text-success" aria-label="성공" /> : <XCircle size={12} className="text-danger" aria-label="실패" />}
            <span className="truncate">{c.name}</span>
            <span className="ml-auto text-muted tnum">{c.ok ? `${c.count}개` : (c.error ?? '오류')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VideoList({ videos, selectedVideoId, onSelect }: { videos: readonly VideoDTO[]; selectedVideoId: string | null; onSelect: (id: string) => void }) {
  return (
    <ul className="stagger space-y-2" aria-label="영상 목록">
      {videos.map((v, i) => (
        <li key={v.videoId} style={{ '--i': i } as CSSProperties}>
          <VideoCard video={v} selected={v.videoId === selectedVideoId} onSelect={onSelect} />
        </li>
      ))}
    </ul>
  );
}

export function VideoPanel({ selectedVideoId, onSelect, className }: Props) {
  const [sort, setSort] = useState<VideoSort>('recommended');
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const refresh = useApiMutation(() => api.post<RefreshResult>('/api/videos/refresh'), {
    invalidate: [['videos'], qk.jobs, qk.health],
    onSuccess: () => setRefreshedAt(new Date().toISOString()),
  });
  const jobs = useJobs();
  const scoring = jobs.data?.jobs.some((j) => j.type === 'VIDEO_FIT' && isActiveJobStatus(j.status)) ?? false;
  const videos = useVideos(sort, scoring);
  const list = videos.data?.videos ?? [];
  const pendingCount = list.filter((v) => v.fit.state === 'PENDING').length;
  const lastSeen = list.reduce<string | null>((max, v) => (max === null || v.lastSeenAt > max ? v.lastSeenAt : max), null);

  return (
    <Panel
      step="1"
      title="영상 탐색"
      labelledBy="panel-discovery"
      className={className}
      actions={
        <Button variant="primary" onClick={() => refresh.mutate()} loading={refresh.isPending} icon={<CloudDownload size={15} aria-hidden />} data-testid="refresh-videos">
          영상 불러오기
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-[12px] text-muted">
            지정 5개 채널의 최신 영상(채널당 최대 10개)을 불러옵니다. 마지막 갱신{' '}
            <span className="text-fg tnum">{refreshedAt ? fmtTime(refreshedAt) : lastSeen ? fmtTime(lastSeen) : '없음'}</span>
          </p>
          <div className="flex flex-wrap gap-1">
            {ALLOWED_CHANNELS.map((c) => (
              <span key={c.channelId} className="rounded-md border border-line px-1.5 py-px text-[11px] text-muted">
                {c.name}
              </span>
            ))}
          </div>
        </div>

        <ServerError error={refresh.error} />
        {refresh.data ? <RefreshSummary result={refresh.data} at={refreshedAt ?? ''} /> : null}

        <UrlInspector onFound={onSelect} />
        <TrendFinder selectedVideoId={selectedVideoId} onSelect={onSelect} />

        <div>
          <SectionLabel
            right={
              <div role="radiogroup" aria-label="정렬" className="flex rounded-lg border border-line p-0.5">
                {SORTS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    role="radio"
                    aria-checked={sort === s.value}
                    onClick={() => setSort(s.value)}
                    className={`h-7 rounded-md px-2 text-[12px] ${sort === s.value ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'}`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            }
          >
            영상 {list.length > 0 ? <span className="tnum">{list.length}</span> : null}
          </SectionLabel>
          {pendingCount > 0 ? (
            <Notice tone="neutral" className="mb-2">
              적합도 평가 대기 {pendingCount}개 — 평가 전에는 점수를 0점으로 표시하지 않습니다.
            </Notice>
          ) : null}
          {videos.isLoading ? (
            <Spinner label="영상 목록 불러오는 중" />
          ) : videos.isError ? (
            <Notice tone="danger">영상 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</Notice>
          ) : list.length === 0 ? (
            <EmptyState icon={<Film size={22} aria-hidden />} title="아직 불러온 영상이 없습니다" hint="[영상 불러오기]로 지정 채널의 최신 영상을 가져오거나 URL을 직접 입력하세요." />
          ) : (
            <VideoList videos={list} selectedVideoId={selectedVideoId} onSelect={onSelect} />
          )}
        </div>
      </div>
    </Panel>
  );
}
