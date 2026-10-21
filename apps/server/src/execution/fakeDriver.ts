import type { DriverHooks, DriverJob, DriverOutcome, PostingDriver } from './driver.ts';

export type FakeScript = 'SUCCESS' | 'AUTH_REQUIRED' | 'NO_EDITOR' | 'CAPTCHA' | 'HANG_AFTER_SUBMIT' | 'CRASH_AFTER_SUBMIT';

/** 단위·통합 테스트와 장애 주입용 스크립트 드라이버 (실제 브라우저를 띄우지 않음). */
export class FakePostingDriver implements PostingDriver {
  readonly runs: DriverJob[] = [];
  private readonly script: FakeScript | (() => FakeScript);
  constructor(script: FakeScript | (() => FakeScript) = 'SUCCESS') {
    this.script = script;
  }

  async run(job: DriverJob, hooks: DriverHooks): Promise<DriverOutcome> {
    this.runs.push(job);
    const script = typeof this.script === 'function' ? this.script() : this.script;
    hooks.step('LAUNCHING', 'START', '[가짜 드라이버] 시작');
    hooks.step('AUTH_CHECK', 'START', '로그인 확인');
    if (script === 'AUTH_REQUIRED') return { status: 'AUTH_REQUIRED', errorCode: 'AUTH_REQUIRED', message: '로그인 필요', screenshotPath: null };
    if (script === 'CAPTCHA') return { status: 'FAILED_PRE_SUBMIT', errorCode: 'CAPTCHA', message: 'CAPTCHA — 우회하지 않음', screenshotPath: null };
    hooks.step('NAVIGATING', 'START', '이동');
    if (script === 'NO_EDITOR') return { status: 'FAILED_PRE_SUBMIT', errorCode: 'EDITOR_NOT_FOUND', message: '입력창 없음', screenshotPath: null };
    hooks.step('EDITOR_READY', 'START', '입력창');
    hooks.step('TYPING', 'START', '입력');
    hooks.beforeSubmit();
    hooks.step('SUBMITTING', 'START', '제출');
    if (script === 'CRASH_AFTER_SUBMIT') throw new Error('브라우저 프로세스 종료(모의)');
    hooks.step('VERIFYING', 'START', '확인');
    if (script === 'HANG_AFTER_SUBMIT') return { status: 'UNKNOWN', errorCode: 'VERIFY_TIMEOUT', message: '확인 실패', screenshotPath: null };
    hooks.step('VERIFYING', 'OK', '확인 완료');
    return { status: 'SUCCESS', verifiedText: job.content, authorLabel: '@테스트', screenshotPath: null };
  }
}
