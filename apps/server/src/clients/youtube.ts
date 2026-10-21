import { ALLOWED_CHANNELS } from '@context/shared';

export interface YtVideoMeta {
  readonly videoId: string;
  readonly channelId: string;
  readonly channelTitle: string;
  readonly title: string;
  readonly description: string;
  readonly thumbnailUrl: string | null;
  readonly publishedAt: string;
  readonly viewCount: number | null;
  readonly commentCount: number | null;
}

export interface YtComment {
  readonly commentId: string;
  readonly text: string;
  readonly likeCount: number;
}

export type YtErrorCode = 'QUOTA_EXCEEDED' | 'NOT_FOUND' | 'COMMENTS_DISABLED' | 'FORBIDDEN' | 'NETWORK' | 'BAD_RESPONSE' | 'NO_KEY';

export class YouTubeError extends Error {
  readonly code: YtErrorCode;
  constructor(code: YtErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface YouTubeClient {
  readonly mode: 'LIVE' | 'SYNTHETIC';
  getUploadsPlaylistId(channelId: string): Promise<string>;
  listPlaylistVideoIds(playlistId: string, max: number): Promise<string[]>;
  getVideos(videoIds: readonly string[]): Promise<YtVideoMeta[]>;
  listTopComments(videoId: string, max: number): Promise<YtComment[]>;
  /** 키워드로 최근 공개 영상 ID 검색 (search.list, 100 unit). publishedAfter는 ISO 시각. */
  searchRecentVideoIds(query: string, publishedAfter: string): Promise<string[]>;
}

const API_BASE = 'https://www.googleapis.com/youtube/v3';

interface YtListResponse<T> {
  items?: T[];
  error?: { code: number; message: string; errors?: { reason?: string }[] };
}

/** YouTube Data API v3 (API 키 방식). 키는 URL query가 아닌 X-Goog-Api-Key 헤더로만 전달한다. */
export class HttpYouTubeClient implements YouTubeClient {
  readonly mode = 'LIVE' as const;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  constructor(apiKey: string, fetchImpl: typeof fetch = fetch) {
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  private async call<T>(resource: string, params: Record<string, string>): Promise<T[]> {
    const url = `${API_BASE}/${resource}?${new URLSearchParams(params).toString()}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, { headers: { 'X-Goog-Api-Key': this.apiKey, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new YouTubeError('NETWORK', `YouTube API(${resource}) 네트워크 오류`);
    }
    const body = (await res.json().catch(() => ({}))) as YtListResponse<T>;
    if (!res.ok || body.error) {
      const reason = body.error?.errors?.[0]?.reason ?? '';
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') throw new YouTubeError('QUOTA_EXCEEDED', 'YouTube API 할당량을 초과했습니다.');
      if (reason === 'commentsDisabled') throw new YouTubeError('COMMENTS_DISABLED', '이 영상은 댓글이 비활성화되어 있습니다.');
      if (res.status === 404 || reason.endsWith('NotFound')) throw new YouTubeError('NOT_FOUND', '요청한 YouTube 리소스를 찾을 수 없습니다.');
      if (res.status === 403) throw new YouTubeError('FORBIDDEN', `YouTube API 접근 거부 (${reason || res.status})`);
      throw new YouTubeError('BAD_RESPONSE', `YouTube API 오류 (${res.status})`);
    }
    return body.items ?? [];
  }

  async getUploadsPlaylistId(channelId: string): Promise<string> {
    const items = await this.call<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }>('channels', { part: 'contentDetails', id: channelId });
    const uploads = items[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) throw new YouTubeError('NOT_FOUND', `채널 ${channelId}의 업로드 목록을 찾을 수 없습니다.`);
    return uploads;
  }

  async listPlaylistVideoIds(playlistId: string, max: number): Promise<string[]> {
    const items = await this.call<{ contentDetails?: { videoId?: string } }>('playlistItems', {
      part: 'contentDetails',
      playlistId,
      maxResults: String(Math.min(max, 50)),
    });
    return items.map((i) => i.contentDetails?.videoId).filter((v): v is string => Boolean(v));
  }

  async searchRecentVideoIds(query: string, publishedAfter: string): Promise<string[]> {
    const items = await this.call<{ id?: { videoId?: string } }>('search', {
      part: 'id',
      type: 'video',
      q: query,
      order: 'date',
      publishedAfter,
      regionCode: 'KR',
      relevanceLanguage: 'ko',
      maxResults: '50',
    });
    return items.map((i) => i.id?.videoId).filter((v): v is string => Boolean(v));
  }

  async getVideos(videoIds: readonly string[]): Promise<YtVideoMeta[]> {
    if (videoIds.length === 0) return [];
    const items = await this.call<RawVideo>('videos', { part: 'snippet,statistics', id: videoIds.slice(0, 50).join(',') });
    return items.map(toVideoMeta);
  }

  async listTopComments(videoId: string, max: number): Promise<YtComment[]> {
    const items = await this.call<RawCommentThread>('commentThreads', {
      part: 'snippet',
      videoId,
      order: 'relevance',
      textFormat: 'plainText',
      maxResults: String(Math.min(max, 50)),
    });
    return items
      .map((t) => ({
        commentId: t.id ?? '',
        text: t.snippet?.topLevelComment?.snippet?.textOriginal ?? t.snippet?.topLevelComment?.snippet?.textDisplay ?? '',
        likeCount: t.snippet?.topLevelComment?.snippet?.likeCount ?? 0,
      }))
      .filter((c) => c.commentId && c.text.trim());
  }
}

interface RawVideo {
  id: string;
  snippet?: {
    channelId?: string;
    channelTitle?: string;
    title?: string;
    description?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  statistics?: { viewCount?: string; commentCount?: string };
}

interface RawCommentThread {
  id?: string;
  snippet?: { topLevelComment?: { snippet?: { textOriginal?: string; textDisplay?: string; likeCount?: number } } };
}

function toVideoMeta(v: RawVideo): YtVideoMeta {
  const thumbs = v.snippet?.thumbnails ?? {};
  const thumb = thumbs.medium?.url ?? thumbs.high?.url ?? thumbs.default?.url ?? null;
  const num = (s?: string) => (s === undefined ? null : Number(s));
  return {
    videoId: v.id,
    channelId: v.snippet?.channelId ?? '',
    channelTitle: v.snippet?.channelTitle ?? '',
    title: v.snippet?.title ?? '',
    description: v.snippet?.description ?? '',
    thumbnailUrl: thumb,
    publishedAt: v.snippet?.publishedAt ?? new Date(0).toISOString(),
    viewCount: num(v.statistics?.viewCount),
    commentCount: num(v.statistics?.commentCount),
  };
}

/**
 * 키가 없을 때 쓰는 합성(SYNTHETIC) 데이터 클라이언트.
 * 실제 영상이 아니며 UI·DB 모두 source=SYNTHETIC 으로 표시한다. 실제 성과로 쓰지 말 것.
 */
export class SyntheticYouTubeClient implements YouTubeClient {
  readonly mode = 'SYNTHETIC' as const;
  private readonly videos: YtVideoMeta[];
  private readonly comments: Map<string, YtComment[]>;

  constructor(now: Date = new Date()) {
    const topics = [
      ['연락이 줄어든 남자친구, 마음이 식은 걸까?', '연락 빈도가 줄었을 때 상대 마음을 확인하는 방법을 이야기합니다.'],
      ['헤어진 연인에게 다시 연락해도 될까', '재회를 고민할 때 스스로에게 던져야 할 질문들.'],
      ['썸만 3개월째, 고백 타이밍은 언제?', '애매한 관계를 끝내고 싶은 분들을 위한 연애 상담.'],
    ];
    this.videos = [];
    this.comments = new Map();
    ALLOWED_CHANNELS.forEach((ch, ci) => {
      topics.forEach(([title, desc], ti) => {
        const id = `SYN${ci}${ti}xxxxxx`.slice(0, 11);
        const published = new Date(now.getTime() - (ci * 3 + ti + 1) * 6 * 3600_000).toISOString();
        this.videos.push({
          videoId: id,
          channelId: ch.channelId,
          channelTitle: ch.name,
          title: `[합성 데이터] ${title}`,
          description: `[SYNTHETIC — 실제 영상 아님] ${desc}`,
          thumbnailUrl: null,
          publishedAt: published,
          viewCount: 800 + ci * 900 + ti * 450,
          commentCount: 10 + ti,
        });
        this.comments.set(id, [
          { commentId: `${id}-c1`, text: '[합성 댓글] 저도 똑같은 상황이라 너무 공감돼요.', likeCount: 12 },
          { commentId: `${id}-c2`, text: '[합성 댓글] 결국 타이밍이 중요한 것 같아요.', likeCount: 5 },
        ]);
      });
    });
    // 지정 채널 밖의 '연애' 영상 1개: 10시간 전 업로드·조회 2,400 → 시간당 240 (뜨기 직전 찾기 시연용).
    this.videos.push({
      videoId: 'SYNTRENDxxx',
      channelId: 'UCsyntheticTrendChannel0',
      channelTitle: '합성 채널',
      title: '[합성 데이터] 연애 초반 연락이 줄었을 때 해야 할 말',
      description: '[SYNTHETIC — 실제 영상 아님] 연애 초반 고민 상담.',
      thumbnailUrl: null,
      publishedAt: new Date(now.getTime() - 10 * 3600_000).toISOString(),
      viewCount: 2400,
      commentCount: 4,
    });
  }

  async getUploadsPlaylistId(channelId: string): Promise<string> {
    return `UU${channelId.slice(2)}`;
  }

  async listPlaylistVideoIds(playlistId: string, max: number): Promise<string[]> {
    const channelId = `UC${playlistId.slice(2)}`;
    return this.videos.filter((v) => v.channelId === channelId).slice(0, max).map((v) => v.videoId);
  }

  async getVideos(videoIds: readonly string[]): Promise<YtVideoMeta[]> {
    return this.videos.filter((v) => videoIds.includes(v.videoId));
  }

  async listTopComments(videoId: string, max: number): Promise<YtComment[]> {
    return (this.comments.get(videoId) ?? []).slice(0, max);
  }

  async searchRecentVideoIds(query: string, publishedAfter: string): Promise<string[]> {
    return this.videos.filter((v) => v.title.includes(query) && v.publishedAt >= publishedAfter).map((v) => v.videoId);
  }
}
