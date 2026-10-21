import { expect, test, type Page } from '@playwright/test';

/**
 * TEST-UX-01: 3열 필수 동선 (영상 불러오기 → 선택·분석 → 근거 추가 → 후보 비교 → 편집 시 승인 무효 → 재검증 → 승인 → 실행 → 확인).
 * TEST-EXE-01(픽스처판)/TEST-EXE-03/TEST-POL-02: 로컬 가짜 YouTube 페이지에 headless Chromium으로 게시·확인, 중복 차단, UNKNOWN 보류.
 * 모의 AI·합성 데이터 — 실제 YouTube/Claude 미사용.
 */
const SHOTS = 'test-results/screens';
const tid = (page: Page, id: string) => page.getByTestId(id);
const textOf = async (page: Page, id: string) => (await tid(page, id).textContent()) ?? '';

async function waitText(page: Page, id: string, re: RegExp, timeout = 30_000) {
  await expect(tid(page, id).first()).toHaveText(re, { timeout });
}

test.describe.serial('CONTEXT dashboard', () => {
  let page: Page;
  let passStrategy = 'EMPATHY';

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('/');
  });
  test.afterAll(async () => page.close());

  test('header shows local status and honest MOCK/SYNTHETIC labels', async () => {
    await expect(page.getByText('LOCAL READY')).toBeVisible();
    await expect(page.getByText(/MOCK|모의/).first()).toBeVisible();
    await expect(page.getByText(/SYNTHETIC/).first()).toBeVisible();
  });

  test('column 1: load videos from the 5 channels and select one', async () => {
    await tid(page, 'refresh-videos').click();
    await expect(tid(page, 'video-card')).toHaveCount(15, { timeout: 15_000 });
    await tid(page, 'video-card').first().click();
  });

  // 과제 p.3 "목록에서 영상을 고르면 영상 속 고민 한 줄과 댓글 초안이 보입니다" — 버튼 없이 자동 분석, 추천 초안 자동 선택.
  test('column 2: selecting a video auto-analyzes and shows one recommended draft', async () => {
    await waitText(page, 'analysis-status', /COMPLETED/);
    await expect(tid(page, 'core-problem')).not.toBeEmpty();
    await expect(tid(page, 'recommended-draft').locator('[data-selected="true"]')).toHaveCount(1);
    await expect(tid(page, 'evidence-quote-text')).toBeHidden();
    await expect(tid(page, 'approval-state')).toBeVisible();
  });

  test('operator-verified quote → re-analysis → PASS candidates with scores', async () => {
    await tid(page, 'evidence-toggle').click();
    await tid(page, 'evidence-quote-text').fill('연락이 갑자기 줄어든 상대에게 먼저 연락해도 될지 고민된다는 사연');
    await tid(page, 'evidence-quote-timestamp').fill('03:12');
    await tid(page, 'evidence-quote-add').click();
    await expect(tid(page, 'analysis-stale')).toBeVisible({ timeout: 10_000 });
    await tid(page, 'reanalyze').click();
    await expect(tid(page, 'analysis-stale')).toHaveCount(0, { timeout: 30_000 });
    await waitText(page, 'analysis-status', /COMPLETED/);
    await tid(page, 'more-drafts').click();
    const statuses: Record<string, string> = {};
    for (const s of ['EMPATHY', 'QUESTION', 'INFO']) statuses[s] = (await tid(page, `candidate-card-${s}`).getByTestId('review-status').textContent()) ?? '';
    passStrategy = Object.keys(statuses).find((s) => statuses[s]!.includes('PASS')) ?? '';
    expect(passStrategy, JSON.stringify(statuses)).not.toBe('');
    await expect(tid(page, `candidate-card-${passStrategy}`).getByTestId('candidate-score')).toHaveText(/\d+/);
  });

  test('column 3: approval gated on own verified test target + profile', async () => {
    await tid(page, `candidate-card-${passStrategy}`).click();
    await tid(page, 'edit-toggle').click();
    await expect(tid(page, 'comment-editor')).toBeVisible();
    await expect(tid(page, 'approval-state')).toHaveText(/DISABLED/);
    await tid(page, 'open-targets').click();
    await tid(page, 'fixture-video-id').fill('FIXTURE0001');
    await tid(page, 'fixture-register').click();
    await expect(page.getByText('FIXTURE0001').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await tid(page, 'target-select').selectOption({ index: 1 });
    await tid(page, 'profile-select').selectOption({ index: 1 });
    await expect(tid(page, 'approval-state')).toHaveText(/READY/);
    await tid(page, 'approve-button').click();
    await waitText(page, 'approval-state', /APPROVED/, 10_000);
  });

  test('editing the approved comment invalidates approval; revalidate restores the gate', async () => {
    const editor = tid(page, 'comment-editor');
    const before = await editor.inputValue();
    await editor.fill(`${before.trimEnd()} 정말요`);
    await expect(tid(page, 'char-count')).toHaveText(/\d+/);
    await tid(page, 'save-revision').click();
    await waitText(page, 'approval-state', /INVALIDATED/, 10_000);
    await page.reload();
    // 선택 영상·후보는 URL 해시로 복원된다 (새로고침이 작업을 재시작하지 않음).
    await expect(tid(page, `candidate-card-${passStrategy}`)).toBeVisible({ timeout: 15_000 });
    await tid(page, 'edit-toggle').click();
    await expect(tid(page, 'comment-editor')).toBeVisible();
    await waitText(page, 'approval-state', /INVALIDATED/, 10_000);
    await tid(page, 'revalidate').click();
    await expect(tid(page, `candidate-card-${passStrategy}`).getByTestId('review-status')).toHaveText(/PASS|FAIL|NEEDS_EVIDENCE/, { timeout: 30_000 });
  });

  test('execute on fixture: types, posts, verifies → SUCCESS; second run on same video is blocked', async () => {
    const reviewText = (await tid(page, `candidate-card-${passStrategy}`).getByTestId('review-status').textContent()) ?? '';
    test.skip(!reviewText.includes('PASS'), `편집본 재검증 결과 ${reviewText} — 승인 불가 경로는 서버 통합 테스트가 담당`);
    await tid(page, 'target-select').selectOption({ index: 1 });
    await tid(page, 'profile-select').selectOption({ index: 1 });
    await tid(page, 'approve-button').click();
    await waitText(page, 'approval-state', /APPROVED/, 10_000);
    await tid(page, 'execute-button').click();
    await tid(page, 'confirm-execute').click();
    await waitText(page, 'execution-status', /SUCCESS|UNKNOWN|FAILED|AUTH_REQUIRED/, 90_000);
    expect(await textOf(page, 'execution-status')).toContain('SUCCESS');
    // 과제 p.3 진행 상태 "게시 완료 · 댓글 보기"
    await expect(tid(page, 'execution-status')).toContainText('게시 완료');
    await expect(tid(page, 'view-comment')).toHaveAttribute('href', /FIXTURE0001/);
    await page.screenshot({ path: `${SHOTS}/executed-1440.png`, fullPage: true });
    await tid(page, 'execute-button').click();
    await tid(page, 'confirm-execute').click();
    await expect(tid(page, 'server-error').first()).toContainText('VIDEO_ALREADY_CLAIMED');
    await page.keyboard.press('Escape');
    // 과제 p.4 기록: 어느 영상에 · 어느 프로필로 · 무슨 댓글을 · 성공/실패
    await tid(page, 'open-history').click();
    const row = tid(page, 'history-row').first();
    await expect(row).toContainText('FIXTURE0001');
    await expect(row).toContainText('유튜브');
    await expect(row).toContainText('SUCCESS');
    await page.keyboard.press('Escape');
  });

  test('Evaluation Lab runs the 10 fault-injection scenarios and shows release gates', async () => {
    // Eval Lab은 처음 보는 사람의 동선에서 빼고 설정 안에 둔다 (CHG-2026-10-21-09).
    await expect(page.getByRole('navigation', { name: '보조 화면' }).getByTestId('open-eval-lab')).toHaveCount(0);
    await tid(page, 'open-settings').click();
    await tid(page, 'open-eval-lab').click();
    await tid(page, 'eval-run-faults').click();
    await expect(tid(page, 'eval-gates')).toContainText('G3', { timeout: 90_000 });
    await expect(tid(page, 'eval-gates')).toContainText('NOT_RUN');
    await page.screenshot({ path: `${SHOTS}/eval-lab.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await expect(tid(page, 'activity-center')).toBeVisible();
  });

  // TEST-SAGE-01 / TEST-UX-02: Sage 비서 — 런처·헤더 질문창 → 패널 → 모의 답변
  test('Sage: launcher does not cover the Activity Center bar', async () => {
    const launcher = await tid(page, 'sage-launcher').boundingBox();
    const bar = await tid(page, 'activity-center').boundingBox();
    expect(launcher && bar).toBeTruthy();
    const overlaps = launcher!.x < bar!.x + bar!.width && launcher!.x + launcher!.width > bar!.x && launcher!.y < bar!.y + bar!.height && launcher!.y + launcher!.height > bar!.y;
    expect(overlaps).toBe(false);
  });

  test('Sage: launcher opens panel and answers in mock mode', async () => {
    await tid(page, 'sage-launcher').click();
    await expect(tid(page, 'sage-panel')).toBeVisible();
    await expect(tid(page, 'sage-send')).toBeDisabled();
    await tid(page, 'sage-input').fill('오늘 게시 몇 개 남았어?');
    await tid(page, 'sage-send').click();
    await expect(tid(page, 'sage-answer').last()).toContainText(/모의 모드 답변/, { timeout: 15_000 });
    await expect(tid(page, 'sage-input')).toBeFocused();
    const bubble = await tid(page, 'sage-question').last().boundingBox();
    const panel = await tid(page, 'sage-panel').boundingBox();
    expect(bubble!.width).toBeLessThan(panel!.width * 0.6);
    await page.screenshot({ path: `${SHOTS}/sage-panel.png` });
    await page.keyboard.press('Escape');
    await expect(tid(page, 'sage-panel')).toBeHidden();
  });

  test('Sage: header search sends question to panel, even when repeated', async () => {
    // 닫힌 패널은 대화를 렌더링하지 않으므로, 한 번 열어 지금까지의 대화 수를 센다.
    await tid(page, 'sage-launcher').click();
    let sent = await tid(page, 'sage-question').count();
    await page.keyboard.press('Escape');
    const ask = async (question: string) => {
      await tid(page, 'sage-search').fill(question);
      await tid(page, 'sage-search').press('Enter');
      await expect(tid(page, 'sage-panel')).toBeVisible();
      sent += 1;
      await expect(tid(page, 'sage-question')).toHaveCount(sent);
      await expect(tid(page, 'sage-question').last()).toHaveText(question);
      await expect(tid(page, 'sage-answer')).toHaveCount(sent, { timeout: 15_000 });
      await page.keyboard.press('Escape');
      await expect(tid(page, 'sage-panel')).toBeHidden();
    };
    await ask('승인 대기 중인 댓글 있어?');
    await ask('승인 대기 중인 댓글 있어?');
  });

  test('layout keeps 3 columns at 1280px', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(tid(page, 'refresh-videos')).toBeVisible();
    await expect(tid(page, 'approval-state')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/layout-1280.png` });
  });

  // 과제 가점: '연애' 키워드로 뜨기 직전 영상 찾기 (초안까지만) — TEST-TREND-02
  test('trend finder lists a rising video as draft-only and drafts without approval', async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await tid(page, 'trend-search').click();
    const card = tid(page, 'trend-list').getByTestId('video-card');
    await expect(card).toHaveCount(1, { timeout: 15_000 });
    await expect(card).toContainText('초안까지만');
    await card.click();
    await expect(tid(page, 'draft-only-notice')).toBeVisible();
    await waitText(page, 'analysis-status', /COMPLETED/);
    await expect(tid(page, 'core-problem')).not.toBeEmpty();
  });
});
