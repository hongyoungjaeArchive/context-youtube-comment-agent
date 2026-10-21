import type { AppContext } from '../context.ts';
import type { PostingDriver } from '../execution/driver.ts';
import { Executor } from '../execution/executor.ts';
import { ensureDefaultProfile } from '../execution/profiles.ts';
import { JobQueue } from '../orchestrator/queue.ts';
import { registerAnalysisHandlers } from './analysis.ts';
import { applyRetention } from './retention.ts';

export interface Services {
  readonly ctx: AppContext;
  readonly queue: JobQueue;
  readonly executor: Executor;
}

export function createServices(ctx: AppContext, driver: PostingDriver): Services {
  const queue = new JobQueue(ctx);
  registerAnalysisHandlers(ctx, queue);
  const executor = new Executor(ctx, driver);
  ensureDefaultProfile(ctx);
  return { ctx, queue, executor };
}

/** 서버 시작 시 크래시 복구 (AI 작업 lease 만료 재예약 + 게시 실행 UNKNOWN/INTERRUPTED). */
export function recoverOnStartup(services: Services): { jobs: number; executions: number } {
  const jobs = services.queue.recover();
  const executions = services.executor.recover();
  applyRetention(services.ctx);
  if (jobs || executions) services.ctx.audit.record('system', 'startup', 'CRASH_RECOVERY', 'SYSTEM', { jobs, executions });
  return { jobs, executions };
}
