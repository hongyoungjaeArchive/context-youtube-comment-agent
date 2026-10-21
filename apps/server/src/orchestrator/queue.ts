import type { JobDTO, JobStatus, JobType } from '@context/shared';
import { LlmError } from '../clients/llm.ts';
import type { AppContext } from '../context.ts';
import { newId } from '../lib/ids.ts';
import { BudgetBlockedError } from './llmRunner.ts';

/** docs/07 §2 우선순위. 낮을수록 먼저. */
export const PRIORITY = {
  REVALIDATE: 0,
  CONTEXT: 1,
  GENERATE: 2,
  RECOMMEND: 3,
  PRESCORE: 4,
  EVAL: 5,
} as const;

const LEASE_MS = 180_000;
const MAX_RETRY_DELAY_MS = 60_000;
const BASE_BACKOFF_MS = 1_000;

export interface JobRow {
  job_id: string;
  job_type: JobType;
  subject_id: string;
  status: JobStatus;
  priority: number;
  idempotency_key: string;
  dependency_json: string;
  payload_json: string;
  attempt_count: number;
  max_attempts: number;
  lease_until: string | null;
  run_after: string | null;
  model_id: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type JobOutcome = { readonly status: 'COMPLETED' | 'NEEDS_REVIEW'; readonly modelId?: string | null; readonly message?: string };
export type JobHandler = (job: JobRow, attemptId: string) => Promise<JobOutcome>;
export type JobFailureHook = (job: JobRow, status: JobStatus, message: string) => void;

export interface EnqueueInput {
  readonly type: JobType;
  readonly subjectId: string;
  readonly priority: number;
  readonly idempotencyKey: string;
  readonly dependencies?: readonly string[];
  readonly payload?: Record<string, unknown>;
  readonly maxAttempts?: number;
}

const ACTIVE: readonly JobStatus[] = ['QUEUED', 'WAITING_DEPENDENCY', 'RUNNING', 'RATE_LIMITED', 'RETRY_SCHEDULED'];

/**
 * SQLite 기반 AI 작업 큐 (docs/07 §2~3).
 * QUEUED → WAITING_DEPENDENCY → RUNNING → COMPLETED / FAILED / NEEDS_REVIEW / BUDGET_BLOCKED, 429 → RETRY_SCHEDULED.
 * lease로 크래시 후 이중 실행을 막고, 같은 idempotency_key는 기존 작업을 돌려준다.
 */
export class JobQueue {
  private readonly handlers = new Map<JobType, JobHandler>();
  private readonly failureHooks: JobFailureHook[] = [];
  private running = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly inflight = new Set<Promise<void>>();

  private readonly ctx: AppContext;
  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  register(type: JobType, handler: JobHandler): void {
    this.handlers.set(type, handler);
  }

  onTerminalFailure(hook: JobFailureHook): void {
    this.failureHooks.push(hook);
  }

  enqueue(input: EnqueueInput): { job: JobRow; created: boolean } {
    const db = this.ctx.db;
    return db.transaction(() => {
      const existing = db.prepare('SELECT * FROM ai_jobs WHERE idempotency_key = ?').get(input.idempotencyKey) as JobRow | undefined;
      if (existing && existing.status !== 'FAILED' && existing.status !== 'CANCELLED' && existing.status !== 'BUDGET_BLOCKED') {
        return { job: existing, created: false };
      }
      const now = this.ctx.clock().toISOString();
      const key = existing ? `${input.idempotencyKey}#${newId('r')}` : input.idempotencyKey;
      if (existing) {
        // 실패한 같은 작업을 사용자가 다시 요청한 경우: 이전 키를 보존하기 위해 이전 행 키를 변경한다.
        db.prepare('UPDATE ai_jobs SET idempotency_key = ? WHERE job_id = ?').run(key, existing.job_id);
      }
      const jobId = newId('job');
      const deps = input.dependencies ?? [];
      db.prepare(
        `INSERT INTO ai_jobs (job_id, job_type, subject_id, status, priority, idempotency_key, dependency_json, payload_json, max_attempts, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(jobId, input.type, input.subjectId, deps.length ? 'WAITING_DEPENDENCY' : 'QUEUED', input.priority, input.idempotencyKey, JSON.stringify(deps), JSON.stringify(input.payload ?? {}), input.maxAttempts ?? 3, now, now);
      return { job: this.get(jobId)!, created: true };
    })();
  }

  get(jobId: string): JobRow | null {
    return (this.ctx.db.prepare('SELECT * FROM ai_jobs WHERE job_id = ?').get(jobId) as JobRow | undefined) ?? null;
  }

  list(limit = 100): JobDTO[] {
    const rows = this.ctx.db.prepare('SELECT * FROM ai_jobs ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as JobRow[];
    return rows.map(toJobDTO);
  }

  counts(): Record<string, number> {
    const rows = this.ctx.db.prepare('SELECT status, COUNT(*) n FROM ai_jobs GROUP BY status').all() as { status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  /** 서버 시작 시: lease가 만료된 RUNNING 작업을 재예약 (크래시 복구). */
  recover(): number {
    const now = this.ctx.clock().toISOString();
    const res = this.ctx.db
      .prepare("UPDATE ai_jobs SET status = 'RETRY_SCHEDULED', lease_until = NULL, run_after = ?, updated_at = ? WHERE status = 'RUNNING' AND (lease_until IS NULL OR lease_until < ?)")
      .run(now, now, now);
    return res.changes;
  }

  start(intervalMs = 250): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled([...this.inflight]);
  }

  /** 테스트/평가용: 실행 가능한 작업이 없을 때까지 처리. */
  async drain(maxRounds = 400, maxWaitMs = 2_000): Promise<void> {
    for (let i = 0; i < maxRounds; i++) {
      const started = this.tick();
      if (this.inflight.size === 0 && !started) {
        // 곧 재시도될 작업(짧은 retry-after)이 있으면 그때까지 기다린다.
        const soon = new Date(this.ctx.clock().getTime() + maxWaitMs).toISOString();
        const next = this.ctx.db
          .prepare("SELECT MIN(run_after) t FROM ai_jobs WHERE status IN ('RETRY_SCHEDULED','RATE_LIMITED') AND run_after <= ?")
          .get(soon) as { t: string | null };
        if (!next.t) return;
        await new Promise((r) => setTimeout(r, Math.max(1, new Date(next.t!).getTime() - this.ctx.clock().getTime())));
        continue;
      }
      await Promise.race([...this.inflight, new Promise((r) => setTimeout(r, 5))]);
    }
  }

  /** 실행 가능한 작업을 동시성 한도까지 시작. 하나라도 시작하면 true. */
  tick(): boolean {
    const limit = this.ctx.settings.get().maxConcurrency;
    let started = false;
    while (this.running < limit) {
      const job = this.claimNext();
      if (!job) break;
      started = true;
      this.running++;
      const p = this.execute(job).finally(() => {
        this.running--;
        this.inflight.delete(p);
      });
      this.inflight.add(p);
    }
    return started;
  }

  private claimNext(): JobRow | null {
    const db = this.ctx.db;
    return db.transaction(() => {
      const now = this.ctx.clock().toISOString();
      const candidates = db
        .prepare(
          `SELECT * FROM ai_jobs WHERE status IN ('QUEUED','WAITING_DEPENDENCY','RETRY_SCHEDULED','RATE_LIMITED')
           AND (run_after IS NULL OR run_after <= ?) ORDER BY priority ASC, created_at ASC, rowid ASC LIMIT 50`,
        )
        .all(now) as JobRow[];
      for (const job of candidates) {
        const deps = JSON.parse(job.dependency_json) as string[];
        const depRows = deps.map((d) => this.get(d));
        const failedDep = depRows.find((d) => !d || ['FAILED', 'CANCELLED', 'BUDGET_BLOCKED', 'NEEDS_REVIEW'].includes(d.status));
        if (failedDep !== undefined) {
          this.finish(job, 'FAILED', 'DEPENDENCY_FAILED', `선행 작업 ${failedDep?.job_id ?? '?'} 이(가) 완료되지 않았습니다.`);
          continue;
        }
        if (depRows.some((d) => d!.status !== 'COMPLETED')) {
          if (job.status !== 'WAITING_DEPENDENCY') db.prepare("UPDATE ai_jobs SET status='WAITING_DEPENDENCY', updated_at=? WHERE job_id=?").run(now, job.job_id);
          continue;
        }
        const lease = new Date(this.ctx.clock().getTime() + LEASE_MS).toISOString();
        const res = db
          .prepare("UPDATE ai_jobs SET status='RUNNING', lease_until=?, attempt_count=attempt_count+1, updated_at=? WHERE job_id=? AND status != 'RUNNING'")
          .run(lease, now, job.job_id);
        if (res.changes === 1) return this.get(job.job_id);
      }
      return null;
    })();
  }

  private async execute(job: JobRow): Promise<void> {
    const handler = this.handlers.get(job.job_type);
    const attemptId = newId('att');
    const startedAt = this.ctx.clock().toISOString();
    this.ctx.db
      .prepare('INSERT INTO ai_job_attempts (attempt_id, job_id, attempt_index, started_at) VALUES (?,?,?,?)')
      .run(attemptId, job.job_id, job.attempt_count, startedAt);
    let errorCode: string | null = null;
    let modelId: string | null = null;
    try {
      if (!handler) throw new Error(`핸들러 없음: ${job.job_type}`);
      const outcome = await handler(job, attemptId);
      modelId = outcome.modelId ?? null;
      this.finish(job, outcome.status, null, outcome.message ?? null, modelId);
    } catch (error) {
      errorCode = this.handleError(job, error);
    } finally {
      this.ctx.db
        .prepare('UPDATE ai_job_attempts SET finished_at = ?, error_code = ?, model_id = ? WHERE attempt_id = ?')
        .run(this.ctx.clock().toISOString(), errorCode, modelId, attemptId);
    }
  }

  private handleError(job: JobRow, error: unknown): string {
    const fresh = this.get(job.job_id)!;
    if (error instanceof BudgetBlockedError) {
      this.finish(fresh, 'BUDGET_BLOCKED', 'BUDGET_BLOCKED', error.message);
      return 'BUDGET_BLOCKED';
    }
    if (error instanceof LlmError) {
      const canRetry = fresh.attempt_count < fresh.max_attempts;
      switch (error.kind) {
        case 'RATE_LIMITED': {
          if (!canRetry) break;
          const delay = Math.min(error.retryAfterMs ?? BASE_BACKOFF_MS * 2 ** fresh.attempt_count, MAX_RETRY_DELAY_MS);
          this.schedule(fresh, 'RETRY_SCHEDULED', delay, error.kind, error.message);
          return error.kind;
        }
        case 'SERVER':
        case 'OVERLOADED':
        case 'TIMEOUT':
        case 'NETWORK': {
          if (!canRetry) break;
          this.schedule(fresh, 'RETRY_SCHEDULED', Math.min(BASE_BACKOFF_MS * 2 ** fresh.attempt_count, MAX_RETRY_DELAY_MS), error.kind, error.message);
          return error.kind;
        }
        case 'INVALID_OUTPUT':
          if (fresh.attempt_count < 2) {
            this.schedule(fresh, 'RETRY_SCHEDULED', BASE_BACKOFF_MS, error.kind, error.message);
            return error.kind;
          }
          this.finish(fresh, 'NEEDS_REVIEW', error.kind, error.message);
          return error.kind;
        default:
          // AUTH / BILLING / BAD_REQUEST / REFUSAL / MODEL_UNAVAILABLE: 즉시 중단, 사람 해결 필요.
          break;
      }
      this.finish(fresh, 'FAILED', error.kind, error.message);
      return error.kind;
    }
    const message = error instanceof Error ? error.message : String(error);
    this.finish(fresh, 'FAILED', 'INTERNAL', message);
    return 'INTERNAL';
  }

  private schedule(job: JobRow, status: JobStatus, delayMs: number, code: string, message: string): void {
    const now = this.ctx.clock();
    this.ctx.db
      .prepare('UPDATE ai_jobs SET status=?, run_after=?, lease_until=NULL, error_code=?, error_message=?, updated_at=? WHERE job_id=?')
      .run(status, new Date(now.getTime() + delayMs).toISOString(), code, message, now.toISOString(), job.job_id);
  }

  private finish(job: JobRow, status: JobStatus, code: string | null, message: string | null, modelId: string | null = null): void {
    this.ctx.db
      .prepare('UPDATE ai_jobs SET status=?, lease_until=NULL, error_code=?, error_message=?, model_id=COALESCE(?, model_id), updated_at=? WHERE job_id=?')
      .run(status, code, message, modelId, this.ctx.clock().toISOString(), job.job_id);
    if (status !== 'COMPLETED') {
      this.ctx.audit.record('ai_job', job.job_id, `JOB_${status}`, 'SYSTEM', { type: job.job_type, code, message });
      for (const hook of this.failureHooks) hook(job, status, message ?? status);
    }
  }

  cancel(jobId: string): boolean {
    const res = this.ctx.db
      .prepare(`UPDATE ai_jobs SET status='CANCELLED', updated_at=? WHERE job_id=? AND status IN (${ACTIVE.filter((s) => s !== 'RUNNING').map(() => '?').join(',')})`)
      .run(this.ctx.clock().toISOString(), jobId, ...ACTIVE.filter((s) => s !== 'RUNNING'));
    return res.changes === 1;
  }
}

export function toJobDTO(r: JobRow): JobDTO {
  return {
    id: r.job_id,
    type: r.job_type,
    status: r.status,
    priority: r.priority,
    attempts: r.attempt_count,
    modelId: r.model_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    subjectId: r.subject_id,
  };
}
