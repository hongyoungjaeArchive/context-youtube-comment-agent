import { useState, type FormEvent } from 'react';
import { CheckCircle2, CircleDashed, ExternalLink, ImageIcon, Loader2, XCircle } from 'lucide-react';
import type { ExecutionDTO, ExecutionEventDTO } from '@context/shared';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { isTerminalExecution, qk } from '../../api/queries.ts';
import { EXECUTION_STATUS } from '../../lib/status.ts';
import { cx, fmtTime } from '../../lib/format.ts';
import { Badge, Button, Notice } from '../ui/primitives.tsx';
import { ServerError, inputClass } from '../ui/overlay.tsx';

/** 공식 6단계와 서버 실행 단계(DriverStep) 대응. */
const PHASES = [
  { key: 'OPEN', label: '프로필 열기', steps: ['LAUNCHING'] },
  { key: 'AUTH', label: '로그인 확인', steps: ['AUTH_CHECK'] },
  { key: 'NAVIGATE', label: '영상 이동', steps: ['NAVIGATING', 'EDITOR_READY'] },
  { key: 'TYPE', label: '댓글 입력', steps: ['TYPING'] },
  { key: 'SUBMIT', label: '게시', steps: ['SUBMITTING'] },
  { key: 'VERIFY', label: '게시 확인', steps: ['VERIFYING'] },
] as const;

type PhaseState = 'WAITING' | 'RUNNING' | 'DONE' | 'FAILED';

function phaseState(steps: readonly string[], events: readonly ExecutionEventDTO[], terminal: boolean): PhaseState {
  const related = events.filter((e) => steps.includes(e.step));
  if (related.length === 0) return 'WAITING';
  if (related.some((e) => e.result === 'FAIL')) return 'FAILED';
  const lastStepStarted = steps[steps.length - 1] ?? '';
  const lastDone = related.some((e) => e.step === lastStepStarted && e.result === 'OK');
  if (lastDone) return 'DONE';
  return terminal ? 'FAILED' : 'RUNNING';
}

const PHASE_ICON: Record<PhaseState, React.ReactNode> = {
  WAITING: <CircleDashed size={15} className="text-muted" aria-hidden />,
  RUNNING: <Loader2 size={15} className="animate-spin text-accent" aria-hidden />,
  DONE: <CheckCircle2 size={15} className="text-success" aria-hidden />,
  FAILED: <XCircle size={15} className="text-danger" aria-hidden />,
};

function ResolveForm({ execution }: { execution: ExecutionDTO }) {
  const [note, setNote] = useState('');
  const resolve = useApiMutation(
    (outcome: 'CONFIRMED_POSTED' | 'CONFIRMED_NOT_POSTED') => api.post<ExecutionDTO>(`/api/executions/${execution.id}/resolve`, { outcome, note: note.trim() }),
    { invalidate: [qk.executions, qk.execution(execution.id), qk.targets, qk.health] },
  );
  const valid = note.trim().length >= 2;
  const submit = (outcome: 'CONFIRMED_POSTED' | 'CONFIRMED_NOT_POSTED') => (e?: FormEvent) => {
    e?.preventDefault();
    if (valid) resolve.mutate(outcome);
  };
  return (
    <form onSubmit={submit('CONFIRMED_POSTED')} className="space-y-2 rounded-lg border border-warning/30 bg-warning/[0.05] p-3">
      <p className="text-[12.5px] font-semibold text-warning">수동 확인 — 대상 영상에서 댓글을 직접 확인한 뒤 기록하세요.</p>
      <label htmlFor="resolve-note" className="sr-only">
        확인 메모
      </label>
      <input id="resolve-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="확인 메모 (2자 이상)" className={inputClass} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={!valid} loading={resolve.isPending} onClick={() => submit('CONFIRMED_POSTED')()}>
          게시됨 확인
        </Button>
        <Button size="sm" variant="secondary" disabled={!valid} loading={resolve.isPending} onClick={() => submit('CONFIRMED_NOT_POSTED')()}>
          게시 안 됨 확인
        </Button>
      </div>
      <ServerError error={resolve.error} />
    </form>
  );
}

function Outcome({ execution }: { execution: ExecutionDTO }) {
  const s = execution.status;
  const shot = [...execution.events].reverse().find((e) => e.screenshotRef)?.screenshotRef ?? null;
  const shotLink = shot ? (
    <a href={`/api/artifacts/${encodeURIComponent(shot)}`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 underline underline-offset-2">
      <ImageIcon size={12} aria-hidden /> 증거 스크린샷 보기
    </a>
  ) : null;
  if (s === 'SUCCESS') {
    return (
      <Notice tone="success">
        <p className="font-semibold">게시 완료 — 대상 영상의 댓글 목록에서 내 댓글을 확인했습니다.</p>
        {execution.humanResolution ? <p>수동 확인: {execution.humanResolution}</p> : null}
        {shotLink}
      </Notice>
    );
  }
  if (s === 'UNKNOWN') {
    return (
      <div className="space-y-2">
        <Notice tone="warning">
          <p className="font-semibold">게시 여부 불확실 — 자동 재게시 안 함, 직접 확인 필요</p>
          {execution.errorMessage ? <p>{execution.errorMessage}</p> : null}
          {shotLink}
        </Notice>
        {execution.humanResolution ? <Notice tone="neutral">수동 확인 기록: {execution.humanResolution}</Notice> : <ResolveForm execution={execution} />}
      </div>
    );
  }
  if (isTerminalExecution(s)) {
    return (
      <Notice tone={s === 'CANCELLED' || s === 'INTERRUPTED' ? 'warning' : 'danger'}>
        <p className="font-semibold">
          {EXECUTION_STATUS[s].label}
          {execution.errorCode ? <span className="ml-1.5 font-mono text-[11px]">{execution.errorCode}</span> : null}
        </p>
        {execution.errorMessage ? <p>{execution.errorMessage}</p> : null}
        {s === 'AUTH_REQUIRED' ? <p>프로필 관리에서 [로그인 창 열기]로 직접 로그인한 뒤 다시 승인·실행하세요.</p> : null}
        {s === 'FAILED_PRE_SUBMIT' ? <p>제출 전에 안전하게 중단되었습니다. 게시되지 않았습니다.</p> : null}
        {shotLink}
      </Notice>
    );
  }
  return null;
}

export function ExecutionTimeline({ execution }: { execution: ExecutionDTO }) {
  const terminal = isTerminalExecution(execution.status);
  const meta = EXECUTION_STATUS[execution.status];
  return (
    <section aria-label="실행 진행" className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={meta.tone} icon testId="execution-status">
          {execution.status} · {meta.label}
        </Badge>
        <Badge tone={execution.mode === 'FIXTURE' ? 'warning' : 'accent'}>{execution.mode === 'FIXTURE' ? 'FIXTURE · 로컬 픽스처' : 'REAL_CHROME'}</Badge>
        <span className="text-[11.5px] text-muted tnum">
          {execution.profileAlias} · {fmtTime(execution.createdAt)}
        </span>
        {execution.status === 'SUCCESS' ? (
          <a
            href={execution.targetUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="view-comment"
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-fg px-3 py-1 text-[12px] font-semibold text-surface hover:bg-fg/85"
          >
            댓글 보기 <ExternalLink size={12} aria-hidden />
          </a>
        ) : null}
      </div>
      <ol className="grid grid-cols-6 gap-1" aria-label="실행 단계">
        {PHASES.map((p) => {
          const st = phaseState(p.steps, execution.events, terminal);
          return (
            <li key={p.key} className="flex flex-col items-center gap-1 text-center" aria-label={`${p.label} ${st}`}>
              {PHASE_ICON[st]}
              <span className={cx('text-[10.5px] font-semibold tracking-wide', st === 'WAITING' ? 'text-muted' : 'text-fg')}>{p.key}</span>
              <span className="text-[10.5px] leading-tight text-muted">{p.label}</span>
            </li>
          );
        })}
      </ol>
      <Outcome execution={execution} />
      {execution.events.length > 0 ? (
        <details className="rounded-lg border border-line bg-bg/40 px-3 py-2 text-[12px]" open={!terminal}>
          <summary className="cursor-pointer text-muted">이벤트 로그 {execution.events.length}건</summary>
          <ol className="mt-1.5 space-y-0.5">
            {execution.events.map((e, i) => (
              <li key={`${e.at}-${i}`} className="grid grid-cols-[62px_96px_1fr] gap-1.5 tnum">
                <span className="text-muted">{fmtTime(e.at)}</span>
                <span className={cx('font-mono text-[10.5px]', e.result === 'FAIL' ? 'text-danger' : e.result === 'OK' ? 'text-success' : 'text-muted')}>
                  {e.step}·{e.result}
                </span>
                <span className="break-words">{e.message}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
