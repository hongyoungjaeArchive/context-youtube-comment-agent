import { afterEach, describe, expect, it } from 'vitest';
import { MockLlmClient } from '../clients/mockLlm.ts';
import { createSandbox, seedVideo, type Sandbox } from '../eval/sandbox.ts';
import { updateBudgetPolicy, usageSummary } from '../orchestrator/budget.ts';
import { PRIORITY } from '../orchestrator/queue.ts';
import { getAnalysis, startAnalysis } from '../services/analysis.ts';
import { HttpYouTubeClient } from '../clients/youtube.ts';
import { refreshVideos } from '../agents/research.ts';
import type { LlmClient, LlmRequest, LlmResponse } from '../clients/llm.ts';
import { LlmError } from '../clients/llm.ts';

let sbx: Sandbox | null = null;
afterEach(async () => {
  await sbx?.dispose();
  sbx = null;
});

function seed(s: Sandbox, id = 'ORC00000001') {
  seedVideo(s.ctx, { videoId: id, title: '[합성] 썸 고백 타이밍', evidence: [{ grade: 'B', sourceType: 'TITLE', text: '[합성] 썸 고백 타이밍' }, { grade: 'A', sourceType: 'OPERATOR_QUOTE', text: '고백은 확신이 생겼을 때 하세요', timestamp: '00:45' }] });
  return id;
}

describe('JobQueue & pipeline (TEST-OPS-01, TEST-AI-01, TEST-AI-05)', () => {
  it('runs Context → Marketing → Quality with dependencies and produces 3 strategy candidates', async () => {
    sbx = createSandbox();
    const id = seed(sbx);
    const a = await startAnalysis(sbx.ctx, sbx.queue, id);
    await sbx.queue.drain();
    const done = getAnalysis(sbx.ctx, a.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.coreProblem).toBeTruthy();
    expect(done.candidates.map((c) => c.strategy)).toEqual(['EMPATHY', 'QUESTION', 'INFO']);
    expect(done.candidates.every((c) => c.review !== null)).toBe(true);
    expect(done.evidenceState).toBe('VERIFIED');
    const types = sbx.ctx.db.prepare('SELECT job_type, status FROM ai_jobs ORDER BY created_at').all() as { job_type: string; status: string }[];
    expect(types.every((t) => t.status === 'COMPLETED')).toBe(true);
  });

  it('is idempotent: same evidence + prompt returns the same analysis (refresh does not restart)', async () => {
    sbx = createSandbox();
    const id = seed(sbx);
    const a1 = await startAnalysis(sbx.ctx, sbx.queue, id);
    const a2 = await startAnalysis(sbx.ctx, sbx.queue, id);
    expect(a2.id).toBe(a1.id);
    const n = sbx.ctx.db.prepare('SELECT COUNT(*) n FROM ai_jobs').get() as { n: number };
    expect(n.n).toBe(3);
  });

  it('orders by priority (P0 revalidate before P4 prescore)', () => {
    sbx = createSandbox();
    const low = sbx.queue.enqueue({ type: 'VIDEO_FIT', subjectId: 'x', priority: PRIORITY.PRESCORE, idempotencyKey: 'low' });
    const high = sbx.queue.enqueue({ type: 'VIDEO_FIT', subjectId: 'y', priority: PRIORITY.REVALIDATE, idempotencyKey: 'high' });
    const rows = sbx.ctx.db.prepare("SELECT job_id FROM ai_jobs WHERE status='QUEUED' ORDER BY priority, created_at").all() as { job_id: string }[];
    expect(rows[0]!.job_id).toBe(high.job.job_id);
    expect(rows[1]!.job_id).toBe(low.job.job_id);
  });

  it('caches results: second identical call is a cache hit with zero cost', async () => {
    const llm = new MockLlmClient();
    sbx = createSandbox({ llm });
    const id = seed(sbx);
    await startAnalysis(sbx.ctx, sbx.queue, id);
    await sbx.queue.drain();
    const callsAfterFirst = llm.calls.length;
    await startAnalysis(sbx.ctx, sbx.queue, id, { force: true });
    await sbx.queue.drain();
    const hits = sbx.ctx.db.prepare('SELECT COUNT(*) n FROM ai_usage WHERE cache_hit = 1').get() as { n: number };
    expect(hits.n).toBeGreaterThanOrEqual(2);
    expect(llm.calls.length).toBeLessThan(callsAfterFirst * 2);
    expect(usageSummary(sbx.ctx).today.cacheHits).toBe(hits.n);
  });

  it('blocks new AI work when the LIVE budget would be exceeded (BUDGET_BLOCKED)', async () => {
    const live: LlmClient = { mode: 'LIVE', provider: 'ANTHROPIC_API', billing: 'METERED', generate: (r) => new MockLlmClient().generate(r) };
    sbx = createSandbox({ llm: live });
    updateBudgetPolicy(sbx.ctx, { dailyLimitUsd: 0.000001, monthlyLimitUsd: 20, warningRatio: 0.7 });
    const id = seed(sbx);
    const a = await startAnalysis(sbx.ctx, sbx.queue, id);
    await sbx.queue.drain();
    expect(getAnalysis(sbx.ctx, a.id).status).toBe('BUDGET_BLOCKED');
    const job = sbx.ctx.db.prepare("SELECT status FROM ai_jobs WHERE job_type='CONTEXT'").get() as { status: string };
    expect(job.status).toBe('BUDGET_BLOCKED');
  });

  it('falls back to the approved alternative model only on MODEL_UNAVAILABLE', async () => {
    const seen: string[] = [];
    const inner = new MockLlmClient();
    const llm: LlmClient = {
      mode: 'MOCK',
      provider: 'MOCK',
      billing: 'NONE',
      async generate<T>(r: LlmRequest<T>): Promise<LlmResponse<T>> {
        seen.push(r.model);
        if (r.model === 'claude-sonnet-5-5') throw new LlmError('MODEL_UNAVAILABLE', 'nope');
        return inner.generate(r);
      },
    };
    sbx = createSandbox({ llm });
    const id = seed(sbx);
    const a = await startAnalysis(sbx.ctx, sbx.queue, id);
    await sbx.queue.drain();
    expect(getAnalysis(sbx.ctx, a.id).status).toBe('COMPLETED');
    expect(seen).toContain('claude-sonnet-5');
  });

  it('auth errors fail immediately without retry', async () => {
    const llm = new MockLlmClient([{ kind: 'AUTH', role: 'CONTEXT' }]);
    sbx = createSandbox({ llm });
    const id = seed(sbx);
    const a = await startAnalysis(sbx.ctx, sbx.queue, id);
    await sbx.queue.drain();
    const job = sbx.ctx.db.prepare("SELECT status, attempt_count, error_code FROM ai_jobs WHERE job_type='CONTEXT'").get() as { status: string; attempt_count: number; error_code: string };
    expect(job).toMatchObject({ status: 'FAILED', attempt_count: 1, error_code: 'AUTH' });
    const after = getAnalysis(sbx.ctx, a.id);
    expect(after.status).toBe('FAILED');
    const marketing = sbx.ctx.db.prepare("SELECT status FROM ai_jobs WHERE job_type='MARKETING'").get() as { status: string };
    expect(marketing.status).toBe('FAILED');
  });

  it('recovers RUNNING jobs with expired lease after a crash', () => {
    sbx = createSandbox();
    const j = sbx.queue.enqueue({ type: 'VIDEO_FIT', subjectId: 'x', priority: 4, idempotencyKey: 'crash' });
    sbx.ctx.db.prepare("UPDATE ai_jobs SET status='RUNNING', lease_until='2000-01-01T00:00:00.000Z' WHERE job_id=?").run(j.job.job_id);
    expect(sbx.queue.recover()).toBe(1);
    expect(sbx.queue.get(j.job.job_id)!.status).toBe('RETRY_SCHEDULED');
  });
});

describe('YouTube client (REQ-VID-001)', () => {
  it('sends the key only in the X-Goog-Api-Key header, never in the URL, and keeps channel invariants', async () => {
    const urls: string[] = [];
    const headers: string[] = [];
    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      headers.push(String((init?.headers as Record<string, string>)['X-Goog-Api-Key']));
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url.includes('/channels?')) {
        const id = new URL(url).searchParams.get('id')!;
        return json({ items: [{ contentDetails: { relatedPlaylists: { uploads: `UU${id.slice(2)}` } } }] });
      }
      if (url.includes('/playlistItems?')) return json({ items: [{ contentDetails: { videoId: 'AAAAAAAAAAA' } }] });
      if (url.includes('/videos?')) return json({ items: [{ id: 'AAAAAAAAAAA', snippet: { channelId: 'UCxlc0Ky0aWoD8uI09ad44Tg', channelTitle: '외롭여', title: '연애 테스트', description: '', publishedAt: '2026-10-19T00:00:00Z', thumbnails: {} }, statistics: { viewCount: '10' } }] });
      return json({ items: [] });
    }) as typeof fetch;
    const testKey = 'test-key-not-real-0000';
    const client = new HttpYouTubeClient(testKey, fakeFetch);
    sbx = createSandbox();
    const ctx = { ...sbx.ctx, getYouTube: async () => client };
    const result = await refreshVideos(ctx);
    expect(urls.every((u) => !u.includes(testKey) && !u.includes('key='))).toBe(true);
    expect(headers.every((h) => h === testKey)).toBe(true);
    // 5개 채널 중 응답 채널이 일치하는 1개만 저장 (나머지 4개 채널은 다른 channelId를 받았으므로 0건)
    expect(result.channels).toHaveLength(5);
    expect(result.fetched).toBe(1);
  });

  it('maps quota errors and stops early', async () => {
    const fakeFetch = (async () => new Response(JSON.stringify({ error: { code: 403, message: 'q', errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 })) as typeof fetch;
    sbx = createSandbox();
    const ctx = { ...sbx.ctx, getYouTube: async () => new HttpYouTubeClient('k', fakeFetch) };
    const result = await refreshVideos(ctx);
    expect(result.state).toBe('ERROR');
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]!.error).toContain('할당량');
  });
});
