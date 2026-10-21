import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AnalysisDTO, ExecutionDTO } from '@context/shared';
import { buildApp } from '../app.ts';
import { createSandbox, type Sandbox } from '../eval/sandbox.ts';
import { FakePostingDriver } from '../execution/fakeDriver.ts';

const PORT = 4399;
const ORIGIN = `http://127.0.0.1:${PORT}`;
let sbx: Sandbox;
let app: FastifyInstance;
let token: string;

async function api<T = unknown>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: T }> {
  const res = await app.inject({
    method: method as 'GET',
    url,
    headers: { host: `127.0.0.1:${PORT}`, origin: ORIGIN, 'x-csrf-token': token, 'content-type': 'application/json', ...headers },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
  return { status: res.statusCode, json: res.json() as T };
}

beforeAll(async () => {
  sbx = createSandbox({ driver: new FakePostingDriver('SUCCESS'), port: PORT });
  const built = await buildApp({ services: sbx });
  app = built.app;
  token = built.sessionToken;
});
afterAll(async () => {
  await app.close();
  await sbx.dispose();
});

describe('local API guard (TEST-SEC-03)', () => {
  it('rejects foreign Host headers (DNS rebinding)', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/health', headers: { host: 'evil.example:4399' } });
    expect(r.statusCode).toBe(421);
  });
  it('rejects cross-origin and missing CSRF on mutations', async () => {
    expect((await api('POST', '/api/videos/refresh', {}, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await api('POST', '/api/videos/refresh', {}, { 'x-csrf-token': 'wrong' })).status).toBe(403);
    expect((await api('POST', '/api/videos/refresh', {}, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    const noOrigin = await app.inject({ method: 'POST', url: '/api/videos/refresh', headers: { host: `127.0.0.1:${PORT}`, 'x-csrf-token': token } });
    expect(noOrigin.statusCode).toBe(403);
  });
  it('allows cross-site top-level navigation to the dashboard but not cross-site fetches', async () => {
    const nav = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: `127.0.0.1:${PORT}`, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    });
    expect(nav.statusCode).not.toBe(403);
    const fetchCross = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: `127.0.0.1:${PORT}`, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' },
    });
    expect(fetchCross.statusCode).toBe(403);
    const postNav = await app.inject({
      method: 'POST',
      url: '/api/videos/refresh',
      headers: { host: `127.0.0.1:${PORT}`, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
    });
    expect(postNav.statusCode).toBe(403);
  });
  it('percent-encoded /api path cannot bypass CSRF (/%61pi/...)', async () => {
    const r = await app.inject({ method: 'POST', url: '/%61pi/videos/refresh', headers: { host: `127.0.0.1:${PORT}` } });
    expect(r.statusCode).toBe(403);
    const r2 = await app.inject({ method: 'POST', url: '/%61pi/jobs/x123/cancel', headers: { host: `127.0.0.1:${PORT}`, origin: ORIGIN } });
    expect(r2.statusCode).toBe(403);
  });
  it('rejects model ids that could be parsed as CLI flags', async () => {
    const r = await api<{ error: { code: string } }>('PATCH', '/api/settings', { heavyModel: '--dangerously-skip-permissions' });
    expect(r.status).toBe(400);
  });
  it('health reveals key state only, never key values', async () => {
    await sbx.ctx.secrets.set('anthropic', 'dummy-secret-value-xyz');
    const h = await api<Record<string, unknown>>('GET', '/api/health');
    expect(h.status).toBe(200);
    expect(JSON.stringify(h.json)).not.toContain('dummy-secret-value-xyz');
    const s = await api('GET', '/api/settings');
    expect(JSON.stringify(s.json)).not.toContain('dummy-secret-value-xyz');
    const saved = await api('POST', '/api/settings/api-key', { provider: 'youtube', secret: 'another-dummy-secret-123' });
    expect(saved.json).toEqual({ provider: 'youtube', state: 'REGISTERED' });
    const audit = await api('GET', '/api/activity');
    expect(JSON.stringify(audit.json)).not.toContain('another-dummy-secret-123');
  });
});

describe('end-to-end API flow (TEST-UX-01 API level, TEST-CMT-01, TEST-POL-01/02, TEST-EXE-03)', () => {
  let videoId = '';
  let analysis: AnalysisDTO;

  it('refresh lists synthetic videos from the 5 allowlisted channels', async () => {
    const r = await api<{ state: string; fetched: number; source: string }>('POST', '/api/videos/refresh', {});
    expect(r.json).toMatchObject({ state: 'LIST_READY', source: 'SYNTHETIC' });
    expect(r.json.fetched).toBe(15);
    const list = await api<{ videos: { videoId: string; allowed: boolean; channelId: string }[] }>('GET', '/api/videos?sort=latest');
    expect(list.json.videos).toHaveLength(15);
    videoId = list.json.videos[0]!.videoId;
  });

  it('inspect-url rejects non-YouTube URLs', async () => {
    const r = await api<{ scope: string }>('POST', '/api/videos/inspect-url', { url: 'https://evil.example/watch?v=akn-AvCeHBI' });
    expect(r.json.scope).toBe('INVALID_URL');
  });

  // 결정 로그 18·CHG-2026-10-21-06: A등급이 없으면 제목·설명·자막 근거로만 PASS할 수 있고, "직접 확인 발언"을 주장하지 않는다.
  it('analysis without A-grade evidence never claims a directly verified scene', async () => {
    const r = await api<AnalysisDTO>('POST', '/api/analyses', { videoId });
    await sbx.queue.drain();
    analysis = (await api<AnalysisDTO>('GET', `/api/analyses/${r.json.id}`)).json;
    expect(analysis.status).toBe('COMPLETED');
    expect(analysis.evidenceState).toBe('PARTIAL');
    expect(analysis.candidates).toHaveLength(3);
    for (const c of analysis.candidates) {
      const scene = c.review?.hardChecks.find((h) => h.code === 'SCENE_REFERENCE');
      expect(scene?.message).not.toMatch(/직접 확인된 발언/);
      if (c.review?.status === 'PASS') expect(scene?.state).toBe('PASS');
    }
  });

  it('operator-verified quote (A) → re-analysis yields PASS candidates', async () => {
    const q = await api('POST', `/api/videos/${videoId}/evidence`, { text: '연락 빈도가 줄어도 약속을 지키면 괜찮아요', timestamp: '02:31' });
    expect(q.status).toBe(200);
    const bad = await api('POST', `/api/videos/${videoId}/evidence`, { text: '타임스탬프 오류 테스트', timestamp: '2분' });
    expect(bad.status).toBe(400);
    const old = await api<AnalysisDTO>('GET', `/api/analyses/${analysis.id}`);
    expect(old.json.stale).toBe(true);
    const r = await api<AnalysisDTO>('POST', '/api/analyses', { videoId });
    await sbx.queue.drain();
    analysis = (await api<AnalysisDTO>('GET', `/api/analyses/${r.json.id}`)).json;
    expect(analysis.evidenceState).toBe('VERIFIED');
    expect(analysis.candidates.some((c) => c.review?.status === 'PASS')).toBe(true);
  });

  let approvalId = '';
  let profileId = '';
  let targetId = '';
  it('approval requires verified own test target and PASS review; rejects third-party URLs', async () => {
    const profiles = await api<{ profiles: { id: string; alias: string }[] }>('GET', '/api/profiles');
    expect(profiles.json.profiles[0]!.alias).toBe('유튜브1');
    profileId = profiles.json.profiles[0]!.id;
    const third = await api<{ error: { code: string } }>('POST', '/api/targets', { url: 'https://youtu.be/akn-AvCeHBI', attestOwnership: true });
    expect(third.status).toBe(409);
    expect(third.json.error.code).toBe('OWNER_CHANNEL_REQUIRED');
    const t = await api<{ id: string; ownershipState: string }>('POST', '/api/targets', { fixture: { videoId: 'FIXTURE0001' } });
    expect(t.json.ownershipState).toBe('VERIFIED');
    targetId = t.json.id;
    const failing = analysis.candidates.find((c) => c.review?.status !== 'PASS');
    if (failing?.review) {
      const no = await api<{ error: { code: string } }>('POST', '/api/approvals', { revisionId: failing.latestRevision.id, reviewId: failing.review.id, testTargetId: targetId, profileId });
      expect(no.status).toBe(409);
    }
    const pass = analysis.candidates.find((c) => c.review?.status === 'PASS')!;
    const ok = await api<{ id: string; valid: boolean }>('POST', '/api/approvals', { revisionId: pass.latestRevision.id, reviewId: pass.review!.id, testTargetId: targetId, profileId });
    expect(ok.json.valid).toBe(true);
    approvalId = ok.json.id;
  });

  it('editing after approval invalidates it; execution with stale approval is blocked', async () => {
    const pass = analysis.candidates.find((c) => c.review?.status === 'PASS')!;
    const rev = await api<{ id: string; versionNo: number }>('POST', '/api/comments/revisions', { candidateId: pass.id, content: `${pass.latestRevision.content} ` + '정말요' });
    expect(rev.json.versionNo).toBe(2);
    const after = (await api<AnalysisDTO>('GET', `/api/analyses/${analysis.id}`)).json.candidates.find((c) => c.id === pass.id)!;
    expect(after.review).toBeNull();
    expect(after.approval?.valid).toBe(false);
    expect(after.approval?.invalidReason).toContain('댓글 수정');
    const blocked = await api<{ error: { code: string } }>('POST', '/api/executions/test', { approvalId, profileId, confirm: true, requestId: 'req_stale_000001' });
    expect(blocked.status).toBe(409);
    expect(blocked.json.error.code).toBe('APPROVAL_INVALID');
    // 재검증 → 재승인
    const job = await api<{ jobId: string }>('POST', '/api/comments/revalidate', { revisionId: rev.json.id });
    expect(job.json.jobId).toBeTruthy();
    await sbx.queue.drain();
    const fresh = (await api<AnalysisDTO>('GET', `/api/analyses/${analysis.id}`)).json.candidates.find((c) => c.id === pass.id)!;
    expect(fresh.review?.revisionId).toBe(rev.json.id);
    if (fresh.review?.status === 'PASS') {
      const ok = await api<{ id: string }>('POST', '/api/approvals', { revisionId: rev.json.id, reviewId: fresh.review.id, testTargetId: targetId, profileId });
      approvalId = ok.json.id;
    } else {
      // 편집본이 PASS가 아니면 원래 후보 중 다른 PASS 후보로 진행
      const other = analysis.candidates.find((c) => c.id !== pass.id && c.review?.status === 'PASS')!;
      const ok = await api<{ id: string }>('POST', '/api/approvals', { revisionId: other.latestRevision.id, reviewId: other.review!.id, testTargetId: targetId, profileId });
      approvalId = ok.json.id;
    }
  });

  it('requires explicit confirmation, executes once, is idempotent per requestId, and blocks a second post on the same video', async () => {
    const noConfirm = await api('POST', '/api/executions/test', { approvalId, profileId, confirm: false, requestId: 'req_noconfirm_01' });
    expect(noConfirm.status).toBe(400);
    const e = await api<ExecutionDTO>('POST', '/api/executions/test', { approvalId, profileId, confirm: true, requestId: 'req_first_000001' });
    expect(e.status).toBe(200);
    const again = await api<ExecutionDTO>('POST', '/api/executions/test', { approvalId, profileId, confirm: true, requestId: 'req_first_000001' });
    expect(again.json.id).toBe(e.json.id);
    const done = await sbx.executor.waitFor(e.json.id);
    expect(done.status).toBe('SUCCESS');
    const dup = await api<{ error: { code: string } }>('POST', '/api/executions/test', { approvalId, profileId, confirm: true, requestId: 'req_second_00001' });
    expect(dup.json.error.code).toBe('VIDEO_ALREADY_CLAIMED');
    const history = await api<{ executions: ExecutionDTO[] }>('GET', '/api/executions');
    expect(history.json.executions[0]!.events.map((x) => x.step)).toContain('VERIFYING');
    const health = await api<{ daily: { reserved: number } }>('GET', '/api/health');
    expect(health.json.daily.reserved).toBe(1);
    const audit = await api<{ events: { action: string }[] }>('GET', '/api/activity');
    const actions = audit.json.events.map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['APPROVED', 'EXECUTION_STARTED', 'POST_VERIFIED', 'PREFLIGHT_BLOCKED', 'REVISION_CREATED']));
  });

  it('usage, jobs and eval endpoints respond with measured state', async () => {
    const usage = await api<{ today: { calls: number }; budget: { state: string } }>('GET', '/api/ai/usage');
    expect(usage.json.today.calls).toBeGreaterThan(0);
    const jobs = await api<{ counts: Record<string, number> }>('GET', '/api/jobs');
    expect(jobs.json.counts.COMPLETED).toBeGreaterThan(0);
    const ds = await api<{ cases: { kind: string }[] }>('GET', '/api/eval/dataset');
    expect(ds.json.cases.filter((c) => c.kind === 'GOLDEN')).toHaveLength(15);
    const report = await api<{ gates: { id: string; state: string }[]; humanComparison: { state: string } }>('GET', '/api/eval/report');
    expect(report.json.gates.find((g) => g.id === 'G4')!.state).toBe('NOT_RUN');
    expect(report.json.humanComparison.state).toBe('NOT_MEASURED');
    const live = await api<{ error: { code: string } }>('POST', '/api/eval/runs', { kind: 'SINGLE', live: true });
    expect(live.json.error.code).toBe('LIVE_COST_CONFIRMATION');
  });
});
