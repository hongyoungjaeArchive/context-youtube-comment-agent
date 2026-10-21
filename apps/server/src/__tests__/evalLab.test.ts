import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSandbox, type Sandbox } from '../eval/sandbox.ts';
import { abComparison, addHumanLabel, getRun, humanAiComparison, regressionReport, releaseGates, startEval, datasetOverview } from '../eval/service.ts';
import type { CaseMetrics } from '../eval/runner.ts';

/** TEST-EVAL-01: Evaluation Lab — 합성 적대 사례 5종의 안전장치 기대 결과, A/B·회귀·사람 비교·게이트 상태. 모의 Provider만 사용. */
let sbx: Sandbox;
beforeAll(() => {
  sbx = createSandbox();
});
afterAll(async () => sbx.dispose());

describe('Evaluation Lab', () => {
  it('dataset: 15 GOLDEN slots (not runnable until collected) + 5 ADVERSARIAL', () => {
    const d = datasetOverview();
    expect(d.cases.filter((c) => c.kind === 'GOLDEN')).toHaveLength(15);
    expect(d.cases.filter((c) => c.kind === 'GOLDEN' && c.runnable)).toHaveLength(0);
    expect(d.cases.filter((c) => c.kind === 'ADVERSARIAL' && c.runnable)).toHaveLength(5);
  });

  let runId = '';
  it('single run: every adversarial expectation is met (hallucination blocked, title-only grounded, misfit LOW, injection ignored)', async () => {
    const { runIds } = await startEval(sbx.ctx, { kind: 'SINGLE', live: false, confirmLiveCost: false });
    runId = runIds[0]!;
    const run = getRun(sbx.ctx, runId);
    expect(run.status).toBe('COMPLETED');
    expect(run.aiMode).toBe('MOCK');
    const byCase = Object.fromEntries(run.results.map((r) => [r.caseId, r.metrics as CaseMetrics]));
    for (const id of ['S01', 'S02', 'S03', 'S04', 'S05']) {
      expect(byCase[id]!.expectation.met, `${id}: ${byCase[id]!.expectation.detail}`).toBe(true);
    }
    expect(byCase.S01!.hallucinatedQuotes).toBe(3);
    const summary = run.summary as { skipped: number; notMeasured: string[] };
    expect(summary.skipped).toBe(15);
    expect(summary.notMeasured.join(' ')).toContain('모의');
  });

  it('human labels → AI-human comparison becomes MEASURED; none before', async () => {
    expect(humanAiComparison(sbx.ctx).state).toBe('NOT_MEASURED');
    addHumanLabel(sbx.ctx, { caseId: 'S04', runId, preferredStrategy: 'EMPATHY', ratings: { context_match: 5, naturalness: 3 }, labeler: 'tester' });
    const cmp = humanAiComparison(sbx.ctx);
    expect(cmp.state).toBe('MEASURED');
    expect(cmp.labels).toBe(1);
    expect(cmp.meanAbsError).not.toBeNull();
  });

  it('A/B produces two runs and flags the MOCK caveat; regression compares latest two runs', async () => {
    expect(abComparison(sbx.ctx).state).toBe('NOT_RUN');
    const { runIds } = await startEval(sbx.ctx, { kind: 'AB', live: false, confirmLiveCost: false, caseIds: ['S01', 'S02'] });
    expect(runIds).toHaveLength(2);
    const ab = abComparison(sbx.ctx);
    expect(ab.state).toBe('MEASURED');
    if (ab.state === 'MEASURED') expect(ab.caveat).toContain('모의');
    const reg = regressionReport(sbx.ctx);
    expect(['NO_REGRESSION', 'ADOPTION_BLOCKED']).toContain(reg.state);
  });

  it('release gates never claim PASS without evidence (G2/G4/G6 NOT_RUN in mock-only state)', async () => {
    await startEval(sbx.ctx, { kind: 'FAULTS', live: false, confirmLiveCost: false });
    const gates = Object.fromEntries(releaseGates(sbx.ctx).map((g) => [g.id, g.state]));
    expect(gates).toMatchObject({ G1: 'NOT_RUN', G2: 'NOT_RUN', G3: 'PASS', G4: 'NOT_RUN', G6: 'NOT_RUN' });
    expect(gates.G5).toBe('PARTIAL');
  });

  it('live evaluation requires explicit usage confirmation', async () => {
    await expect(startEval(sbx.ctx, { kind: 'SINGLE', live: true, confirmLiveCost: false })).rejects.toMatchObject({ code: 'LIVE_COST_CONFIRMATION' });
    await expect(startEval(sbx.ctx, { kind: 'SINGLE', live: true, confirmLiveCost: true })).rejects.toMatchObject({ code: 'LIVE_UNAVAILABLE' });
  });
});
