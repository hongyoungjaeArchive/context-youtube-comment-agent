import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * UI E2E (TEST-UX-01, TEST-EXE-01 픽스처판): 빌드된 서버를 모의 AI·합성 YouTube·로컬 픽스처 모드로 띄운다.
 * 실제 YouTube·Claude를 호출하지 않으며 실데이터 DB와 분리된 임시 폴더를 쓴다. 사전 조건: npm run build.
 */
const PORT = 4330;
const dataDir = path.join(os.tmpdir(), `context-e2e-${process.pid}`);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1440, height: 900 }, locale: 'ko-KR', screenshot: 'only-on-failure' },
  webServer: {
    command: 'node apps/server/dist/index.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      CONTEXT_PORT: String(PORT),
      CONTEXT_DATA_DIR: dataDir,
      CONTEXT_FIXTURE_MODE: '1',
      CONTEXT_FORCE_MOCK_AI: '1',
      CONTEXT_FORCE_SYNTHETIC_YT: '1',
      CONTEXT_HEADLESS: '1',
    },
  },
});
