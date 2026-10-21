import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.ts';
import { createSandbox, type Sandbox } from '../eval/sandbox.ts';
import { PlaywrightPostingDriver } from '../execution/playwrightDriver.ts';
import type { DriverStep } from '../execution/driver.ts';
import { seedApproval } from '../eval/scenarios.ts';
import { fixtureUrl } from '../execution/targets.ts';

/** TEST-EXE-01(픽스처)/TEST-EXE-02: 실제 Chromium으로 로컬 가짜 YouTube 댓글 UI에 한 글자씩 입력·게시·확인. 실제 YouTube 미사용. */
const PORT = 4391;
let sbx: Sandbox;
let app: FastifyInstance;

beforeAll(async () => {
  sbx = createSandbox({ driver: new PlaywrightPostingDriver(), port: PORT });
  app = (await buildApp({ services: sbx })).app;
  await app.listen({ host: '127.0.0.1', port: PORT });
});
afterAll(async () => {
  await app.close();
  await sbx.dispose();
});

const CONTENT = '"연락 빈도보다 약속을 지키는지가 중요해요" 이 말 듣고 마음이 놓였어요. 운명원 연애사주로 제 흐름도 보고 싶네요.';

async function drive(mode: string) {
  const steps: string[] = [];
  let submitted = false;
  const driver = new PlaywrightPostingDriver();
  const outcome = await driver.run(
    { executionId: `t_${mode}`, url: fixtureUrl(sbx.ctx, 'FIXTURE0042', mode === 'ok' ? '' : mode), content: CONTENT, userDataDir: `${sbx.dir}/prof-${mode}`, useRealChrome: false, headless: true, artifactsDir: sbx.ctx.config.paths.artifactsDir },
    { step: (s: DriverStep, r) => steps.push(`${s}:${r}`), beforeSubmit: () => (submitted = true) },
  );
  return { outcome, steps, submitted };
}

describe('Playwright driver on local fixture', () => {
  it('types char-by-char, submits, and verifies the exact comment → SUCCESS with screenshot', async () => {
    const { outcome, steps, submitted } = await drive('ok');
    expect(outcome.status).toBe('SUCCESS');
    expect(submitted).toBe(true);
    expect(steps).toEqual(expect.arrayContaining(['LAUNCHING:OK', 'AUTH_CHECK:OK', 'TYPING:OK', 'SUBMITTING:OK', 'VERIFYING:OK']));
    if (outcome.status === 'SUCCESS') {
      expect(outcome.verifiedText).toBe(CONTENT);
      expect(outcome.screenshotPath && fs.existsSync(outcome.screenshotPath)).toBe(true);
    }
  });

  // 실제 YouTube는 domcontentloaded 직후 상단 아바타가 아직 그려지지 않는다 (2026-10-21 실측). 잠시 기다려야 한다.
  it('avatar that renders after page load is still recognised as signed in', async () => {
    const { outcome, steps } = await drive('lateavatar');
    expect(steps).toContain('AUTH_CHECK:OK');
    expect(outcome.status).toBe('SUCCESS');
  });

  it('signed-out profile → AUTH_REQUIRED before submit (no bypass)', async () => {
    const { outcome, submitted } = await drive('signedout');
    expect(outcome.status).toBe('AUTH_REQUIRED');
    expect(submitted).toBe(false);
  });

  it('comments disabled → FAILED_PRE_SUBMIT after one safe reload', async () => {
    const { outcome, steps, submitted } = await drive('nocomments');
    expect(outcome.status).toBe('FAILED_PRE_SUBMIT');
    expect(submitted).toBe(false);
    expect(steps).toContain('NAVIGATING:INFO');
  });

  it('CAPTCHA → stop without bypass', async () => {
    const { outcome, submitted } = await drive('captcha');
    expect(outcome.status).toBe('FAILED_PRE_SUBMIT');
    if (outcome.status !== 'SUCCESS') expect(outcome.errorCode).toBe('CAPTCHA');
    expect(submitted).toBe(false);
  });

  it('submit with no visible result → UNKNOWN (never auto-retried)', async () => {
    const { outcome, submitted } = await drive('hang');
    expect(outcome.status).toBe('UNKNOWN');
    expect(submitted).toBe(true);
  });

  it('full executor path: approval → preflight → Chromium → SUCCESS → claim & daily count', async () => {
    const s = await seedApproval(sbx, { fixtureVideoId: 'FIXTURE0100' });
    const e = sbx.executor.start({ approvalId: s.approval.id, profileId: s.profileId, confirm: true, requestId: 'req_browser_0001' });
    const done = await sbx.executor.waitFor(e.id);
    expect(done.status).toBe('SUCCESS');
    expect(done.mode).toBe('FIXTURE');
    expect(done.events.some((x) => x.screenshotRef)).toBe(true);
    // 과제 p.4 "기록: 어느 영상에 · 어느 프로필로 · 무슨 댓글을" + p.3 "게시 완료 · 댓글 보기"
    expect(done.targetUrl).toContain('FIXTURE0100');
    expect(done.targetTitle).not.toBeNull();
    expect(done.sourceTitle).not.toBeNull();
    const claim = sbx.ctx.db.prepare("SELECT status FROM posting_claims WHERE video_id='FIXTURE0100'").get() as { status: string };
    expect(claim.status).toBe('SUCCESS');
    const res = await fetch(`http://127.0.0.1:${PORT}/api/artifacts/${done.events.find((x) => x.screenshotRef)!.screenshotRef}`);
    expect(res.headers.get('content-type')).toContain('image/png');
  });
});

describe('windowPlacement (시연 녹화용 창 위치)', () => {
  it('parses x,y,w,h into Chrome window args and ignores malformed input', async () => {
    const { windowPlacement } = await import('../execution/playwrightDriver.ts');
    expect(windowPlacement('0,38,1440,900')?.args).toEqual(['--window-position=0,38', '--window-size=1440,900']);
    expect(windowPlacement('0,38,1440')).toBeNull();
    expect(windowPlacement('0,38,1440,900; rm -rf /')).toBeNull();
    expect(windowPlacement(undefined)).toBeNull();
  });
});
