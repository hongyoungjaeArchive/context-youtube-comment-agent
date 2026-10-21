import { z } from 'zod';
import { STRATEGIES } from './constants.ts';

/** Claude 구조화 출력 스키마 (docs/06). 유효 JSON ≠ 사실 검증 — 서버에서 의미 검증을 다시 한다. */

const rating = z.object({
  rating: z.number().int().min(0).max(5).nullable().describe('0~5 정성 점수. 판단 근거가 없으면 null'),
  reason: z.string().describe('점수 근거(자료 안의 사실만)'),
});

export const VideoFitOutputSchema = z.object({
  ratings: z.object({
    romance_relevance: rating,
    brand_fit: rating,
    evidence_depth: rating,
    audience_interest: rating,
  }),
  summary: z.string().describe('추천 이유 한두 문장'),
});
export type VideoFitOutput = z.infer<typeof VideoFitOutputSchema>;

export const ContextOutputSchema = z.object({
  core_problem: z.string().describe('영상이 다루는 연애 고민 한 줄 (60자 이내)'),
  evidence_ids: z.array(z.string()).describe('core_problem 판단에 사용한 근거 ID'),
  audience_insights: z.array(z.string()).describe('시청자 반응에서 읽은 관심사 (댓글 근거 기반)'),
  limitations: z.array(z.string()).describe('자료 부족·불확실한 부분'),
  requested_checks: z.array(z.string()).describe('운영자가 영상을 직접 보고 확인해야 할 부분'),
});
export type ContextOutput = z.infer<typeof ContextOutputSchema>;

export const MarketingCandidateSchema = z.object({
  strategy: z.enum(STRATEGIES),
  content: z.string().describe('40~120자 한국어 댓글. 링크·해시태그·지어낸 이용 후기 금지'),
  used_evidence_ids: z.array(z.string()).describe('댓글이 언급한 장면/말의 근거 ID'),
  rationale: z.string().describe('이 전략을 고른 이유'),
  no_fit: z.boolean().describe('영상과 브랜드 연결이 약하면 true'),
});

export const MarketingOutputSchema = z.object({
  strategy_summary: z.string(),
  brand_facts_used: z.array(z.string()).describe('사용한 브랜드 사실 ID'),
  candidates: z.array(MarketingCandidateSchema).describe('EMPATHY, QUESTION, INFO 각 1개 총 3개'),
});
export type MarketingOutput = z.infer<typeof MarketingOutputSchema>;

export const QualityOutputSchema = z.object({
  reviews: z.array(
    z.object({
      candidate_ref: z.string().describe('평가 대상 revision ID'),
      ratings: z.object({
        context_match: rating,
        brand_relevance: rating,
        naturalness: rating,
        uniqueness: rating,
        factuality: rating,
      }),
      risk_flags: z.array(z.string()).describe('허위 인용·과장·광고 위장 등 위험'),
      improvement: z.string().nullable().describe('개선 제안 1개 (없으면 null)'),
    }),
  ),
});
export type QualityOutput = z.infer<typeof QualityOutputSchema>;
