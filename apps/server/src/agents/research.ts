import { chunkTranscript } from '../clients/transcript.ts';
import {
  ALLOWED_CHANNELS,
  ALLOWED_CHANNEL_IDS,
  DISCOVERY_LIMITS,
  TREND_RULES,
  VIDEO_FIT_WEIGHTS,
  VideoFitOutputSchema,
  isValidChannelId,
  parseVideoId,
  type PromptVersion,
  type VideoDTO,
  type VideoFitDTO,
  type VideoFitOutput,
} from '@context/shared';
import { YouTubeError, type YtVideoMeta } from '../clients/youtube.ts';
import type { AppContext } from '../context.ts';
import { AppError } from '../lib/errors.ts';
import { newId, sha256, stableStringify } from '../lib/ids.ts';
import { runAgentCall } from '../orchestrator/llmRunner.ts';
import { insertEvidence, listEvidence } from '../services/evidence.ts';
import { systemPrompt, untrusted } from './prompts.ts';

const ROMANCE_KEYWORDS = ['연애', '연락', '이별', '재회', '썸', '고백', '남자', '여자', '사랑', '헤어', '남친', '여친', '결혼', '짝사랑', '심리', '인연', '전남친', '전여친', '권태'];
const MAX_COMMENTS = 15;

export interface VideoRow {
  video_id: string;
  channel_id: string;
  channel_name: string;
  title: string;
  description: string;
  thumbnail_url: string | null;
  published_at: string;
  view_count: number | null;
  comment_count: number | null;
  source: 'LIVE' | 'SYNTHETIC';
  allowed: number;
  fit_json: string | null;
  last_seen_at: string;
}

export interface RefreshResult {
  readonly state: 'LIST_READY' | 'PARTIAL' | 'ERROR';
  readonly source: 'LIVE' | 'SYNTHETIC';
  readonly fetched: number;
  readonly channels: readonly { channelId: string; name: string; ok: boolean; count: number; error: string | null }[];
  readonly scoringQueued: number;
}

export function keywordHits(title: string, description: string): string[] {
  const text = `${title} ${description}`;
  return ROMANCE_KEYWORDS.filter((k) => text.includes(k));
}

export function computeTrend(meta: { viewCount: number | null; publishedAt: string; title: string; description: string }, now: Date) {
  if (meta.viewCount === null) return { isRising: false, viewsPerHour: null };
  const hours = Math.max((now.getTime() - new Date(meta.publishedAt).getTime()) / 3600_000, 1);
  const viewsPerHour = Math.round(meta.viewCount / hours);
  const hasKeyword = `${meta.title} ${meta.description}`.includes(TREND_RULES.keyword);
  const isRising = hasKeyword && meta.viewCount >= TREND_RULES.minViews && meta.viewCount <= TREND_RULES.maxViews && viewsPerHour >= TREND_RULES.minViewsPerHour;
  return { isRising, viewsPerHour };
}

/** docs/05 §3: Claude 0~5 정성 점수 → 코드가 가중 합산. 하나라도 null이면 NOT_ASSESSED (0점 위장 금지). */
export function scoreFit(output: VideoFitOutput): Pick<VideoFitDTO, 'state' | 'score' | 'tier'> {
  const entries = Object.entries(VIDEO_FIT_WEIGHTS) as [keyof typeof VIDEO_FIT_WEIGHTS, number][];
  if (entries.some(([k]) => output.ratings[k].rating === null)) return { state: 'NOT_ASSESSED', score: null, tier: null };
  const score = Math.round(entries.reduce((sum, [k, w]) => sum + (w * (output.ratings[k].rating ?? 0)) / 5, 0));
  return { state: 'SCORED', score, tier: score >= 80 ? 'PRIORITY' : score >= 60 ? 'NORMAL' : 'LOW' };
}

function channelName(channelId: string, fallback: string): string {
  return ALLOWED_CHANNELS.find((c) => c.channelId === channelId)?.name ?? fallback;
}

export function upsertVideo(ctx: AppContext, meta: YtVideoMeta, source: 'LIVE' | 'SYNTHETIC', allowed: boolean): void {
  const now = ctx.clock().toISOString();
  ctx.db
    .prepare(
      `INSERT INTO videos (video_id, channel_id, channel_name, title, description, thumbnail_url, published_at, view_count, comment_count, source, allowed, first_seen_at, last_seen_at)
       VALUES (@videoId,@channelId,@channelName,@title,@description,@thumbnailUrl,@publishedAt,@viewCount,@commentCount,@source,@allowed,@now,@now)
       ON CONFLICT(video_id) DO UPDATE SET title=excluded.title, description=excluded.description, thumbnail_url=excluded.thumbnail_url,
       view_count=excluded.view_count, comment_count=excluded.comment_count, last_seen_at=excluded.last_seen_at, allowed=excluded.allowed, source=excluded.source`,
    )
    .run({ ...meta, channelName: channelName(meta.channelId, meta.channelTitle), source, allowed: allowed ? 1 : 0, now });
  const metaHash = sha256(stableStringify({ title: meta.title, description: meta.description, publishedAt: meta.publishedAt, channelId: meta.channelId }));
  ctx.db
    .prepare('INSERT OR IGNORE INTO video_snapshots (snapshot_id, video_id, meta_hash, source_json, created_at) VALUES (?,?,?,?,?)')
    .run(newId('snap'), meta.videoId, metaHash, JSON.stringify({ ...meta, source }), now);
  insertEvidence(ctx, { videoId: meta.videoId, sourceType: 'TITLE', text: meta.title, grade: 'B', verifiedBy: `YOUTUBE_API_${source}` });
  if (meta.description.trim()) {
    insertEvidence(ctx, { videoId: meta.videoId, sourceType: 'DESCRIPTION', text: meta.description, grade: 'B', verifiedBy: `YOUTUBE_API_${source}` });
  }
}

/** [영상 불러오기]: 지정 5개 채널 uploads playlist → 최신 영상 메타데이터 (REQ-VID-001). */
export async function refreshVideos(ctx: AppContext): Promise<RefreshResult> {
  const yt = await ctx.getYouTube();
  const channels: { channelId: string; name: string; ok: boolean; count: number; error: string | null }[] = [];
  let fetched = 0;
  for (const ch of ALLOWED_CHANNELS) {
    if (fetched >= DISCOVERY_LIMITS.maxTotal) break;
    try {
      const playlistId = await yt.getUploadsPlaylistId(ch.channelId);
      const ids = await yt.listPlaylistVideoIds(playlistId, DISCOVERY_LIMITS.perChannel);
      const metas = await yt.getVideos(ids);
      let count = 0;
      for (const meta of metas) {
        // 응답 채널이 요청 채널과 다르면 저장하지 않는다 (채널 불변 확인).
        if (meta.channelId !== ch.channelId) continue;
        upsertVideo(ctx, meta, yt.mode, true);
        count++;
      }
      fetched += count;
      channels.push({ channelId: ch.channelId, name: ch.name, ok: true, count, error: null });
    } catch (error) {
      const message = error instanceof YouTubeError ? error.message : '알 수 없는 오류';
      channels.push({ channelId: ch.channelId, name: ch.name, ok: false, count: 0, error: message });
      if (error instanceof YouTubeError && error.code === 'QUOTA_EXCEEDED') break;
    }
  }
  const okCount = channels.filter((c) => c.ok).length;
  const state = okCount === ALLOWED_CHANNELS.length ? 'LIST_READY' : okCount === 0 ? 'ERROR' : 'PARTIAL';
  ctx.audit.record('videos', 'refresh', 'VIDEOS_REFRESHED', 'OPERATOR', { state, fetched, source: yt.mode });
  return { state, source: yt.mode, fetched, channels, scoringQueued: 0 };
}

export function videoRow(ctx: AppContext, videoId: string): VideoRow | null {
  return (ctx.db.prepare('SELECT * FROM videos WHERE video_id = ?').get(videoId) as VideoRow | undefined) ?? null;
}

export function isDraftOnly(ctx: AppContext, r: Pick<VideoRow, 'video_id' | 'allowed'>): boolean {
  return r.allowed === 0 && ctx.db.prepare('SELECT 1 FROM trend_videos WHERE video_id = ?').get(r.video_id) !== undefined;
}

export function toVideoDTO(ctx: AppContext, r: VideoRow): VideoDTO {
  const fit = r.fit_json ? (JSON.parse(r.fit_json) as VideoFitDTO) : null;
  const hits = keywordHits(r.title, r.description);
  const latest = ctx.db.prepare('SELECT analysis_id FROM video_analyses WHERE video_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(r.video_id) as
    | { analysis_id: string }
    | undefined;
  return {
    videoId: r.video_id,
    channelId: r.channel_id,
    channelName: r.channel_name,
    title: r.title,
    description: r.description,
    thumbnailUrl: r.thumbnail_url,
    publishedAt: r.published_at,
    viewCount: r.view_count,
    commentCount: r.comment_count,
    source: r.source,
    allowed: r.allowed === 1,
    draftOnly: isDraftOnly(ctx, r),
    fit: fit ?? { state: 'PENDING', score: null, tier: null, summary: null, ratings: null, keywordHits: hits },
    trend: computeTrend({ viewCount: r.view_count, publishedAt: r.published_at, title: r.title, description: r.description }, ctx.clock()),
    lastSeenAt: r.last_seen_at,
    latestAnalysisId: latest?.analysis_id ?? null,
  };
}

export function listVideos(ctx: AppContext, sort: 'recommended' | 'latest' | 'channel' = 'recommended'): VideoDTO[] {
  // 뜨기 직전 찾기로 들어온 지정 채널 밖 영상은 기본 목록에서 뺀다 (listTrendVideos에서 따로 보여줌).
  const rows = ctx.db
    .prepare('SELECT * FROM videos WHERE NOT (allowed = 0 AND video_id IN (SELECT video_id FROM trend_videos)) ORDER BY published_at DESC')
    .all() as VideoRow[];
  const dtos = rows.map((r) => toVideoDTO(ctx, r));
  if (sort === 'latest') return dtos;
  if (sort === 'channel') return [...dtos].sort((a, b) => a.channelName.localeCompare(b.channelName, 'ko') || b.publishedAt.localeCompare(a.publishedAt));
  return [...dtos].sort((a, b) => (b.fit.score ?? -1) - (a.fit.score ?? -1) || b.fit.keywordHits.length - a.fit.keywordHits.length || b.publishedAt.localeCompare(a.publishedAt));
}

/** 예비 평가 대상: 키워드 기반 상위 N개 (점수 없는 것만). docs/03 §2: 15개 예비 평가. */
export function selectForPrescore(ctx: AppContext, limit: number = DISCOVERY_LIMITS.preScoreCount): string[] {
  const rows = ctx.db.prepare('SELECT * FROM videos WHERE allowed = 1 AND fit_json IS NULL ORDER BY published_at DESC').all() as VideoRow[];
  return rows
    .map((r) => ({ id: r.video_id, hits: keywordHits(r.title, r.description).length }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((r) => r.id);
}

/** Haiku 예비 적합도 평가 (VIDEO_FIT 작업 핸들러). */
export async function scoreVideoFit(ctx: AppContext, videoId: string, jobId: string, attemptId: string, promptVersion: PromptVersion): Promise<string> {
  const r = videoRow(ctx, videoId);
  if (!r) throw new AppError('NOT_FOUND', '영상을 찾을 수 없습니다.', 404);
  const input = { title: r.title, description: r.description.slice(0, 800), channel: r.channel_name, viewCount: r.view_count, commentCount: r.comment_count };
  const result = await runAgentCall(ctx, {
    jobId,
    attemptId,
    role: 'RESEARCH',
    tier: 'light',
    system: systemPrompt(promptVersion, 'RESEARCH'),
    prompt: `다음 영상의 적합도를 평가하라.\n${untrusted('video_metadata', input)}`,
    schema: VideoFitOutputSchema,
    maxTokens: 1500,
    input,
    promptVersion,
    dataHash: sha256(stableStringify(input)),
  });
  const scored = scoreFit(result.data);
  const fit: VideoFitDTO = { ...scored, summary: result.data.summary, ratings: result.data.ratings, keywordHits: keywordHits(r.title, r.description) };
  ctx.db.prepare('UPDATE videos SET fit_json = ? WHERE video_id = ?').run(JSON.stringify(fit), videoId);
  return result.modelId;
}

export interface InspectResult {
  readonly videoId: string | null;
  readonly channelId: string | null;
  readonly scope: 'ALLOWED_CHANNEL' | 'OWN_TEST_CHANNEL' | 'NOT_ALLOWED' | 'INVALID_URL' | 'NOT_FOUND';
  readonly message: string;
  readonly video: VideoDTO | null;
}

/** URL 직접 입력: Video ID 정규화 + 채널 확인 (REQ-VID-002). 허용 외 채널은 저장·분석하지 않는다. */
export async function inspectUrl(ctx: AppContext, url: string): Promise<InspectResult> {
  const videoId = parseVideoId(url);
  if (!videoId) return { videoId: null, channelId: null, scope: 'INVALID_URL', message: 'YouTube 영상 URL 또는 11자리 Video ID가 아닙니다.', video: null };
  const yt = await ctx.getYouTube();
  const metas = await yt.getVideos([videoId]).catch((e: unknown) => {
    if (e instanceof YouTubeError) throw new AppError(`YOUTUBE_${e.code}`, e.message, 502);
    throw e;
  });
  const meta = metas[0];
  if (!meta) return { videoId, channelId: null, scope: 'NOT_FOUND', message: '영상을 찾을 수 없거나 비공개입니다.', video: null };
  const owner = ctx.settings.get().ownerChannelId;
  const allowed = ALLOWED_CHANNEL_IDS.has(meta.channelId);
  const own = owner !== null && isValidChannelId(owner) && meta.channelId === owner;
  ctx.audit.record('videos', videoId, 'URL_INSPECTED', 'OPERATOR', { channelId: meta.channelId, allowed, own });
  if (!allowed && !own) {
    return { videoId, channelId: meta.channelId, scope: 'NOT_ALLOWED', message: '지정 채널 5개 또는 등록된 본인 채널의 영상이 아닙니다. 분석·게시가 차단됩니다.', video: null };
  }
  upsertVideo(ctx, meta, yt.mode, true);
  return {
    videoId,
    channelId: meta.channelId,
    scope: allowed ? 'ALLOWED_CHANNEL' : 'OWN_TEST_CHANNEL',
    message: allowed ? '지정 채널 영상입니다.' : '본인 테스트 채널 영상입니다.',
    video: toVideoDTO(ctx, videoRow(ctx, videoId)!),
  };
}

/** 선택 영상의 근거 수집: 공개 자막 구간(B, 타임스탬프) + 제목·설명(B) + 관련도순 댓글(C). 과제 기준 "자막(없으면 제목·설명)". */
export async function collectEvidence(ctx: AppContext, videoId: string): Promise<{ limitations: string[] }> {
  const r = videoRow(ctx, videoId);
  if (!r) throw new AppError('NOT_FOUND', '영상을 찾을 수 없습니다.', 404);
  const limitations: string[] = await collectTranscript(ctx, videoId);
  const existingComments = listEvidence(ctx, videoId).filter((e) => e.sourceType === 'COMMENT').length;
  if (existingComments === 0) {
    const yt = await ctx.getYouTube();
    try {
      const comments = await yt.listTopComments(videoId, MAX_COMMENTS);
      for (const c of comments) insertEvidence(ctx, { videoId, sourceType: 'COMMENT', text: c.text, grade: 'C', verifiedBy: `YOUTUBE_API_${yt.mode}` });
      if (comments.length === 0) limitations.push('접근 가능한 댓글이 없습니다.');
    } catch (error) {
      if (error instanceof YouTubeError && error.code === 'COMMENTS_DISABLED') limitations.push('댓글이 비활성화된 영상입니다.');
      else limitations.push(`댓글 수집 실패: ${error instanceof Error ? error.message : '알 수 없음'}`);
    }
  }
  return { limitations };
}

/** 자막을 45초 구간으로 나눠 TRANSCRIPT(B) 근거로 한 번만 저장한다. 실패해도 분석은 제목·설명·댓글로 계속한다. */
async function collectTranscript(ctx: AppContext, videoId: string): Promise<string[]> {
  if (listEvidence(ctx, videoId).some((e) => e.sourceType === 'TRANSCRIPT')) return [];
  try {
    const cues = await (await ctx.getTranscripts()).fetch(videoId);
    if (!cues) return ['자막이 없어 제목·설명·댓글로 분석합니다.'];
    for (const chunk of chunkTranscript(cues)) {
      insertEvidence(ctx, { videoId, sourceType: 'TRANSCRIPT', text: chunk.text, grade: 'B', verifiedBy: 'YOUTUBE_SUBTITLES', timestamp: chunk.timestamp });
    }
    return [];
  } catch (error) {
    return [`자막 수집 실패: ${error instanceof Error ? error.message : '알 수 없음'} — 제목·설명·댓글로 분석합니다.`];
  }
}
