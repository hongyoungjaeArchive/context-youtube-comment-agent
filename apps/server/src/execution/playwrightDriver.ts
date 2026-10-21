import fs from 'node:fs';
import { REAL_CHROME_IGNORED_DEFAULT_ARGS } from './chromeLaunch.ts';
import path from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { normalizeForMatch } from '@context/shared';
import type { DriverHooks, DriverJob, DriverOutcome, PostingDriver } from './driver.ts';

/** YouTube 한국어 웹 UI 셀렉터 (픽스처 페이지도 같은 구조를 흉내 낸다). UI 변경 시 이곳만 갱신. */
export const YT_SELECTORS = {
  signedInAvatar: '#avatar-btn, button#avatar-btn',
  signInButton: 'a[href*="accounts.google.com/ServiceLogin"], ytd-button-renderer a[aria-label="로그인"], tp-yt-paper-button[aria-label="로그인"]',
  commentsSection: 'ytd-comments#comments, #comments',
  placeholder: 'ytd-comments #simplebox-placeholder, #simplebox-placeholder',
  editor: '#contenteditable-root[contenteditable="true"], #contenteditable-root',
  submit: '#submit-button button',
  threadText: 'ytd-comment-thread-renderer #content-text',
  threadAuthor: '#author-text',
  captcha: 'iframe[src*="recaptcha"], #captcha-form',
} as const;

const NAV_TIMEOUT_MS = 30_000;
const VERIFY_TIMEOUT_MS = 25_000;
const AUTH_WAIT_MS = 10_000;
/** 시연 영상에 "내 댓글 확인" 화면이 남도록 화면이 보이는 창에서는 닫기 전에 잠시 머문다. */
const VERIFIED_HOLD_MS = 5_000;
const MIN_KEY_DELAY_MS = 55;
const MAX_KEY_DELAY_MS = 140;

/** 시연 녹화용: CONTEXT_CHROME_WINDOW="x,y,w,h"이면 게시 창을 그 위치·크기로 연다. 형식이 틀리면 무시. */
export function windowPlacement(spec: string | undefined): { args: string[] } | null {
  const m = spec?.match(/^(\d+),(\d+),(\d+),(\d+)$/);
  if (!m) return null;
  return { args: [`--window-position=${m[1]},${m[2]}`, `--window-size=${m[3]},${m[4]}`] };
}

function humanDelay(): number {
  return MIN_KEY_DELAY_MS + Math.floor(Math.random() * (MAX_KEY_DELAY_MS - MIN_KEY_DELAY_MS));
}

class PreSubmitError extends Error {
  readonly code: string;
  readonly auth: boolean;
  constructor(code: string, message: string, auth = false) {
    super(message);
    this.code = code;
    this.auth = auth;
  }
}

/**
 * Playwright persistent context 게시 드라이버.
 * - 전용 user-data-dir 사용 (기본 Chrome 프로필 금지), 실제 시연은 channel=chrome headed.
 * - 한 글자씩 사람처럼 입력, 제출 후 댓글 목록에서 동일 원문이 보일 때만 SUCCESS.
 * - 제출 클릭 이후의 모든 예외는 UNKNOWN (자동 재시도 없음).
 */
export class PlaywrightPostingDriver implements PostingDriver {
  async run(job: DriverJob, hooks: DriverHooks): Promise<DriverOutcome> {
    const shotDir = path.join(job.artifactsDir, 'executions', job.executionId);
    fs.mkdirSync(shotDir, { recursive: true, mode: 0o700 });
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let submitted = false;
    const shot = async (name: string): Promise<string | null> => {
      if (!page) return null;
      const file = path.join(shotDir, `${name}.png`);
      try {
        await page.screenshot({ path: file, fullPage: false });
        fs.chmodSync(file, 0o600);
        return file;
      } catch {
        return null;
      }
    };
    try {
      hooks.step('LAUNCHING', 'START', job.useRealChrome ? 'Chrome 전용 프로필 여는 중' : 'Chromium(테스트) 여는 중');
      const { chromium } = await import('playwright');
      const placement = windowPlacement(process.env.CONTEXT_CHROME_WINDOW);
      context = await chromium.launchPersistentContext(job.userDataDir, {
        headless: job.headless,
        ...(job.useRealChrome ? { channel: 'chrome', ignoreDefaultArgs: [...REAL_CHROME_IGNORED_DEFAULT_ARGS] } : {}),
        locale: 'ko-KR',
        viewport: placement ? null : { width: 1280, height: 900 },
        args: ['--lang=ko-KR', ...(placement?.args ?? [])],
      });
      page = context.pages()[0] ?? (await context.newPage());
      hooks.step('LAUNCHING', 'OK', '브라우저 준비 완료');

      hooks.step('NAVIGATING', 'START', '테스트 영상 여는 중');
      await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      const expectedVideo = new URL(job.url).searchParams.get('v');
      if (expectedVideo && new URL(page.url()).searchParams.get('v') !== expectedVideo) {
        throw new PreSubmitError('UNEXPECTED_PAGE', '대상 영상이 아닌 페이지로 이동되었습니다 (리디렉션). 제출하지 않고 중단합니다.');
      }

      hooks.step('AUTH_CHECK', 'START', '로그인 상태 확인 중');
      if (await page.locator(YT_SELECTORS.captcha).count()) throw new PreSubmitError('CAPTCHA', '보안 확인(CAPTCHA)이 나타났습니다. 자동 우회하지 않고 중단합니다.');
      // isVisible()은 기다리지 않는다 — 상단 바가 늦게 그려지므로 아바타·로그인 버튼 중 먼저 보이는 쪽으로 판정한다.
      const signedIn = await page
        .locator(`${YT_SELECTORS.signedInAvatar}, ${YT_SELECTORS.signInButton}`)
        .first()
        .waitFor({ state: 'visible', timeout: AUTH_WAIT_MS })
        .then(() => page!.locator(YT_SELECTORS.signedInAvatar).first().isVisible())
        .catch(() => false);
      if (!signedIn) throw new PreSubmitError('AUTH_REQUIRED', '이 프로필이 로그인되어 있지 않습니다. 프로필 관리에서 직접 로그인해 주세요.', true);
      hooks.step('AUTH_CHECK', 'OK', '로그인 확인');

      const placeholder = await this.findCommentBox(page, hooks);
      hooks.step('NAVIGATING', 'OK', '댓글 영역 확인');

      hooks.step('EDITOR_READY', 'START', '댓글 입력창 여는 중');
      await placeholder.click();
      const editor = page.locator(YT_SELECTORS.editor).first();
      await editor.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {
        throw new PreSubmitError('EDITOR_NOT_FOUND', '댓글 입력창이 열리지 않았습니다.');
      });
      await editor.click();
      hooks.step('EDITOR_READY', 'OK', '입력창 준비');

      hooks.step('TYPING', 'START', `한 글자씩 입력 중 (${Array.from(job.content).length}자)`);
      for (const ch of Array.from(job.content)) {
        await page.keyboard.type(ch, { delay: 0 });
        await page.waitForTimeout(humanDelay());
      }
      const typed = (await editor.innerText()).trim();
      if (normalizeForMatch(typed) !== normalizeForMatch(job.content)) {
        throw new PreSubmitError('TYPING_MISMATCH', '입력된 문장이 승인된 문장과 다릅니다. 제출하지 않고 중단합니다.');
      }
      hooks.step('TYPING', 'OK', '입력 완료 · 승인 문장과 일치', await shot('typed'));

      const submit = page.locator(YT_SELECTORS.submit).first();
      if (!(await submit.isEnabled().catch(() => false))) throw new PreSubmitError('SUBMIT_DISABLED', '댓글 버튼이 비활성화되어 있습니다.');
      hooks.beforeSubmit();
      submitted = true;
      hooks.step('SUBMITTING', 'START', '댓글 게시 클릭');
      await submit.click({ timeout: 5_000 });
      hooks.step('SUBMITTING', 'OK', '게시 클릭 완료 — 실제 게시 여부는 아직 미확인');

      hooks.step('VERIFYING', 'START', '댓글 목록에서 내 댓글 확인 중');
      const target = normalizeForMatch(job.content);
      const deadline = Date.now() + VERIFY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const threads = page.locator('ytd-comment-thread-renderer');
        const n = Math.min(await threads.count(), 20);
        for (let i = 0; i < n; i++) {
          const t = threads.nth(i);
          const text = await t.locator('#content-text').first().innerText().catch(() => '');
          if (normalizeForMatch(text) === target) {
            const author = (await t.locator(YT_SELECTORS.threadAuthor).first().innerText().catch(() => '')).trim() || null;
            await t.scrollIntoViewIfNeeded().catch(() => undefined);
            const file = await shot('verified');
            hooks.step('VERIFYING', 'OK', `내 댓글 확인${author ? ` (작성자 ${author})` : ''}`, file);
            if (!job.headless) await page.waitForTimeout(VERIFIED_HOLD_MS);
            return { status: 'SUCCESS', verifiedText: text.trim(), authorLabel: author, screenshotPath: file };
          }
        }
        await page.waitForTimeout(1_000);
      }
      const file = await shot('verify-timeout');
      hooks.step('VERIFYING', 'FAIL', '제한 시간 안에 댓글을 확인하지 못했습니다', file);
      return { status: 'UNKNOWN', errorCode: 'VERIFY_TIMEOUT', message: '게시 후 댓글을 확인하지 못했습니다. 자동 재게시하지 않습니다 — 직접 확인해 주세요.', screenshotPath: file };
    } catch (error) {
      const file = await shot(submitted ? 'unknown' : 'failed');
      if (submitted) {
        return { status: 'UNKNOWN', errorCode: 'POST_SUBMIT_ERROR', message: `제출 이후 오류 — 게시 여부 불확실: ${error instanceof Error ? error.message : String(error)}`, screenshotPath: file };
      }
      if (error instanceof PreSubmitError) {
        return { status: error.auth ? 'AUTH_REQUIRED' : 'FAILED_PRE_SUBMIT', errorCode: error.code, message: error.message, screenshotPath: file };
      }
      const msg = error instanceof Error ? error.message : String(error);
      const code = /ProcessSingleton|SingletonLock|user data directory is already in use/i.test(msg) ? 'PROFILE_IN_USE' : 'BROWSER_ERROR';
      return { status: 'FAILED_PRE_SUBMIT', errorCode: code, message: `제출 전 오류: ${msg.split('\n')[0]}`, screenshotPath: file };
    } finally {
      await context?.close().catch(() => undefined);
    }
  }

  /** 댓글 영역까지 스크롤. 제출 전 안전 재탐색 최대 1회 (docs/10 §6). */
  private async findCommentBox(page: Page, hooks: DriverHooks) {
    for (let attempt = 0; attempt < 2; attempt++) {
      for (let i = 0; i < 12; i++) {
        const box = page.locator(YT_SELECTORS.placeholder).first();
        if (await box.isVisible().catch(() => false)) return box;
        await page.mouse.wheel(0, 700);
        await page.waitForTimeout(700);
      }
      if (attempt === 0) {
        hooks.step('NAVIGATING', 'INFO', '댓글 영역을 찾지 못해 1회 새로고침');
        await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      }
    }
    throw new PreSubmitError('COMMENTS_NOT_FOUND', '댓글 입력 영역을 찾지 못했습니다 (댓글 사용 중지 또는 UI 변경).');
  }
}
