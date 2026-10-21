import { z } from 'zod';
import { DEFAULT_PROMPT_VERSION, type SageAnswerDTO, type SageAskRequest } from '@context/shared';
import { INJECTION_GUARD, untrusted } from '../agents/prompts.ts';
import type { AppContext } from '../context.ts';
import { AppError } from '../lib/errors.ts';
import { localDate } from '../lib/time.ts';
import { BudgetBlockedError, runAgentCall } from '../orchestrator/llmRunner.ts';

/**
 * Sage — 콘솔 비서. 지금 화면의 숫자(상황 요약)만 근거로 답하는 읽기 전용 질의응답.
 * 새 AI 역할을 만들지 않고 RESEARCH 역할로 호출한다 (CLAUDE.md 4번, CHG-2026-10-21-02). 게시·승인·설정 변경 권한 없음.
 */

const DEFAULT_TIMEOUT_MS = 60_000;
const RECENT_EXECUTIONS = 3;
const MAX_ANSWER_CHARS = 1200;
const MAX_OUTPUT_TOKENS = 600;

const SageAnswerSchema = z.object({ answer: z.string().min(1).max(MAX_ANSWER_CHARS) });

const SAGE_SYSTEM = `역할: CONTEXT 콘솔 비서 Sage.
목표: 운영자가 지금 콘솔 상황을 빨리 파악하도록 돕는다.
규칙: 한국어 3~5문장. console_state에 있는 사실과 숫자만 쓰고, 없는 수치는 지어내지 말고 "지금 화면 정보로는 알 수 없어요"라고 말한다. console_state의 필드 이름(reserved, running, waiting 같은 영어 키)은 그대로 쓰지 말고 "예약된 게시", "실행 중인 작업", "대기 중인 작업"처럼 쉬운 한국어로 바꿔 말한다. 너는 댓글 게시·승인·설정 변경을 할 수 없다 — 요청받으면 운영자가 직접 해야 한다고 안내한다.
${INJECTION_GUARD}`;

interface QueueCounts {
  counts(): Record<string, number>;
}

export interface SageContextSnapshot {
  readonly daily: { readonly localDate: string; readonly reserved: number; readonly limit: number };
  readonly queue: { readonly running: number; readonly waiting: number };
  readonly aiProvider: string;
  readonly selectedVideo: {
    readonly videoId: string;
    readonly title: string;
    readonly channelTitle: string;
    readonly latestAnalysisStatus: string | null;
    readonly candidateStatuses: readonly string[];
  } | null;
  readonly recentExecutions: readonly { readonly status: string; readonly at: string }[];
}

function selectedVideoSnapshot(ctx: AppContext, videoId: string | null): SageContextSnapshot['selectedVideo'] {
  if (!videoId) return null;
  const video = ctx.db.prepare('SELECT video_id, title, channel_name FROM videos WHERE video_id = ?').get(videoId) as
    | { video_id: string; title: string; channel_name: string }
    | undefined;
  if (!video) return null;
  const analysis = ctx.db
    .prepare('SELECT analysis_id, status FROM video_analyses WHERE video_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1')
    .get(videoId) as { analysis_id: string; status: string } | undefined;
  const candidates = analysis
    ? (ctx.db
        .prepare(
          `SELECT c.strategy,
             EXISTS (SELECT 1 FROM approvals a JOIN comment_revisions r ON r.revision_id = a.revision_id
                     WHERE r.candidate_id = c.candidate_id AND a.invalidated_at IS NULL) AS approved
           FROM comment_candidates c WHERE c.analysis_id = ? ORDER BY c.strategy`,
        )
        .all(analysis.analysis_id) as { strategy: string; approved: number }[])
    : [];
  return {
    videoId: video.video_id,
    title: video.title,
    channelTitle: video.channel_name,
    latestAnalysisStatus: analysis?.status ?? null,
    candidateStatuses: candidates.map((c) => `${c.strategy}: ${c.approved ? '승인됨' : '승인 대기'}`),
  };
}

export async function buildSageContext(ctx: AppContext, queue: QueueCounts, selectedVideoId: string | null): Promise<SageContextSnapshot> {
  const day = localDate(ctx.clock());
  const usage = ctx.db.prepare('SELECT submit_attempts_reserved n FROM daily_usage WHERE local_date = ?').get(day) as { n: number } | undefined;
  const counts = queue.counts();
  const modes = await ctx.modes();
  const executions = ctx.db
    .prepare('SELECT status, created_at FROM execution_jobs ORDER BY created_at DESC, rowid DESC LIMIT ?')
    .all(RECENT_EXECUTIONS) as { status: string; created_at: string }[];
  return {
    daily: { localDate: day, reserved: usage?.n ?? 0, limit: ctx.settings.get().dailyMaxComments },
    queue: { running: counts.RUNNING ?? 0, waiting: (counts.QUEUED ?? 0) + (counts.WAITING_DEPENDENCY ?? 0) + (counts.RETRY_SCHEDULED ?? 0) },
    aiProvider: modes.aiProvider,
    selectedVideo: selectedVideoSnapshot(ctx, selectedVideoId),
    recentExecutions: executions.map((e) => ({ status: e.status, at: e.created_at })),
  };
}

function mockAnswer(s: SageContextSnapshot): string {
  const base = `오늘 게시 ${s.daily.reserved}/${s.daily.limit}건 예약됐고, 작업 ${s.queue.running}건 실행 중·${s.queue.waiting}건 대기 중이에요.`;
  const video = s.selectedVideo ? ` 선택한 영상은 「${s.selectedVideo.title}」이고 분석 상태는 ${s.selectedVideo.latestAnalysisStatus ?? '없음'}이에요.` : '';
  return `${base}${video} (모의 모드 답변)`;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError('SAGE_TIMEOUT', 'Sage 답변이 너무 오래 걸려요. 잠시 후 다시 물어봐 주세요.', 504)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function toSageError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof BudgetBlockedError) return new AppError('SAGE_BUDGET', 'AI 예산 한도에 걸려 Sage가 답할 수 없어요. 설정에서 예산을 확인해 주세요.', 409);
  return new AppError('SAGE_UNAVAILABLE', 'Sage가 지금 답할 수 없어요. 잠시 후 다시 시도해 주세요.', 502);
}

export function createSageService(ctx: AppContext, queue: QueueCounts, opts: { timeoutMs?: number } = {}): { ask(req: SageAskRequest): Promise<SageAnswerDTO> } {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let inFlight = false;

  async function callModel(question: string, snapshot: SageContextSnapshot): Promise<SageAnswerDTO> {
    const res = await runAgentCall(ctx, {
      jobId: null,
      attemptId: null,
      role: 'RESEARCH',
      tier: 'light',
      system: SAGE_SYSTEM,
      prompt: `${untrusted('console_state', snapshot)}\n${untrusted('question', question)}`,
      schema: SageAnswerSchema,
      maxTokens: MAX_OUTPUT_TOKENS,
      input: { kind: 'SAGE' },
      promptVersion: DEFAULT_PROMPT_VERSION,
      dataHash: null,
    });
    return { answer: res.data.answer, aiMode: res.aiMode };
  }

  return {
    async ask(req) {
      if (inFlight) throw new AppError('SAGE_BUSY', 'Sage가 이전 질문에 답하는 중이에요. 잠시만 기다려 주세요.', 409);
      inFlight = true;
      let call: Promise<SageAnswerDTO> | null = null;
      try {
        const snapshot = await buildSageContext(ctx, queue, req.selectedVideoId ?? null);
        const llm = await ctx.getLlm();
        if (llm.mode === 'MOCK') return { answer: mockAnswer(snapshot), aiMode: 'MOCK' };
        call = callModel(req.question, snapshot);
        return await withTimeout(call, timeoutMs);
      } catch (error) {
        throw toSageError(error);
      } finally {
        // 시간 초과로 먼저 응답해도, 실제 모델 호출이 끝날 때까지는 BUSY로 둔다 (중복 호출 방지).
        if (call) void call.catch(() => undefined).finally(() => (inFlight = false));
        else inFlight = false;
      }
    },
  };
}
