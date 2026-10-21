import type { CandidateDTO } from '@context/shared';

function rank(c: CandidateDTO): [number, number] {
  const review = c.review && !c.review.stale ? c.review : null;
  return [review?.status === 'PASS' ? 1 : 0, review?.score ?? -1];
}

/** 추천 초안: 유효한 평가 중 PASS 우선, 그다음 점수 순. 후보가 없으면 null. */
export function pickRecommended(candidates: readonly CandidateDTO[]): CandidateDTO | null {
  return candidates.reduce<CandidateDTO | null>((best, c) => {
    if (!best) return c;
    const [bp, bs] = rank(best);
    const [cp, cs] = rank(c);
    return cp > bp || (cp === bp && cs > bs) ? c : best;
  }, null);
}
