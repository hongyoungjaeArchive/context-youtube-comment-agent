import { describe, expect, it } from 'vitest';
import type { CandidateDTO } from '@context/shared';
import { pickRecommended } from './recommend.ts';

const cand = (id: string, status: string | null, score: number | null, stale = false) =>
  ({ id, noFit: false, review: status ? { status, score, stale } : null }) as unknown as CandidateDTO;

describe('pickRecommended', () => {
  it('prefers the highest-scoring PASS candidate', () => {
    expect(pickRecommended([cand('a', 'FAIL', 95), cand('b', 'PASS', 72), cand('c', 'PASS', 81)])?.id).toBe('c');
  });

  it('falls back to the highest score when nothing passed', () => {
    expect(pickRecommended([cand('a', 'FAIL', 55), cand('b', 'NEEDS_EVIDENCE', 77), cand('c', null, null)])?.id).toBe('b');
  });

  it('ignores stale reviews when ranking', () => {
    expect(pickRecommended([cand('a', 'PASS', 90, true), cand('b', 'PASS', 71)])?.id).toBe('b');
  });

  it('returns null for an empty list', () => {
    expect(pickRecommended([])).toBeNull();
  });
});
