import { afterEach, describe, expect, it } from 'vitest';
import type { YouTubeClient, YtVideoMeta } from '../clients/youtube.ts';
import { listVideos } from '../agents/research.ts';
import { assertApprovable } from '../execution/approvals.ts';
import { startAnalysis } from '../services/analysis.ts';
import { findRisingVideos, listTrendVideos } from '../services/trends.ts';
import { createSandbox, type Sandbox } from '../eval/sandbox.ts';

const NOW = new Date('2026-10-21T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();
const meta = (videoId: string, title: string, viewCount: number, ageHours: number): YtVideoMeta => ({
  videoId,
  channelId: 'UCzzzzzzzzzzzzzzzzzzzzzz',
  channelTitle: '다른 채널',
  title,
  description: '',
  thumbnailUrl: null,
  publishedAt: hoursAgo(ageHours),
  viewCount,
  commentCount: 3,
});

const METAS = [
  meta('RISEaaaaaaa', '연애 초반에 연락 줄면', 2400, 10), // 240/h → 뜨기 직전
  meta('OLDaaaaaaaa', '연애 고민 상담', 4800, 34), // 141/h → 속도 미달
  meta('MANYaaaaaaa', '연애 심리 총정리', 9000, 5), // 조회수 초과
  meta('NOKWaaaaaaa', '남자 심리 분석', 2000, 5), // 키워드 없음
];

function stubYouTube(calls: { q: string; publishedAfter: string }[]): YouTubeClient {
  return {
    mode: 'LIVE',
    getUploadsPlaylistId: async () => '',
    listPlaylistVideoIds: async () => [],
    getVideos: async (ids) => METAS.filter((m) => ids.includes(m.videoId)),
    listTopComments: async () => [],
    searchRecentVideoIds: async (q, publishedAfter) => {
      calls.push({ q, publishedAfter });
      return METAS.map((m) => m.videoId);
    },
  };
}

describe('뜨기 직전 영상 찾기 (TEST-TREND-02)', () => {
  let sbx: Sandbox | null = null;
  afterEach(async () => {
    await sbx?.dispose();
    sbx = null;
  });

  function setup() {
    const calls: { q: string; publishedAfter: string }[] = [];
    sbx = createSandbox({ clock: () => NOW });
    const ctx = { ...sbx.ctx, getYouTube: async () => stubYouTube(calls) };
    return { ctx, calls, sbx };
  }

  it("searches '연애' within the last 36 hours and keeps only 1,000~5,000 views at 150+/hour", async () => {
    const { ctx, calls } = setup();
    const r = await findRisingVideos(ctx);
    expect(calls).toEqual([{ q: '연애', publishedAfter: hoursAgo(36) }]);
    expect(r.scanned).toBe(4);
    expect(r.videos.map((v) => v.videoId)).toEqual(['RISEaaaaaaa']);
    expect(r.videos[0]!.draftOnly).toBe(true);
    expect(r.videos[0]!.trend.isRising).toBe(true);
  });

  it('keeps rising videos out of the main list but lists them separately', async () => {
    const { ctx } = setup();
    await findRisingVideos(ctx);
    expect(listVideos(ctx).map((v) => v.videoId)).not.toContain('RISEaaaaaaa');
    expect(listTrendVideos(ctx).map((v) => v.videoId)).toEqual(['RISEaaaaaaa']);
  });

  it('allows a draft analysis but blocks approval (초안까지만)', async () => {
    const { ctx, sbx: s } = setup();
    await findRisingVideos(ctx);
    const analysis = await startAnalysis(ctx, s.queue, 'RISEaaaaaaa');
    await s.queue.drain();
    const row = ctx.db
      .prepare(
        `SELECT r.revision_id, q.review_id FROM comment_revisions r JOIN comment_candidates c ON c.candidate_id = r.candidate_id
         JOIN quality_reviews q ON q.revision_id = r.revision_id WHERE c.analysis_id = ? LIMIT 1`,
      )
      .get(analysis.id) as { revision_id: string; review_id: string };
    expect(() => assertApprovable(ctx, row.revision_id, row.review_id)).toThrow(expect.objectContaining({ code: 'TREND_DRAFT_ONLY' }));
  });
});

describe('trend API in synthetic mode (TEST-TREND-02)', () => {
  it('POST /api/trends/search finds the synthetic rising video and GET /api/trends lists it', async () => {
    const { buildApp } = await import('../app.ts');
    const sbx = createSandbox({ port: 4391 });
    const { app, sessionToken } = await buildApp({ services: sbx });
    const headers = { host: '127.0.0.1:4391', origin: 'http://127.0.0.1:4391', 'x-csrf-token': sessionToken };
    try {
      const found = await app.inject({ method: 'POST', url: '/api/trends/search', headers });
      expect(found.statusCode).toBe(200);
      expect(found.json().videos.map((v: { videoId: string }) => v.videoId)).toEqual(['SYNTRENDxxx']);
      const listed = await app.inject({ method: 'GET', url: '/api/trends', headers });
      expect(listed.json().videos[0].draftOnly).toBe(true);
    } finally {
      await app.close();
      await sbx.dispose();
    }
  });
});
