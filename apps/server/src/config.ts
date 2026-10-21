import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'context-marketing-agent';
export const APP_VERSION = '0.1.0';
export const DEFAULT_PORT = 4317;
export const BIND_HOST = '127.0.0.1';

export interface AppPaths {
  readonly dataDir: string;
  readonly dbFile: string;
  readonly artifactsDir: string;
  readonly profilesDir: string;
  readonly logsDir: string;
  readonly runDir: string;
  readonly backupsDir: string;
}

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CONTEXT_DATA_DIR) return path.resolve(env.CONTEXT_DATA_DIR);
  return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
}

export function buildPaths(dataDir: string): AppPaths {
  return {
    dataDir,
    dbFile: path.join(dataDir, 'context.db'),
    artifactsDir: path.join(dataDir, 'artifacts'),
    profilesDir: path.join(dataDir, 'browser-profiles'),
    logsDir: path.join(dataDir, 'logs'),
    runDir: path.join(dataDir, 'run'),
    backupsDir: path.join(dataDir, 'backups'),
  };
}

export interface RuntimeConfig {
  readonly port: number;
  readonly paths: AppPaths;
  /** 로컬 픽스처(가짜 YouTube 댓글 UI) 게시 대상을 허용할지. E2E·데모 전용. */
  readonly fixtureMode: boolean;
  /** 실제 Chrome 대신 headless Chromium 사용 (테스트용). */
  readonly headlessBrowser: boolean;
  readonly webDistDir: string | null;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const port = Number(env.CONTEXT_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`CONTEXT_PORT 값이 올바르지 않습니다: ${env.CONTEXT_PORT}`);
  }
  return {
    port,
    paths: buildPaths(resolveDataDir(env)),
    fixtureMode: env.CONTEXT_FIXTURE_MODE === '1',
    headlessBrowser: env.CONTEXT_HEADLESS === '1',
    webDistDir: env.CONTEXT_WEB_DIST ?? null,
  };
}
