import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { AnthropicLlmClient, normalizeAnthropicError } from '../clients/anthropicClient.ts';

/** 종량 과금 Provider는 기본 비활성 — 네트워크 호출 없이 오류 분류·메타데이터만 검증한다. */
describe('Anthropic API provider (metered, opt-in only)', () => {
  it('declares METERED billing', () => {
    const c = new AnthropicLlmClient('not-a-real-key');
    expect(c.billing).toBe('METERED');
    expect(c.provider).toBe('ANTHROPIC_API');
  });
  it.each([
    [new Anthropic.RateLimitError(429, undefined, 'rate', new Headers({ 'retry-after': '2' })), 'RATE_LIMITED', 2000],
    [new Anthropic.AuthenticationError(401, undefined, 'auth', new Headers()), 'AUTH', null],
    [new Anthropic.NotFoundError(404, undefined, 'nf', new Headers()), 'MODEL_UNAVAILABLE', null],
    [new Anthropic.BadRequestError(400, undefined, 'Your credit balance is too low', new Headers()), 'BILLING', null],
    [new Anthropic.InternalServerError(500, undefined, 'boom', new Headers()), 'SERVER', null],
    [new Anthropic.APIConnectionTimeoutError({ message: 't' }), 'TIMEOUT', null],
  ])('%#: maps to %s', (err, kind, retry) => {
    const e = normalizeAnthropicError(err);
    expect(e.kind).toBe(kind);
    expect(e.retryAfterMs).toBe(retry);
  });
});
