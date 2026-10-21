import type { z } from 'zod';

export type AgentRole = 'RESEARCH' | 'CONTEXT' | 'MARKETING' | 'QUALITY' | 'EXECUTION';

export type LlmErrorKind =
  | 'RATE_LIMITED'
  | 'SERVER'
  | 'OVERLOADED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'AUTH'
  | 'BILLING'
  | 'MODEL_UNAVAILABLE'
  | 'BAD_REQUEST'
  | 'INVALID_OUTPUT'
  | 'REFUSAL'
  | 'PROVIDER_UNAVAILABLE';

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly retryAfterMs: number | null;
  constructor(kind: LlmErrorKind, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.kind = kind;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export interface LlmRequest<T> {
  readonly role: AgentRole;
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
  readonly schema: z.ZodType<T>;
  readonly maxTokens: number;
  readonly effort: 'low' | 'medium' | 'high';
  /** 모의 클라이언트가 결정적으로 응답을 만들기 위한 구조화 입력 (실제 API에는 prompt만 전달). */
  readonly input: unknown;
}

export interface LlmResponse<T> {
  readonly data: T;
  readonly usage: LlmUsage;
  readonly modelId: string;
  readonly latencyMs: number;
}

export type LlmProvider = 'CLAUDE_CLI' | 'ANTHROPIC_API' | 'MOCK';
/** METERED = 종량 과금(API 키), SUBSCRIPTION = 구독 포함 사용량(추가 비용 없음), NONE = 모의. */
export type LlmBilling = 'METERED' | 'SUBSCRIPTION' | 'NONE';

export interface LlmClient {
  readonly mode: 'LIVE' | 'MOCK';
  readonly provider: LlmProvider;
  readonly billing: LlmBilling;
  generate<T>(req: LlmRequest<T>): Promise<LlmResponse<T>>;
}
