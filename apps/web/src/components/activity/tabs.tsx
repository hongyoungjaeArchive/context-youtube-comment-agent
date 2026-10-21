import type { ReactNode } from 'react';
import type { AuditEventDTO, UsageBucket } from '@context/shared';
import { useActivity, useExecutions, useJobs, useUsage } from '../../api/queries.ts';
import { ERROR_ACTION_PATTERN, EXECUTION_STATUS, JOB_STATUS } from '../../lib/status.ts';
import { cx, fmtCount, fmtDateTime, fmtTime, fmtUsd } from '../../lib/format.ts';
import { Badge, Notice, Spinner } from '../ui/primitives.tsx';

const th = 'px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted';
const td = 'px-2 py-1.5 align-top';

export function Table({ head, children, empty }: { head: readonly string[]; children: ReactNode; empty: boolean }) {
  if (empty) return <p className="py-6 text-center text-[12.5px] text-muted">기록이 없습니다.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px] tnum">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-line">
            {head.map((h) => (
              <th key={h} scope="col" className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export function JobsTab() {
  const q = useJobs();
  if (q.isLoading) return <Spinner label="불러오는 중" />;
  const data = q.data;
  if (!data) return <Notice tone="danger">작업 큐를 불러오지 못했습니다.</Notice>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {Object.entries(data.counts).map(([k, n]) => (
          <Badge key={k} tone={JOB_STATUS[k as keyof typeof JOB_STATUS]?.tone ?? 'neutral'}>
            {k} {n}
          </Badge>
        ))}
      </div>
      <Table head={['시간', '유형', '상태', '우선순위', '시도', '모델', '대상', '오류']} empty={data.jobs.length === 0}>
        {data.jobs.map((j) => (
          <tr key={j.id}>
            <td className={cx(td, 'text-muted')}>{fmtDateTime(j.updatedAt)}</td>
            <td className={cx(td, 'font-mono text-[11.5px]')}>{j.type}</td>
            <td className={td}>
              <Badge tone={JOB_STATUS[j.status].tone} icon>
                {j.status}
              </Badge>
            </td>
            <td className={td}>{j.priority}</td>
            <td className={td}>{j.attempts}</td>
            <td className={cx(td, 'text-muted')}>{j.modelId ?? '—'}</td>
            <td className={cx(td, 'font-mono text-[11px] text-muted')}>{j.subjectId}</td>
            <td className={cx(td, 'text-danger')}>{j.errorMessage ? `${j.errorCode ?? ''} ${j.errorMessage}` : ''}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function UsageCard({ title, b }: { title: string; b: UsageBucket }) {
  const rows: readonly [string, string][] = [
    ['호출', fmtCount(b.calls)],
    ['입력 토큰', fmtCount(b.inputTokens)],
    ['출력 토큰', fmtCount(b.outputTokens)],
    ['캐시 읽기 토큰', fmtCount(b.cacheReadTokens)],
    ['캐시 적중', fmtCount(b.cacheHits)],
    ['오류', fmtCount(b.errors)],
  ];
  return (
    <div className="rounded-lg border border-line bg-elevated/40 p-3">
      <p className="text-[12px] text-muted">{title}</p>
      <p className="mt-0.5 text-[20px] font-bold tnum">
        {fmtUsd(b.estimatedUsd)} <span className="text-[11px] font-medium text-muted">종량 과금 추정 청구액</span>
      </p>
      <p className="text-[12px] text-muted tnum">
        {fmtUsd(b.notionalUsd)} <span className="text-[11px]">구독 CLI 환산 참고값 (청구 아님)</span>
      </p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[12px] tnum">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function UsageTab() {
  const q = useUsage(true);
  if (q.isLoading) return <Spinner label="불러오는 중" />;
  const u = q.data;
  if (!u) return <Notice tone="danger">AI 사용량을 불러오지 못했습니다.</Notice>;
  const tone = u.budget.state === 'OK' ? 'success' : u.budget.state === 'WARNING' ? 'warning' : 'danger';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <Badge tone={tone} icon>
          예산 {u.budget.state}
        </Badge>
        <span className="text-muted">예산은 종량 과금(Anthropic API)에만 적용됩니다.</span>
        <span className="text-muted tnum">
          일 {fmtUsd(u.budget.dailyLimitUsd)} · 월 {fmtUsd(u.budget.monthlyLimitUsd)} · 경고 {Math.round(u.budget.warningRatio * 100)}%
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <UsageCard title="오늘" b={u.today} />
        <UsageCard title="이번 달" b={u.month} />
      </div>
      <Table head={['모델', '입력 $/MTok', '출력 $/MTok', '비고']} empty={u.priceCatalog.length === 0}>
        {u.priceCatalog.map((p) => (
          <tr key={p.modelId}>
            <td className={cx(td, 'font-mono text-[11.5px]')}>{p.modelId}</td>
            <td className={td}>{p.inputPerMTok}</td>
            <td className={td}>{p.outputPerMTok}</td>
            <td className={cx(td, 'text-warning')}>{p.note}</td>
          </tr>
        ))}
      </Table>
      <p className="text-[11.5px] text-muted">금액은 가격표 기반 추정치이며 REVERIFY 대상입니다. 종량 과금 추정 청구액은 실제 청구와 다를 수 있고, 구독 CLI 환산 참고값은 청구되지 않습니다.</p>
    </div>
  );
}

export function ExecutionLogTab() {
  const q = useExecutions();
  const list = q.data?.executions ?? [];
  return (
    <Table head={['시간', '대상 영상', '원본 영상', '프로필', '댓글', '상태', '모드']} empty={list.length === 0}>
      {list.map((e) => (
        <tr key={e.id}>
          <td className={cx(td, 'text-muted')}>{fmtDateTime(e.createdAt)}</td>
          <td className={cx(td, 'font-mono text-[11px]')}>{e.targetVideoId}</td>
          <td className={cx(td, 'font-mono text-[11px] text-muted')}>{e.sourceVideoId}</td>
          <td className={td}>{e.profileAlias}</td>
          <td className={cx(td, 'max-w-[320px] truncate')} title={e.content}>
            {e.content}
          </td>
          <td className={td}>
            <Badge tone={EXECUTION_STATUS[e.status].tone} icon>
              {e.status}
            </Badge>
          </td>
          <td className={cx(td, 'text-muted')}>{e.mode}</td>
        </tr>
      ))}
    </Table>
  );
}

function metaSummary(m: Record<string, unknown>): string {
  return Object.entries(m)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
    .slice(0, 240);
}

export function AuditTab({ errorsOnly }: { errorsOnly: boolean }) {
  const q = useActivity(true);
  const events: readonly AuditEventDTO[] = q.data?.events ?? [];
  const list = errorsOnly ? events.filter((e) => ERROR_ACTION_PATTERN.test(e.action)) : events;
  return (
    <Table head={['시간', '동작', '대상', '주체', '세부']} empty={list.length === 0}>
      {list.map((e) => (
        <tr key={e.id}>
          <td className={cx(td, 'whitespace-nowrap text-muted')}>{fmtTime(e.createdAt)}</td>
          <td className={td}>
            <span className={cx('font-mono text-[11.5px]', ERROR_ACTION_PATTERN.test(e.action) ? 'text-danger' : 'text-fg')}>{e.action}</span>
          </td>
          <td className={cx(td, 'font-mono text-[11px] text-muted')}>
            {e.entityType}:{e.entityId}
          </td>
          <td className={cx(td, 'text-muted')}>{e.actor}</td>
          <td className={cx(td, 'text-muted')}>{metaSummary(e.metadata)}</td>
        </tr>
      ))}
    </Table>
  );
}
