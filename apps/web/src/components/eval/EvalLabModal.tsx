import { useState } from 'react';
import { Play } from 'lucide-react';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { qk, useEvalDataset, useEvalReport, useEvalRuns } from '../../api/queries.ts';
import type { EvalDataset, EvalKind } from '../../api/types.ts';
import { cx } from '../../lib/format.ts';
import { Badge, Button, Notice, SectionLabel, Spinner } from '../ui/primitives.tsx';
import { Modal, ServerError } from '../ui/overlay.tsx';
import { EvalReportView } from './EvalReportView.tsx';
import { EvalRunsView } from './EvalRunsView.tsx';

type Tab = 'report' | 'runs' | 'dataset';

const KINDS: readonly { kind: EvalKind; label: string; hint: string }[] = [
  { kind: 'FAULTS', label: '장애 주입 10종', hint: 'AI 호출 없음' },
  { kind: 'SINGLE', label: '단일 실행', hint: '현재 프롬프트' },
  { kind: 'AB', label: '프롬프트 A/B', hint: 'A-1.0 vs B-1.0' },
  { kind: 'REGRESSION', label: '회귀', hint: '직전 실행과 비교' },
];

function DatasetTable({ data }: { data: EvalDataset }) {
  const golden = data.cases.filter((c) => c.kind === 'GOLDEN');
  const runnable = data.cases.filter((c) => c.runnable).length;
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-muted tnum">
        버전 {data.version} · GOLDEN {golden.length}/15 · ADVERSARIAL {data.cases.length - golden.length} · 실행 가능 {runnable}
      </p>
      {data.notes.length > 0 ? (
        <Notice tone="neutral">
          {data.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </Notice>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] text-muted">
              {['ID', '종류', '채널', '라벨', '상태', '근거', '사람 라벨'].map((h) => (
                <th key={h} scope="col" className="px-1.5 py-1 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.cases.map((c) => (
              <tr key={c.caseId}>
                <td className="px-1.5 py-1 font-mono">{c.caseId}</td>
                <td className="px-1.5 py-1">{c.kind}</td>
                <td className="px-1.5 py-1 text-muted">{c.channelName ?? '—'}</td>
                <td className="px-1.5 py-1">{c.label ?? '—'}</td>
                <td className="px-1.5 py-1">
                  <Badge tone={c.runnable ? 'success' : 'warning'} icon>
                    {c.status}
                  </Badge>
                </td>
                <td className="px-1.5 py-1 tnum">{c.evidenceCount}</td>
                <td className="px-1.5 py-1">{c.hasHumanLabel ? '있음' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function EvalLabModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('report');
  const [live, setLive] = useState(false);
  const [confirmCost, setConfirmCost] = useState(false);
  const dataset = useEvalDataset(open);
  const runs = useEvalRuns(open);
  const report = useEvalReport(open);
  const start = useApiMutation((kind: EvalKind) => api.post<{ runIds: string[] }>('/api/eval/runs', { kind, live, ...(live ? { confirmLiveCost: confirmCost } : {}) }), {
    invalidate: [qk.evalRuns, qk.evalReport, qk.usage],
  });
  const liveBlocked = live && !confirmCost;

  return (
    <Modal open={open} onClose={onClose} width="xl" title="Evaluation Lab" subtitle="측정하지 않은 수치는 NOT MEASURED로 표시합니다. 모의 결과는 성능 수치가 아닙니다." testId="eval-lab">
      <div className="space-y-5">
        <section className="space-y-2.5 rounded-lg border border-line bg-elevated/30 p-3">
          <SectionLabel>평가 실행</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <Button
                key={k.kind}
                data-testid={`eval-run-${k.kind.toLowerCase()}`}
                icon={<Play size={13} aria-hidden />}
                onClick={() => start.mutate(k.kind)}
                loading={start.isPending && start.variables === k.kind}
                disabled={start.isPending || liveBlocked}
                title={k.hint}
              >
                {k.label}
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
            실제 Claude로 평가 (live)
          </label>
          {live ? (
            <Notice tone="warning">
              <p>실제 Claude(구독 사용량 또는 종량 과금)를 사용합니다. 종량 과금 Provider면 사례당 약 USD 0.06 추정(A/B는 2배)이 청구되며 예산을 넘으면 서버가 차단합니다. 구독 CLI면 구독 사용량이 소모됩니다.</p>
              <label className="mt-1 flex items-center gap-2">
                <input type="checkbox" checked={confirmCost} onChange={(e) => setConfirmCost(e.target.checked)} className="h-4 w-4 accent-[var(--color-warning)]" />
                실제 Claude 사용(구독 사용량 또는 종량 과금)을 확인했습니다
              </label>
            </Notice>
          ) : (
            <p className="text-[12px] text-muted">기본값은 모의(MOCK) 실행입니다 — 파이프라인 동작 확인용이며 품질·성능 수치가 아닙니다.</p>
          )}
          {start.data ? <Badge tone="success" icon>실행 완료 · {start.data.runIds.join(', ')}</Badge> : null}
          <ServerError error={start.error} />
        </section>

        <div role="tablist" aria-label="Evaluation Lab 탭" className="flex gap-1 border-b border-line">
          {(
            [
              ['report', '리포트 · 게이트'],
              ['runs', '실행 기록 · 사람 라벨'],
              ['dataset', '데이터셋'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cx('-mb-px h-9 border-b-2 px-3 text-[13px]', tab === key ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}
            >
              {label}
            </button>
          ))}
        </div>

        <div role="tabpanel">
          {tab === 'report' ? report.data ? <EvalReportView report={report.data} /> : <Spinner label="리포트 불러오는 중" /> : null}
          {tab === 'runs' ? <EvalRunsView runs={runs.data?.runs ?? []} /> : null}
          {tab === 'dataset' ? dataset.data ? <DatasetTable data={dataset.data} /> : <Spinner label="데이터셋 불러오는 중" /> : null}
        </div>
      </div>
    </Modal>
  );
}
