import type { AppContext } from '../context.ts';
import { AppError } from '../lib/errors.ts';
import { REAL_CHROME_IGNORED_DEFAULT_ARGS, spawnLoginChrome } from './chromeLaunch.ts';
import { profileRow, setProfileStatus } from './profiles.ts';

const LOGIN_URL = 'https://www.youtube.com/';
/** 로그인 판정에 쓰는 쿠키 "이름"만 확인한다 (값은 읽거나 저장하지 않음). */
const AUTH_COOKIE_NAMES = new Set(['LOGIN_INFO', 'SAPISID', '__Secure-3PAPISID']);
const openSessions = new Set<string>();
const PROFILE_LOCK_ERROR = /ProcessSingleton|SingletonLock|already in use/i;

export function isSessionOpen(profileId: string): boolean {
  return openSessions.has(profileId);
}

/** 사용자가 직접 Google 로그인하도록 전용 프로필 Chrome 창을 연다 (비밀번호·OTP는 앱이 다루지 않음). */
export async function openProfileForLogin(ctx: AppContext, profileId: string): Promise<void> {
  const p = profileRow(ctx, profileId);
  if (p.status === 'LOCKED' || openSessions.has(profileId)) throw new AppError('PROFILE_LOCKED', '이미 열려 있거나 실행 중인 프로필입니다.', 409);
  openSessions.add(profileId);
  setProfileStatus(ctx, profileId, 'LOCKED');
  ctx.audit.record('profile', profileId, 'LOGIN_WINDOW_OPENED', 'OPERATOR', { alias: p.alias });
  // Google은 자동화 브라우저의 로그인을 차단하므로, 로그인 창은 Playwright가 아닌 일반 Chrome으로 연다.
  const fail = (error: unknown): never => {
    openSessions.delete(profileId);
    setProfileStatus(ctx, profileId, 'ERROR', { error: error instanceof Error ? error.message.split('\n')[0] : 'Chrome 실행 실패' });
    throw new AppError('CHROME_LAUNCH_FAILED', 'Chrome을 열지 못했습니다. Google Chrome 설치 여부를 확인해 주세요.', 500);
  };
  const child = spawnLoginChrome(p.user_data_dir, LOGIN_URL);
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  }).catch(fail);
  child.once('exit', () => {
    openSessions.delete(profileId);
    setProfileStatus(ctx, profileId, 'REGISTERED');
    void checkProfileAuth(ctx, profileId).catch(() => undefined);
  });
}

/** headless로 프로필 쿠키 이름만 확인해 로그인 여부를 판정. */
export async function checkProfileAuth(ctx: AppContext, profileId: string): Promise<'READY' | 'AUTH_REQUIRED'> {
  const p = profileRow(ctx, profileId);
  if (p.status === 'LOCKED' || openSessions.has(profileId)) throw new AppError('PROFILE_LOCKED', '프로필이 사용 중입니다.', 409);
  const { chromium } = await import('playwright');
  let status: 'READY' | 'AUTH_REQUIRED' = 'AUTH_REQUIRED';
  // macOS에서는 로그인 창을 띄운 프로세스가 곧바로 끝나 창이 열려 있어도 openSessions에서 빠질 수 있다 — 폴더 잠금 오류로 판별한다.
  const context = await chromium
    .launchPersistentContext(p.user_data_dir, { headless: true, channel: 'chrome', ignoreDefaultArgs: [...REAL_CHROME_IGNORED_DEFAULT_ARGS] })
    .catch((error: unknown) => {
      if (error instanceof Error && PROFILE_LOCK_ERROR.test(error.message)) {
        throw new AppError('PROFILE_IN_USE', '로그인 창이 아직 열려 있습니다. 그 Chrome 창을 ⌘Q로 종료한 뒤 다시 확인해 주세요. 창을 닫았는데도 이 메시지가 나오면 Dock의 Chrome 아이콘을 우클릭해 종료하세요.', 409);
      }
      throw error;
    });
  try {
    const cookies = await context.cookies('https://www.youtube.com');
    status = cookies.some((c) => AUTH_COOKIE_NAMES.has(c.name)) ? 'READY' : 'AUTH_REQUIRED';
  } finally {
    await context.close();
  }
  setProfileStatus(ctx, profileId, status, { authCheckedAt: ctx.clock().toISOString(), error: null });
  ctx.audit.record('profile', profileId, 'AUTH_CHECKED', 'SYSTEM', { status });
  return status;
}
