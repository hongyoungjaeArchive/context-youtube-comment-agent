import { spawn, type ChildProcess } from 'node:child_process';

/** macOS 기본 Chrome 실행 파일. */
export const CHROME_EXECUTABLE = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/**
 * Playwright가 실제 Chrome에 기본으로 붙이는 인자 중 Keychain 관련 항목만 뺀다.
 * 로그인 창(일반 Chrome)이 macOS Keychain 키로 암호화한 쿠키를 게시 단계에서 그대로 읽기 위함이다.
 * `--enable-automation`은 유지한다 — 자동화 사실을 숨기지 않는다.
 */
export const REAL_CHROME_IGNORED_DEFAULT_ARGS: readonly string[] = ['--use-mock-keychain', '--password-store=basic'];

/** 사용자가 직접 Google 로그인할 일반 Chrome 창의 인자 (자동화 플래그 없음, 전용 프로필 폴더). */
export function buildLoginChromeArgs(userDataDir: string, url: string): string[] {
  return [`--user-data-dir=${userDataDir}`, '--no-first-run', '--no-default-browser-check', '--lang=ko-KR', url];
}

/** 전용 프로필로 일반 Chrome 창을 띄운다. 창이 모두 닫히면 프로세스가 종료된다. */
export function spawnLoginChrome(userDataDir: string, url: string): ChildProcess {
  return spawn(CHROME_EXECUTABLE, buildLoginChromeArgs(userDataDir, url), { stdio: 'ignore' });
}
