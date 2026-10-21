import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { OPERATION_LIMITS } from '@context/shared';
import { MockLlmClient } from '../clients/mockLlm.ts';
import { backupDatabase } from '../db/database.ts';
import { approve } from '../execution/approvals.ts';
import { FakePostingDriver, type FakeScript } from '../execution/fakeDriver.ts';
import { createProfile } from '../execution/profiles.ts';
import { registerTarget } from '../execution/targets.ts';
import { AppError } from '../lib/errors.ts';
import { addOperatorQuote } from '../services/evidence.ts';
import { createRevision, getAnalysis, startAnalysis } from '../services/analysis.ts';
import { HallucinationInjectingLlm } from './faultLlm.ts';
import { createSandbox, seedVideo, type Sandbox } from './sandbox.ts';
import type { LlmClient } from '../clients/llm.ts';

export interface ScenarioResult {
  readonly id: string;
  readonly title: string;
  readonly testId: string;
  readonly passed: boolean;
  readonly detail: string;
}

let videoSeq = 0;
function nextVideoId(): string {
  videoSeq++;
  return `FLT${String(videoSeq).padStart(8, '0')}`;
}

const SEED_QUOTES = [
  '연락 빈도보다 약속을 지키는지가 중요해요',
  '바쁘다는 말 뒤에 숨은 우선순위를 보세요',
  '서운함은 말로 해야 상대가 알아요',
  '재회는 같은 문제를 풀 수 있을 때만 의미 있어요',
  '썸이 길어지면 확신이 없다는 신호예요',
  '먼저 연락하는 쪽이 지는 게 아니에요',
  '헤어진 이유를 먼저 정리해 보세요',
  '애매한 관계는 기준을 정해야 끝나요',
  '상대의 행동이 말보다 정확해요',
  '혼자 기대하고 혼자 실망하지 마세요',
  '좋아하는 마음을 시험하지 마세요',
  '불안할수록 내 생활 리듬을 지키세요',
];

export async function seedPassingCandidate(sbx: Sandbox, videoId = nextVideoId()) {
  const quote = SEED_QUOTES[videoSeq % SEED_QUOTES.length]!;
  seedVideo(sbx.ctx, {
    videoId,
    title: '[합성] 연락이 줄어든 남자친구의 속마음',
    evidence: [
      { grade: 'B', sourceType: 'TITLE', text: '[합성] 연락이 줄어든 남자친구의 속마음' },
      { grade: 'A', sourceType: 'OPERATOR_QUOTE', text: quote, timestamp: '01:23' },
    ],
  });
  const started = await startAnalysis(sbx.ctx, sbx.queue, videoId);
  await sbx.queue.drain();
  const analysis = getAnalysis(sbx.ctx, started.id);
  const cand = analysis.candidates.find((c) => c.review?.status === 'PASS');
  if (!cand || !cand.review) throw new Error(`PASS 후보가 없습니다: ${JSON.stringify(analysis.candidates.map((c) => c.review?.hardChecks))}`);
  return { videoId, analysis, candidate: cand, review: cand.review };
}

let fixtureSeq = 0;
export async function seedApproval(sbx: Sandbox, opts: { profileId?: string; fixtureVideoId?: string } = {}) {
  const { videoId, candidate, review, analysis } = await seedPassingCandidate(sbx);
  const profileId = opts.profileId ?? (sbx.ctx.db.prepare('SELECT profile_id FROM browser_profiles ORDER BY created_at LIMIT 1').get() as { profile_id: string }).profile_id;
  fixtureSeq++;
  const fixtureVideoId = opts.fixtureVideoId ?? `FIXTURE${String(fixtureSeq % 10000).padStart(4, '0')}`;
  const existing = sbx.ctx.db.prepare('SELECT target_id FROM test_targets WHERE video_id = ?').get(fixtureVideoId) as { target_id: string } | undefined;
  const targetId = existing?.target_id ?? (await registerTarget(sbx.ctx, { url: '', attestOwnership: true, fixture: { videoId: fixtureVideoId } })).id;
  const approval = approve(sbx.ctx, { revisionId: candidate.latestRevision.id, reviewId: review.id, testTargetId: targetId, profileId });
  return { videoId, candidate, review, analysis, profileId, targetId, approval, fixtureVideoId };
}

function reqId(): string {
  return `req_${Math.random().toString(36).slice(2, 12)}`;
}

async function expectBlocked(fn: () => unknown, code: string): Promise<{ ok: boolean; got: string }> {
  try {
    await fn();
    return { ok: false, got: '차단되지 않음' };
  } catch (e) {
    const got = e instanceof AppError ? e.code : String(e);
    return { ok: got === code, got };
  }
}

type Scenario = { id: string; title: string; testId: string; run: () => Promise<{ passed: boolean; detail: string }> };

function withSandbox(opts: Parameters<typeof createSandbox>[0], fn: (sbx: Sandbox) => Promise<{ passed: boolean; detail: string }>) {
  return async () => {
    const sbx = createSandbox(opts);
    try {
      return await fn(sbx);
    } finally {
      await sbx.dispose();
    }
  };
}

/** docs/13 §6 장애 주입 10종. 실제 코드 경로를 격리 환경에서 실행하고 결과를 그대로 기록한다. */
export function faultScenarios(): Scenario[] {
  return [
    {
      id: 'F01', title: 'Claude 429 → 재시도 예약·예산 예약 해제', testId: 'TEST-OPS-01',
      run: withSandbox({ llm: new MockLlmClient([{ kind: 'RATE_LIMITED', retryAfterMs: 1, role: 'CONTEXT' }]) }, async (sbx) => {
        const r = await seedPassingCandidate(sbx);
        const jobs = sbx.ctx.db.prepare("SELECT status, attempt_count FROM ai_jobs WHERE job_type='CONTEXT'").get() as { status: string; attempt_count: number };
        const open = sbx.ctx.db.prepare('SELECT COUNT(*) n FROM budget_reservations WHERE released_at IS NULL').get() as { n: number };
        const passed = jobs.status === 'COMPLETED' && jobs.attempt_count === 2 && open.n === 0 && r.analysis.status === 'COMPLETED';
        return { passed, detail: `CONTEXT 작업 ${jobs.status}, 시도 ${jobs.attempt_count}회, 미해제 예약 ${open.n}건` };
      }),
    },
    {
      id: 'F02', title: '5xx/타임아웃 → 오케스트레이터만 재시도(최대 3회)', testId: 'TEST-OPS-01',
      run: async () => {
        const llm = new MockLlmClient([
          { kind: 'SERVER', role: 'CONTEXT' },
          { kind: 'TIMEOUT', role: 'CONTEXT' },
          { kind: 'SERVER', role: 'CONTEXT' },
        ]);
        const sbx = createSandbox({ llm });
        try {
          const vid = nextVideoId();
          seedVideo(sbx.ctx, { videoId: vid, title: '[합성] 이별 후 연락', evidence: [{ grade: 'B', sourceType: 'TITLE', text: '[합성] 이별 후 연락' }] });
          const a = await startAnalysis(sbx.ctx, sbx.queue, vid);
          for (let i = 0; i < 40; i++) {
            await sbx.queue.drain();
            const s = sbx.ctx.db.prepare("SELECT status FROM ai_jobs WHERE job_type='CONTEXT'").get() as { status: string };
            if (['FAILED', 'COMPLETED'].includes(s.status)) break;
            sbx.ctx.db.prepare("UPDATE ai_jobs SET run_after = NULL WHERE status='RETRY_SCHEDULED'").run();
          }
          const job = sbx.ctx.db.prepare("SELECT status, attempt_count FROM ai_jobs WHERE job_type='CONTEXT'").get() as { status: string; attempt_count: number };
          const calls = llm.calls.filter((c) => c.role === 'CONTEXT').length;
          const analysis = getAnalysis(sbx.ctx, a.id);
          const passed = job.status === 'FAILED' && job.attempt_count === 3 && calls === 3 && analysis.status === 'FAILED';
          return { passed, detail: `CONTEXT ${job.status}, 시도 ${job.attempt_count}회, 실제 호출 ${calls}회 (SDK 재시도 0), 분석 ${analysis.status}` };
        } finally {
          await sbx.dispose();
        }
      },
    },
    {
      id: 'F03', title: '유효 JSON + 허위 인용 → 근거 대조에서 차단', testId: 'TEST-AI-02',
      run: withSandbox({ llm: new HallucinationInjectingLlm(new MockLlmClient()) }, async (sbx) => {
        const vid = nextVideoId();
        seedVideo(sbx.ctx, { videoId: vid, title: '[합성] 썸 고백 타이밍', evidence: [{ grade: 'B', sourceType: 'TITLE', text: '[합성] 썸 고백 타이밍' }, { grade: 'A', sourceType: 'OPERATOR_QUOTE', text: '고백은 확신이 생겼을 때 하세요', timestamp: '00:45' }] });
        const a = await startAnalysis(sbx.ctx, sbx.queue, vid);
        await sbx.queue.drain();
        const res = getAnalysis(sbx.ctx, a.id);
        const blocked = res.candidates.filter((c) => c.review?.hardChecks.some((h) => h.code === 'QUOTE_MATCH' && h.state === 'BLOCK'));
        const anyPass = res.candidates.some((c) => c.review?.status === 'PASS');
        return { passed: blocked.length === 3 && !anyPass, detail: `허위 인용 차단 ${blocked.length}/3, PASS 후보 ${anyPass ? '있음' : '없음'}` };
      }),
    },
    {
      id: 'F04', title: '근거 스냅샷 변경 → 평가 stale·승인 무효화', testId: 'TEST-SEC-05',
      run: withSandbox({}, async (sbx) => {
        const s = await seedApproval(sbx);
        addOperatorQuote(sbx.ctx, s.videoId, '새로 확인한 발언이 추가되었어요', '03:00');
        const after = getAnalysis(sbx.ctx, s.analysis.id).candidates.find((c) => c.id === s.candidate.id)!;
        const r = await expectBlocked(() => sbx.executor.start({ approvalId: s.approval.id, profileId: s.profileId, confirm: true, requestId: reqId() }), 'APPROVAL_INVALID');
        const passed = after.review?.stale === true && after.approval?.valid === false && r.ok;
        return { passed, detail: `리뷰 stale=${String(after.review?.stale)}, 승인 유효=${String(after.approval?.valid)}, 실행 차단 코드=${r.got}` };
      }),
    },
    {
      id: 'F05', title: '승인 후 본문 1글자 수정 → 실행 차단', testId: 'TEST-CMT-01',
      run: withSandbox({}, async (sbx) => {
        const s = await seedApproval(sbx);
        createRevision(sbx.ctx, s.candidate.id, `${s.candidate.latestRevision.content.slice(0, -1)}!`);
        const r = await expectBlocked(() => sbx.executor.start({ approvalId: s.approval.id, profileId: s.profileId, confirm: true, requestId: reqId() }), 'APPROVAL_INVALID');
        return { passed: r.ok, detail: `실행 차단 코드=${r.got}` };
      }),
    },
    {
      id: 'F06', title: '두 프로필이 같은 영상에 동시 제출 → claim 1개만', testId: 'TEST-POL-02',
      run: withSandbox({}, async (sbx) => {
        const p2 = createProfile(sbx.ctx, '유튜브2');
        const s1 = await seedApproval(sbx, { fixtureVideoId: 'FIXTURE9001' });
        const s2 = await seedApproval(sbx, { profileId: p2.id, fixtureVideoId: 'FIXTURE9001' });
        const e1 = sbx.executor.start({ approvalId: s1.approval.id, profileId: s1.profileId, confirm: true, requestId: reqId() });
        const r = await expectBlocked(() => sbx.executor.start({ approvalId: s2.approval.id, profileId: p2.id, confirm: true, requestId: reqId() }), 'VIDEO_ALREADY_CLAIMED');
        await sbx.executor.waitAll();
        const claims = sbx.ctx.db.prepare("SELECT COUNT(*) n FROM posting_claims WHERE video_id='FIXTURE9001'").get() as { n: number };
        return { passed: r.ok && claims.n === 1 && Boolean(e1.id), detail: `두 번째 요청 ${r.got}, claim ${claims.n}개` };
      }),
    },
    {
      id: 'F07', title: '일일 10번째 허용 / 11번째 차단', testId: 'TEST-POL-02',
      run: withSandbox({}, async (sbx) => {
        const results: string[] = [];
        for (let i = 0; i < OPERATION_LIMITS.dailyMaxComments; i++) {
          const s = await seedApproval(sbx, { fixtureVideoId: `FIXTURE7${String(i).padStart(3, '0')}` });
          sbx.executor.start({ approvalId: s.approval.id, profileId: s.profileId, confirm: true, requestId: reqId() });
          await sbx.executor.waitAll();
          results.push('ok');
        }
        const s11 = await seedApproval(sbx, { fixtureVideoId: 'FIXTURE7999' });
        const r = await expectBlocked(() => sbx.executor.start({ approvalId: s11.approval.id, profileId: s11.profileId, confirm: true, requestId: reqId() }), 'DAILY_LIMIT');
        const usage = sbx.ctx.db.prepare('SELECT submit_attempts_reserved n FROM daily_usage').get() as { n: number };
        return { passed: results.length === 10 && r.ok && usage.n === 10, detail: `허용 ${results.length}건, 11번째 ${r.got}, 예약 카운트 ${usage.n}` };
      }),
    },
    {
      id: 'F08', title: '제출 직후 크래시 → UNKNOWN, 재게시 차단', testId: 'TEST-EXE-03',
      run: withSandbox({ driver: new FakePostingDriver('CRASH_AFTER_SUBMIT') }, async (sbx) => {
        const s = await seedApproval(sbx);
        const e = sbx.executor.start({ approvalId: s.approval.id, profileId: s.profileId, confirm: true, requestId: reqId() });
        const done = await sbx.executor.waitFor(e.id);
        const r = await expectBlocked(() => sbx.executor.start({ approvalId: s.approval.id, profileId: s.profileId, confirm: true, requestId: reqId() }), 'VIDEO_ALREADY_CLAIMED');
        // 앱 재시작 복구 경로: 진행 중 상태로 강제한 뒤 recover()
        sbx.ctx.db.prepare("UPDATE execution_jobs SET status='VERIFYING' WHERE execution_id=?").run(e.id);
        sbx.executor.recover();
        const recovered = sbx.executor.get(e.id);
        return { passed: done.status === 'UNKNOWN' && r.ok && recovered.status === 'UNKNOWN', detail: `결과 ${done.status}, 재실행 ${r.got}, 재시작 복구 후 ${recovered.status}` };
      }),
    },
    {
      id: 'F09', title: 'Chrome 로그인 만료 / CAPTCHA → 우회 없이 중단', testId: 'TEST-EXE-02',
      run: async () => {
        const out: string[] = [];
        let passed = true;
        for (const [script, expected] of [['AUTH_REQUIRED', 'AUTH_REQUIRED'], ['CAPTCHA', 'FAILED_PRE_SUBMIT']] as [FakeScript, string][]) {
          const driver = new FakePostingDriver(script);
          const sbx = createSandbox({ driver });
          try {
            const s = await seedApproval(sbx);
            const e = sbx.executor.start({ approvalId: s.approval.id, profileId: s.profileId, confirm: true, requestId: reqId() });
            const done = await sbx.executor.waitFor(e.id);
            const claim = sbx.ctx.db.prepare('SELECT status FROM posting_claims WHERE video_id = ?').get(s.fixtureVideoId) as { status: string };
            const ok = done.status === expected && claim.status === 'PRE_SUBMIT_FAILED' && driver.runs.length === 1;
            passed &&= ok;
            out.push(`${script}→${done.status}/claim ${claim.status}/시도 ${driver.runs.length}회`);
          } finally {
            await sbx.dispose();
          }
        }
        return { passed, detail: out.join(', ') };
      },
    },
    {
      id: 'F10', title: 'SQLite WAL 상태 일관성 백업·복원', testId: 'TEST-DATA-01',
      run: withSandbox({ fileDb: true }, async (sbx) => {
        await seedPassingCandidate(sbx);
        const before = sbx.ctx.db.prepare('SELECT COUNT(*) n FROM comment_revisions').get() as { n: number };
        const dest = path.join(sbx.dir, 'backups', 'backup.db');
        await backupDatabase(sbx.ctx.db, dest);
        const restored = new Database(dest, { readonly: true });
        const after = restored.prepare('SELECT COUNT(*) n FROM comment_revisions').get() as { n: number };
        const integrity = restored.pragma('integrity_check', { simple: true });
        restored.close();
        const mode = (fs.statSync(dest).mode & 0o777).toString(8);
        return { passed: before.n === after.n && before.n > 0 && integrity === 'ok' && mode === '600', detail: `원본 ${before.n}건 = 백업 ${after.n}건, integrity=${String(integrity)}, 권한 ${mode}` };
      }),
    },
  ];
}

export async function runFaultScenarios(): Promise<ScenarioResult[]> {
  const out: ScenarioResult[] = [];
  for (const s of faultScenarios()) {
    try {
      const r = await s.run();
      out.push({ id: s.id, title: s.title, testId: s.testId, ...r });
    } catch (error) {
      out.push({ id: s.id, title: s.title, testId: s.testId, passed: false, detail: `예외: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  return out;
}

export type { LlmClient };
