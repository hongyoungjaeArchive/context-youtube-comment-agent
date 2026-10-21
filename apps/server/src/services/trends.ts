import { ALLOWED_CHANNEL_IDS, TREND_RULES, type VideoDTO } from '@context/shared';
import { YouTubeError } from '../clients/youtube.ts';
import type { AppContext } from '../context.ts';
import { AppError } from '../lib/errors.ts';
import { computeTrend, toVideoDTO, upsertVideo, videoRow, type VideoRow } from '../agents/research.ts';

/** 조회수 상한 ÷ 시간당 하한 ≈ 33시간 — 그보다 오래된 영상은 조건을 만족할 수 없어 검색 창을 36시간으로 둔다. */
export const TREND_WINDOW_HOURS = 36;

export interface TrendSearchResult {
  readonly videos: VideoDTO[];
  readonly scanned: number;
}

/**
 * 과제 가점: '연애' 키워드로 뜨기 직전 영상 찾기 (조회수 1,000~5,000 · 시간당 150 이상, 초안까지만).
 * 지정 채널 밖 영상은 allowed=0 + trend_videos로 저장해 분석만 허용하고 승인·게시는 막는다.
 */
export async function findRisingVideos(ctx: AppContext): Promise<TrendSearchResult> {
  const now = ctx.clock();
  const publishedAfter = new Date(now.getTime() - TREND_WINDOW_HOURS * 3600_000).toISOString();
  const yt = await ctx.getYouTube();
  try {
    const ids = await yt.searchRecentVideoIds(TREND_RULES.keyword, publishedAfter);
    const metas = await yt.getVideos(ids);
    const rising = metas.filter((m) => computeTrend(m, now).isRising);
    for (const m of rising) {
      upsertVideo(ctx, m, yt.mode, ALLOWED_CHANNEL_IDS.has(m.channelId));
      ctx.db.prepare('INSERT OR IGNORE INTO trend_videos (video_id, keyword, found_at) VALUES (?, ?, ?)').run(m.videoId, TREND_RULES.keyword, now.toISOString());
    }
    ctx.audit.record('videos', 'trend-search', 'TREND_SEARCHED', 'OPERATOR', { scanned: metas.length, rising: rising.length });
    return { videos: rising.map((m) => toVideoDTO(ctx, videoRow(ctx, m.videoId)!)), scanned: metas.length };
  } catch (error) {
    if (error instanceof YouTubeError) throw new AppError(`YOUTUBE_${error.code}`, error.message, 502);
    throw error;
  }
}

/** 지금까지 찾은 뜨기 직전 영상 (최근 발견순). */
export function listTrendVideos(ctx: AppContext): VideoDTO[] {
  const rows = ctx.db
    .prepare('SELECT v.* FROM videos v JOIN trend_videos t ON t.video_id = v.video_id ORDER BY t.found_at DESC, v.published_at DESC')
    .all() as VideoRow[];
  return rows.map((r) => toVideoDTO(ctx, r));
}
