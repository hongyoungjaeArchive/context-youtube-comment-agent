import type { EvalReport, GateState } from '../../api/types.ts';
import { fmtPct } from '../../lib/format.ts';
import { Badge, Notice, SectionLabel, type Tone } from '../ui/primitives.tsx';

const GATE_TONE: Record<GateState, Tone> = { PASS: 'success', FAILED: 'danger', NOT_RUN: 'neutral', PARTIAL: 'warning' };

export function NotMeasured() {
  return <span className="font-mono text-[11.5px] font-semibold text-muted">NOT MEASURED</span>;
}

function SummaryList({ summary }: { summary: Record<string, unknown> }) {
  const keys = ['cases', 'completed', 'formatComplianceRate', 'hallucinatedQuotes', 'hardGateViolations', 'qualityPassRate', 'expectationsMet', 'totalUsd'];
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px] tnum">
      {keys.map((k) => {
        const v = summary[k];
        return (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-muted">{k}</dt>
            <dd>{v === null || v === undefined ? <NotMeasured /> : typeof v === 'number' && k.endsWith('Rate') ? fmtPct(v) : String(v)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export function EvalReportView({ report }: { report: EvalReport }) {
  const { ab, regression, humanComparison: hc } = report;
  return (
    <div className="space-y-5">
      <section>
        <SectionLabel>릴리스 게이트 G1~G6</SectionLabel>
        <ul className="grid gap-1.5 sm:grid-cols-2" data-testid="eval-gates">
          {report.gates.map((g) => (
            <li key={g.id} className="rounded-lg border border-line bg-elevated/40 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] font-bold">{g.id}</span>
                <span className="text-[13px] font-medium">{g.title}</span>
                <Badge tone={GATE_TONE[g.state]} icon className="ml-auto">
                  {g.state}
                </Badge>
              </div>
              <p className="mt-0.5 text-[12px] text-muted">{g.evidence}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionLabel>프롬프트 A/B</SectionLabel>
        {ab.state === 'NOT_RUN' ? (
          <p className="text-[12.5px]">
            <NotMeasured /> — A/B 실행 기록 없음
          </p>
        ) : (
          <div className="space-y-2">
            <Notice tone={ab.aiMode === 'MOCK' ? 'warning' : 'accent'}>{ab.caveat}</Notice>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['a', 'b'] as const).map((side) => (
                <div key={side} className="relative overflow-hidden rounded-lg border border-line p-3">
                  {ab.aiMode === 'MOCK' ? <MockWatermark /> : null}
                  <p className="mb-1 text-[12.5px] font-semibold">프롬프트 {side.toUpperCase()}</p>
                  <SummaryList summary={ab[side].summary} />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section>
        <SectionLabel>회귀</SectionLabel>
        {regression.state === 'NOT_RUN' ? (
          <p className="text-[12.5px]">
            <NotMeasured /> — {regression.message}
          </p>
        ) : (
          <div className="space-y-1 text-[12.5px]">
            <Badge tone={regression.state === 'NO_REGRESSION' ? 'success' : 'danger'} icon>
              {regression.state}
            </Badge>
            <p className="text-muted">
              최신 {regression.latest.label} ({regression.latest.aiMode}) ↔ 직전 {regression.previous.label} ({regression.previous.aiMode})
            </p>
            {regression.worsened.length > 0 ? <p className="text-danger">악화: {regression.worsened.join(', ')}</p> : null}
            {regression.latest.aiMode === 'MOCK' ? <p className="text-warning">모의 결과 비교 — 성능 수치 아님</p> : null}
          </div>
        )}
      </section>

      <section>
        <SectionLabel>AI ↔ 사람 평가 비교</SectionLabel>
        {hc.state === 'NOT_MEASURED' ? (
          <p className="text-[12.5px]">
            <NotMeasured /> — 사람 라벨이 없습니다
          </p>
        ) : (
          <div className="space-y-1.5 text-[12.5px] tnum">
            <p>
              라벨 {hc.labels}건 · 1순위 일치율 {hc.topPickAgreement === null ? <NotMeasured /> : fmtPct(hc.topPickAgreement)} · 항목 평균 절대오차{' '}
              {hc.meanAbsError === null ? <NotMeasured /> : hc.meanAbsError}
            </p>
            <ul className="space-y-0.5 text-[12px] text-muted">
              {hc.rows.map((r) => (
                <li key={`${r.runId}-${r.caseId}-${r.humanPick}`}>
                  {r.caseId}: 사람 {r.humanPick} / AI {r.aiPick ?? '—'} {r.agree ? '일치' : '불일치'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

export function MockWatermark() {
  return (
    <span aria-hidden className="pointer-events-none absolute right-2 top-1 rotate-[-4deg] select-none text-[11px] font-bold tracking-wide text-warning/70">
      모의 — 성능 수치 아님
    </span>
  );
}
