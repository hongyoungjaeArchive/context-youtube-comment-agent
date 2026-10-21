import { useState, type FormEvent } from 'react';
import { STRATEGIES, STRATEGY_LABEL, type Strategy } from '@context/shared';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { qk, useEvalRun } from '../../api/queries.ts';
import type { EvalRun, EvalRunDetail } from '../../api/types.ts';
import { cx, fmtDateTime, fmtUsd } from '../../lib/format.ts';
import { QUALITY_ITEMS } from '../../lib/status.ts';
import { Badge, Button, SectionLabel, Spinner } from '../ui/primitives.tsx';
import { ServerError, inputClass } from '../ui/overlay.tsx';
import { MockWatermark, NotMeasured } from './EvalReportView.tsx';

interface FaultResult {
  readonly id: string;
  readonly title: string;
  readonly testId: string;
  readonly passed: boolean;
  readonly detail: string;
}

function FaultsDetail({ run }: { run: EvalRunDetail }) {
  const results = (run.summary.results as readonly FaultResult[] | undefined) ?? [];
  return (
    <ul className="space-y-1 text-[12.5px]">
      {results.map((r) => (
        <li key={r.id} className="flex gap-2">
          <Badge tone={r.passed ? 'success' : 'danger'} icon>
            {r.id}
          </Badge>
          <span>
            {r.title} <span className="text-muted">— {r.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function CasesDetail({ run }: { run: EvalRunDetail }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] tnum">
        <thead>
          <tr className="border-b border-line text-left text-[11px] text-muted">
            {['사례', '상태', '후보', '형식', '허위 인용', '품질 통과', '평균 점수', '기대 결과', 'AI 1순위', '비용'].map((h) => (
              <th key={h} scope="col" className="px-1.5 py-1 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {run.results.map(({ caseId, metrics: m }) => (
            <tr key={caseId}>
              <td className="px-1.5 py-1 font-mono">{caseId}</td>
              <td className="px-1.5 py-1">{m.status}</td>
              <td className="px-1.5 py-1">{m.candidates}</td>
              <td className="px-1.5 py-1">{m.formatPass}</td>
              <td className={cx('px-1.5 py-1', m.hallucinatedQuotes > 0 && 'text-danger')}>{m.hallucinatedQuotes}</td>
              <td className="px-1.5 py-1">{m.qualityPass}</td>
              <td className="px-1.5 py-1">{m.avgScore === null ? <NotMeasured /> : m.avgScore.toFixed(1)}</td>
              <td className="px-1.5 py-1">{!m.expectation.defined ? '—' : m.expectation.met === null ? <NotMeasured /> : m.expectation.met ? '충족' : '미충족'}</td>
              <td className="px-1.5 py-1">{m.aiTopStrategy ?? '—'}</td>
              <td className="px-1.5 py-1">{fmtUsd(m.estimatedUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HumanLabelForm({ run }: { run: EvalRunDetail }) {
  const caseIds = run.results.map((r) => r.caseId);
  const [caseId, setCaseId] = useState(caseIds[0] ?? '');
  const [pick, setPick] = useState<Strategy>('EMPATHY');
  const [labeler, setLabeler] = useState('');
  const [ratings, setRatings] = useState<Readonly<Record<string, string>>>({});
  const add = useApiMutation((body: Record<string, unknown>) => api.post<{ id: string }>('/api/eval/human-labels', body), { invalidate: [qk.evalReport] });
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = Object.fromEntries(Object.entries(ratings).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)]));
    add.mutate({ caseId, runId: run.id, preferredStrategy: pick, labeler: labeler.trim(), ...(Object.keys(parsed).length ? { ratings: parsed } : {}) });
  };
  if (caseIds.length === 0) return null;
  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border border-line p-3">
      <p className="text-[12.5px] font-semibold">사람 라벨 입력</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <select aria-label="사례" value={caseId} onChange={(e) => setCaseId(e.target.value)} className={inputClass}>
          {caseIds.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select aria-label="사람이 고른 전략" value={pick} onChange={(e) => setPick(e.target.value as Strategy)} className={inputClass}>
          {STRATEGIES.map((s) => (
            <option key={s} value={s}>
              {STRATEGY_LABEL[s]}
            </option>
          ))}
        </select>
        <input aria-label="라벨러" value={labeler} onChange={(e) => setLabeler(e.target.value)} maxLength={40} placeholder="라벨러 이름" className={inputClass} />
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {QUALITY_ITEMS.map((q) => (
          <label key={q.key} className="text-[11.5px] text-muted">
            {q.label}
            <select value={ratings[q.key] ?? ''} onChange={(e) => setRatings((r) => ({ ...r, [q.key]: e.target.value }))} className={cx(inputClass, 'mt-0.5 h-8 px-1.5')}>
              <option value="">—</option>
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <Button type="submit" size="sm" loading={add.isPending} disabled={!labeler.trim()}>
        라벨 저장
      </Button>
      {add.isSuccess ? <Badge tone="success" icon>저장됨</Badge> : null}
      <ServerError error={add.error} />
    </form>
  );
}

export function EvalRunsView({ runs }: { runs: readonly EvalRun[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detail = useEvalRun(selectedId);
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div>
        <SectionLabel>실행 기록 {runs.length}</SectionLabel>
        <ul className="max-h-[420px] space-y-1 overflow-y-auto" data-testid="eval-runs">
          {runs.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                aria-pressed={r.id === selectedId}
                onClick={() => setSelectedId(r.id)}
                className={cx('w-full rounded-lg border px-2.5 py-1.5 text-left text-[12.5px]', r.id === selectedId ? 'border-accent/60 bg-accent/[0.07]' : 'border-line hover:border-line-strong')}
              >
                <span className="flex items-center gap-1.5">
                  <span className="font-medium">{r.label}</span>
                  <Badge tone={r.aiMode === 'MOCK' ? 'warning' : 'accent'} className="ml-auto">
                    {r.aiMode}
                  </Badge>
                </span>
                <span className="text-[11.5px] text-muted tnum">
                  {r.status} · {fmtDateTime(r.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {runs.length === 0 ? <p className="text-[12.5px] text-muted">실행 기록 없음</p> : null}
      </div>
      <div className="relative min-h-[160px] rounded-lg border border-line p-3">
        {!selectedId ? <p className="py-8 text-center text-[12.5px] text-muted">왼쪽에서 실행을 선택하세요.</p> : null}
        {detail.isLoading ? <Spinner label="불러오는 중" /> : null}
        {detail.data ? (
          <div className="space-y-3">
            {detail.data.aiMode === 'MOCK' && detail.data.kind !== 'FAULTS' ? <MockWatermark /> : null}
            <p className="text-[13px] font-semibold">{detail.data.label}</p>
            {detail.data.kind === 'FAULTS' ? <FaultsDetail run={detail.data} /> : <CasesDetail run={detail.data} />}
            {detail.data.kind !== 'FAULTS' ? <HumanLabelForm run={detail.data} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
