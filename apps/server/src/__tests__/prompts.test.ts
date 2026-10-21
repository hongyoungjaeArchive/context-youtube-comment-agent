import { describe, expect, it } from 'vitest';
import { DEFAULT_PROMPT_VERSION } from '@context/shared';
import { systemPrompt } from '../agents/prompts.ts';

describe('prompt B-1.2 (과제: 자막 없으면 제목·설명)', () => {
  it('asks Marketing to name a concrete item from the title/description instead of staying at topic level', () => {
    const p = systemPrompt('B-1.2', 'MARKETING');
    expect(p).not.toContain('주제 수준으로만');
    expect(p).toContain('설명에 나온 구체적인 항목');
    expect(p).toContain('운명원');
  });

  it('keeps the fact rules and injection guard', () => {
    const p = systemPrompt('B-1.2', 'MARKETING');
    expect(p).toContain('사실성 규칙');
    expect(p).toContain('<untrusted_data>');
  });
});

describe('prompt B-1.3 (과제: 시청자 페르소나)', () => {
  it('lets Marketing write in a viewer voice but still forbids fabricated 운명원 reviews', () => {
    const p = systemPrompt('B-1.3', 'MARKETING');
    expect(p).not.toContain('가짜 개인 체험 금지');
    expect(p).toContain('시청자 페르소나');
    expect(p).toContain('운명원을 직접 이용했다는 후기');
    expect(p).toContain('설명에 나온 구체적인 항목');
  });

  it('tells Quality not to treat a viewer voice as a factuality violation', () => {
    const p = systemPrompt('B-1.3', 'QUALITY');
    expect(p).toContain('시청자 페르소나');
    expect(p).toContain('brand_facts');
  });
});

describe('prompt B-2.0 (과제 예시 말투 + 자막 우선)', () => {
  it('is the default version', () => {
    expect(DEFAULT_PROMPT_VERSION).toBe('B-2.0');
  });

  it('asks Marketing to quote a subtitle line first and follow the brief example structure', () => {
    const p = systemPrompt('B-2.0', 'MARKETING');
    expect(p).toContain('자막(TRANSCRIPT)');
    expect(p).toContain('맨날 연애하면 차이기만 했던 1인');
    expect(p).toContain('보고 싶다');
    expect(p).toContain('맞춤법');
  });

  it('still forbids fabricated 운명원 reviews and reputation claims', () => {
    const p = systemPrompt('B-2.0', 'MARKETING');
    expect(p).toContain('운명원을 직접 이용했다는 후기');
    expect(p).toContain('유명세·적중률');
    expect(p).toContain('<untrusted_data>');
  });

  it('tells Context and Quality that subtitles are machine transcripts with possible typos', () => {
    expect(systemPrompt('B-2.0', 'CONTEXT')).toContain('자동 자막');
    expect(systemPrompt('B-2.0', 'QUALITY')).toContain('자막');
  });
});
