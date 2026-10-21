/** 브라우저 게시 드라이버 계약. 실제 Chrome/픽스처 모두 같은 단계 이름을 쓴다 (docs/10 §3). */
export type DriverStep = 'LAUNCHING' | 'AUTH_CHECK' | 'NAVIGATING' | 'EDITOR_READY' | 'TYPING' | 'SUBMITTING' | 'VERIFYING';

export interface DriverJob {
  readonly executionId: string;
  readonly url: string;
  readonly content: string;
  readonly userDataDir: string;
  readonly useRealChrome: boolean;
  readonly headless: boolean;
  readonly artifactsDir: string;
}

export interface DriverHooks {
  step(step: DriverStep, result: 'START' | 'OK' | 'FAIL' | 'INFO', message: string, screenshotPath?: string | null): void;
  /** 제출 클릭 직전에 호출 — DB에 SUBMIT_ATTEMPTED를 먼저 기록한다 (크래시 시 UNKNOWN 판정 근거). */
  beforeSubmit(): void;
}

export type DriverOutcome =
  | { readonly status: 'SUCCESS'; readonly verifiedText: string; readonly authorLabel: string | null; readonly screenshotPath: string | null }
  | { readonly status: 'UNKNOWN' | 'FAILED_PRE_SUBMIT' | 'AUTH_REQUIRED'; readonly errorCode: string; readonly message: string; readonly screenshotPath: string | null };

export interface PostingDriver {
  run(job: DriverJob, hooks: DriverHooks): Promise<DriverOutcome>;
}
