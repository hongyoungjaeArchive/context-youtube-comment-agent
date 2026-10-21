import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { LlmError, type LlmClient, type LlmRequest, type LlmResponse } from './llm.ts';

const REQUEST_TIMEOUT_MS = 120_000;

/**
 * 실제 Claude API 클라이언트.
 * SDK 자체 재시도는 끈다(maxRetries: 0) — 재시도는 오케스트레이터가 한 곳에서만 수행한다 (docs/06 §6, docs/07 §6).
 */
/** 종량 과금 Provider — 기본 비활성. 설정에서 명시적으로 켜야만 사용된다. */
export class AnthropicLlmClient implements LlmClient {
  readonly mode = 'LIVE' as const;
  readonly provider = 'ANTHROPIC_API' as const;
  readonly billing = 'METERED' as const;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 0, timeout: REQUEST_TIMEOUT_MS });
  }

  async generate<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
    const started = Date.now();
    try {
      const response = await this.client.messages.parse({
        model: req.model,
        max_tokens: req.maxTokens,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: req.prompt }],
        output_config: { format: zodOutputFormat(req.schema as never), effort: req.effort },
      });
      if (response.stop_reason === 'refusal') {
        throw new LlmError('REFUSAL', '모델이 요청을 거절했습니다 (refusal).');
      }
      if (response.stop_reason === 'max_tokens') {
        throw new LlmError('INVALID_OUTPUT', '출력이 max_tokens에서 잘렸습니다.');
      }
      const parsed = response.parsed_output as T | null;
      if (parsed === null || parsed === undefined) {
        throw new LlmError('INVALID_OUTPUT', '구조화 출력 파싱에 실패했습니다.');
      }
      const usage = response.usage;
      return {
        data: parsed,
        modelId: response.model,
        latencyMs: Date.now() - started,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
        },
      };
    } catch (error) {
      throw normalizeAnthropicError(error);
    }
  }
}

export function normalizeAnthropicError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new LlmError('TIMEOUT', 'Claude API 응답 시간 초과');
  if (error instanceof Anthropic.APIConnectionError) return new LlmError('NETWORK', 'Claude API 네트워크 오류');
  if (error instanceof Anthropic.RateLimitError) {
    const header = error.headers?.get('retry-after');
    const seconds = header ? Number(header) : NaN;
    return new LlmError('RATE_LIMITED', 'Claude API 요청 한도 초과 (429)', Number.isFinite(seconds) ? seconds * 1000 : null);
  }
  if (error instanceof Anthropic.AuthenticationError) return new LlmError('AUTH', 'Claude API 키 인증 실패 (401)');
  if (error instanceof Anthropic.PermissionDeniedError) return new LlmError('AUTH', 'Claude API 권한 거부 (403)');
  if (error instanceof Anthropic.NotFoundError) return new LlmError('MODEL_UNAVAILABLE', '모델을 사용할 수 없습니다 (404)');
  if (error instanceof Anthropic.BadRequestError) {
    const msg = error.message.toLowerCase();
    if (msg.includes('credit') || msg.includes('billing')) return new LlmError('BILLING', '크레딧/결제 문제로 요청이 거절되었습니다.');
    return new LlmError('BAD_REQUEST', 'Claude API 요청 형식 오류 (400)');
  }
  if (error instanceof Anthropic.APIError) {
    if (error.status === 529) return new LlmError('OVERLOADED', 'Claude API 과부하 (529)');
    if (typeof error.status === 'number' && error.status >= 500) return new LlmError('SERVER', `Claude API 서버 오류 (${error.status})`);
    return new LlmError('BAD_REQUEST', `Claude API 오류 (${String(error.status)})`);
  }
  return new LlmError('INVALID_OUTPUT', '알 수 없는 Claude 클라이언트 오류');
}

/** 키 유효성 확인 — Models API 조회(토큰 비용 없음). 키 원문은 반환·로그하지 않는다. */
export async function verifyAnthropicKey(apiKey: string, modelId: string): Promise<{ ok: boolean; message: string }> {
  try {
    const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 15_000 });
    const model = await client.models.retrieve(modelId);
    return { ok: true, message: `키 확인 완료 · 모델 ${model.id} 사용 가능` };
  } catch (error) {
    const e = normalizeAnthropicError(error);
    return { ok: false, message: e.message };
  }
}
