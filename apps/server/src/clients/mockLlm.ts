import { BRAND_NAME, checkCommentStatic, countChars } from '@context/shared';
import type { ContextOutput, MarketingOutput, QualityOutput, Strategy, VideoFitOutput } from '@context/shared';
import { LlmError, type LlmClient, type LlmErrorKind, type LlmRequest, type LlmResponse } from './llm.ts';

/** 에이전트가 모의 클라이언트에 넘기는 구조화 입력 형태. */
export interface MockEvidence {
  readonly id: string;
  readonly grade: string;
  readonly sourceType: string;
  readonly text: string;
}

export type MockFault =
  | { readonly kind: Exclude<LlmErrorKind, 'RATE_LIMITED'>; readonly role?: string }
  | { readonly kind: 'RATE_LIMITED'; readonly retryAfterMs: number; readonly role?: string }
  | { readonly kind: 'HALLUCINATED_QUOTE'; readonly role?: string };

/**
 * 결정적 모의 Claude 클라이언트 (테스트·크레딧 절약용).
 * 결과는 항상 mode=MOCK 으로 기록·표시되며 실제 모델 품질 측정치로 쓰지 않는다.
 */
export class MockLlmClient implements LlmClient {
  readonly mode = 'MOCK' as const;
  readonly provider = 'MOCK' as const;
  readonly billing = 'NONE' as const;
  readonly calls: { role: string; model: string }[] = [];
  private faults: MockFault[];

  constructor(faults: readonly MockFault[] = []) {
    this.faults = [...faults];
  }

  injectFault(fault: MockFault): void {
    this.faults = [...this.faults, fault];
  }

  async generate<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
    this.calls.push({ role: req.role, model: req.model });
    const faultIndex = this.faults.findIndex((f) => !f.role || f.role === req.role);
    let hallucinate = false;
    if (faultIndex >= 0) {
      const fault = this.faults[faultIndex]!;
      this.faults = this.faults.filter((_, i) => i !== faultIndex);
      if (fault.kind === 'HALLUCINATED_QUOTE') hallucinate = true;
      else if (fault.kind === 'RATE_LIMITED') throw new LlmError('RATE_LIMITED', '[모의] 429', fault.retryAfterMs);
      else throw new LlmError(fault.kind, `[모의 장애] ${fault.kind}`);
    }
    const data = this.respond(req, hallucinate);
    const parsed = req.schema.parse(data);
    return {
      data: parsed,
      modelId: req.model,
      latencyMs: 1,
      usage: { inputTokens: Math.ceil(req.prompt.length / 2), outputTokens: Math.ceil(JSON.stringify(data).length / 2), cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  }

  private respond(req: LlmRequest<unknown>, hallucinate: boolean): unknown {
    const input = req.input as Record<string, unknown>;
    switch (req.role) {
      case 'RESEARCH':
        return mockFit(input);
      case 'CONTEXT':
        return mockContext(input);
      case 'MARKETING':
        return mockMarketing(input, hallucinate);
      case 'QUALITY':
        return mockQuality(input);
      default:
        throw new LlmError('BAD_REQUEST', `[모의] 지원하지 않는 역할 ${req.role}`);
    }
  }
}

const ROMANCE_WORDS = ['연애', '연락', '이별', '재회', '썸', '고백', '남자', '여자', '사랑', '헤어', '남친', '여친', '결혼', '짝사랑', '심리', '인연'];

function mockFit(input: Record<string, unknown>): VideoFitOutput {
  const text = `${String(input.title ?? '')} ${String(input.description ?? '')}`;
  const hits = ROMANCE_WORDS.filter((w) => text.includes(w)).length;
  const romance = Math.min(5, hits + 1);
  return {
    ratings: {
      romance_relevance: { rating: romance, reason: `[모의] 연애 키워드 ${hits}개` },
      brand_fit: { rating: Math.min(5, romance), reason: '[모의] 연애 주제 ↔ 연애 사주 연결성' },
      evidence_depth: { rating: Number(input.commentCount ?? 0) > 0 ? 3 : 2, reason: '[모의] 제목·설명·댓글 확보 수준' },
      audience_interest: { rating: Number(input.viewCount ?? 0) > 3000 ? 4 : 3, reason: '[모의] 조회수 기반' },
    },
    summary: `[모의] 연애 키워드 ${hits}개가 확인된 영상`,
  };
}

function firstSentence(text: string, max: number): string {
  const cleaned = text.replace(/\[[^\]]*\]\s*/g, '').replace(/\s+/g, ' ').trim();
  const cut = cleaned.split(/[.?!\n]/)[0] ?? cleaned;
  return Array.from(cut).slice(0, max).join('');
}

function evidenceOf(input: Record<string, unknown>): MockEvidence[] {
  return (input.evidence as MockEvidence[] | undefined) ?? [];
}

function mockContext(input: Record<string, unknown>): ContextOutput {
  const ev = evidenceOf(input);
  const title = ev.find((e) => e.sourceType === 'TITLE');
  const quote = ev.find((e) => e.grade === 'A');
  const comments = ev.filter((e) => e.grade === 'C');
  const topic = firstSentence(title?.text ?? '연애 고민', 34);
  return {
    core_problem: `${topic} — 상대 마음을 알 수 없어 생기는 불안`,
    evidence_ids: [title?.id, quote?.id].filter((x): x is string => Boolean(x)),
    audience_insights: comments.slice(0, 2).map((c) => `[모의] 시청자 반응: ${firstSentence(c.text, 30)}`),
    limitations: quote ? [] : ['직접 확인된 영상 발언(A 등급)이 없어 구체적 장면 인용 불가'],
    requested_checks: quote ? [] : ['영상을 직접 보고 핵심 발언 1개와 타임스탬프를 근거로 추가해 주세요'],
  };
}

function fitLength(text: string): string {
  const chars = Array.from(text);
  return chars.length > 118 ? chars.slice(0, 117).join('') + '.' : text;
}

const VARIANTS: Record<Strategy, readonly ((p: string) => string)[]> = {
  EMPATHY: [
    (p) => `"${p}" 이 말이 계속 맴도네요. 나만 이런 고민 하는 게 아니었구나 싶어요. ${BRAND_NAME} 연애사주로 내 인연 흐름도 한번 보고 싶어지네요.`,
    (p) => `"${p}" 듣는데 괜히 울컥했어요ㅠ 다들 비슷하게 마음 졸이는구나. 이럴 땐 ${BRAND_NAME}에서 연애 사주라도 봐야 하나 싶네요.`,
    (p) => `영상 속 "${p}" 부분에서 제 얘기인 줄 알았어요. 혼자 끙끙대지 말고 ${BRAND_NAME} 연애사주로 흐름부터 봐야겠다는 생각이 드네요.`,
    (p) => `"${p}"라는 말 진짜 공감해요. 머리로는 아는데 마음이 안 따라주는 거죠. ${BRAND_NAME} 가서 연애 사주 한번 보고 정리하고 싶어요.`,
  ],
  QUESTION: [
    (p) => `영상에서 "${p}" 부분 보고 궁금해졌어요. 다들 이럴 때 먼저 연락하시나요? ${BRAND_NAME}에서 연애 사주로 타이밍을 한번 보고 싶네요.`,
    (p) => `"${p}" 이 상황이면 기다리는 게 맞을까요, 먼저 다가가는 게 맞을까요? 저는 ${BRAND_NAME} 연애사주로 제 시기부터 확인해볼까 해요.`,
    (p) => `혹시 "${p}" 같은 경험 있으신 분 계세요? 어떻게 넘기셨는지 궁금해요. 저는 ${BRAND_NAME}에서 연애운부터 보고 싶어졌어요.`,
    (p) => `"${p}" 얘기 나왔을 때 다들 어떤 생각 드셨어요? 저는 제 인연이 언제쯤일지 ${BRAND_NAME} 연애 사주로 물어보고 싶더라고요.`,
  ],
  INFO: [
    (p) => `"${p}" 얘기처럼 마음이 헷갈릴 땐 내 연애 흐름을 아는 게 먼저인 듯해요. ${BRAND_NAME}에서 연애 사주를 볼 수 있다니 참고해볼 만해요.`,
    (p) => `영상의 "${p}" 포인트 정리해두면 좋겠어요. 그리고 내 시기가 궁금하면 ${BRAND_NAME}에서 연애 사주도 볼 수 있으니 같이 참고하면 좋을 듯.`,
    (p) => `"${p}" 같은 고민엔 상대 마음만큼 내 연애 패턴 파악도 중요하대요. ${BRAND_NAME}이 연애 사주 보는 곳이라 패턴 확인용으로 괜찮을 것 같아요.`,
    (p) => `오늘 영상 핵심은 "${p}" 같아요. 감정 정리가 안 될 땐 ${BRAND_NAME}에서 연애 사주로 큰 흐름을 보는 것도 방법이에요.`,
  ],
};

function bigramSim(a: string, b: string): number {
  const grams = (t: string) => {
    const s = t.replace(/\s/g, '');
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return A.size + B.size - inter === 0 ? 0 : inter / (A.size + B.size - inter);
}

function mockMarketing(input: Record<string, unknown>, hallucinate: boolean): MarketingOutput {
  const ev = evidenceOf(input);
  const avoid = (input.avoid_similar_to as string[] | undefined) ?? [];
  const quoteEv = ev.find((e) => e.grade === 'A') ?? ev.find((e) => e.sourceType === 'TITLE');
  const used = quoteEv ? [quoteEv.id] : [];
  const phrase = hallucinate ? '영상에 나오지 않은 지어낸 대사' : firstSentence(quoteEv?.text ?? '이 고민', 22);
  const candidates = (Object.keys(VARIANTS) as Strategy[]).map((strategy) => {
    // 다른 영상 댓글과 가장 덜 비슷한 변형을 고른다 (실제 모델의 "비슷하게 쓰지 말 것" 지시 준수를 흉내).
    const options = VARIANTS[strategy].map((v) => fitLength(v(phrase)));
    const scored = options.map((c) => ({ c, sim: avoid.reduce((m, o) => Math.max(m, bigramSim(c, o)), 0) }));
    let content = scored.sort((x, y) => x.sim - y.sim)[0]!.c;
    while (countChars(content) < 40) content = `${content} 공감돼요.`;
    return { strategy, content, used_evidence_ids: used, rationale: `[모의] ${strategy} 전략 템플릿`, no_fit: false };
  });
  return { strategy_summary: '[모의] 근거 인용 + 브랜드 연결 템플릿', brand_facts_used: ['BF-1'], candidates };
}

function mockQuality(input: Record<string, unknown>): QualityOutput {
  const revisions = (input.revisions as { id: string; content: string; citesGradeA: boolean }[] | undefined) ?? [];
  return {
    reviews: revisions.map((r) => {
      const s = checkCommentStatic(r.content);
      const brand = r.content.includes(BRAND_NAME);
      return {
        candidate_ref: r.id,
        ratings: {
          context_match: { rating: r.citesGradeA ? 5 : 3, reason: r.citesGradeA ? '[모의] 직접 확인 근거 인용' : '[모의] 메타데이터 수준 근거' },
          brand_relevance: { rating: brand ? 4 : 1, reason: brand ? '[모의] 브랜드 자연 언급' : '[모의] 브랜드 언급 없음' },
          naturalness: { rating: 4, reason: '[모의] 시청자 말투' },
          uniqueness: { rating: r.content.includes('"') ? 4 : 3, reason: '[모의] 영상 고유 표현 포함 여부' },
          factuality: { rating: s.ok ? 5 : 1, reason: s.ok ? '[모의] 정적 규칙 통과' : '[모의] 정적 규칙 위반' },
        },
        risk_flags: s.violations.map((v) => v.code),
        improvement: s.ok ? null : '[모의] 규칙 위반 표현을 고쳐 주세요',
      };
    }),
  };
}
