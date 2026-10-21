import { describe, expect, it } from 'vitest';
import type { EvidenceDTO } from '@context/shared';
import { hardChecks, reviewStatus, similarity, weightedQualityScore } from '../agents/quality.ts';
import { scoreFit, computeTrend } from '../agents/research.ts';
import { validateContext } from '../agents/context.ts';
import { validateMarketing } from '../agents/marketing.ts';

const ev = (id: string, grade: 'A' | 'B' | 'C', text: string): EvidenceDTO => ({ id, videoId: 'v', sourceType: grade === 'A' ? 'OPERATOR_QUOTE' : grade === 'B' ? 'TITLE' : 'COMMENT', text, timestamp: grade === 'A' ? '01:00' : null, trustGrade: grade, verifiedBy: 't', createdAt: '' });
const evidence = [ev('e1', 'B', '연락 안 하는 남자의 속마음'), ev('e2', 'A', '연락이 줄었다고 마음이 식은 건 아니에요')];
const good = '"연락이 줄었다고 마음이 식은 건 아니에요" 이 말에 위로받았어요. 운명원 연애사주로 제 인연 흐름도 한번 보고 싶네요.';
const state = (checks: ReturnType<typeof hardChecks>, code: string) => checks.find((c) => c.code === code)?.state;

describe('Quality hard gates (TEST-AI-02/03/04)', () => {
  it('passes a grounded comment', () => {
    const c = hardChecks({ id: 'r', content: good, usedEvidenceIds: ['e2'] }, evidence, []);
    expect(c.filter((x) => x.state === 'BLOCK')).toEqual([]);
    expect(state(c, 'SCENE_REFERENCE')).toBe('PASS');
  });
  it('blocks quotes not present in evidence (hallucination)', () => {
    const c = hardChecks({ id: 'r', content: '"남자는 원래 다 그래요" 이 말 공감해요. 운명원 연애사주로 제 인연 흐름도 한번 보고 싶네요 진짜로요.', usedEvidenceIds: ['e2'] }, evidence, []);
    expect(state(c, 'QUOTE_MATCH')).toBe('BLOCK');
  });
  it('passes when only title/description is referenced (과제: 자막 없으면 제목·설명)', () => {
    const c = hardChecks({ id: 'r', content: '연락 안 하는 남자의 속마음 영상 보고 생각이 많아졌어요. 운명원 연애사주로 제 인연 흐름도 보고 싶네요.', usedEvidenceIds: ['e1'] }, evidence, []);
    expect(state(c, 'SCENE_REFERENCE')).toBe('PASS');
    expect(c.find((x) => x.code === 'SCENE_REFERENCE')?.message).toContain('제목·설명');
    expect(reviewStatus(90, c)).toBe('PASS');
  });
  it('needs evidence when the comment references nothing specific to the video', () => {
    const c = hardChecks({ id: 'r', content: '요즘 연애가 너무 어렵네요 다들 힘내세요. 운명원 연애사주로 제 인연 흐름도 한번 보고 싶네요.', usedEvidenceIds: ['e1'] }, evidence, []);
    expect(state(c, 'SCENE_REFERENCE')).toBe('WARN');
    expect(reviewStatus(90, c)).toBe('NEEDS_EVIDENCE');
  });
  it('blocks unknown evidence refs, unverified reputation claims and near-duplicates', () => {
    const c1 = hardChecks({ id: 'r', content: good, usedEvidenceIds: ['nope'] }, evidence, []);
    expect(state(c1, 'EVIDENCE_REFS')).toBe('BLOCK');
    const c2 = hardChecks({ id: 'r', content: `${good.slice(0, 60)} 운명원 적중률 최고래요.`, usedEvidenceIds: ['e2'] }, evidence, []);
    expect(state(c2, 'UNVERIFIED_CLAIM')).toBe('BLOCK');
    const c3 = hardChecks({ id: 'r', content: good, usedEvidenceIds: ['e2'] }, evidence, [good]);
    expect(state(c3, 'UNIQUENESS')).toBe('BLOCK');
    expect(similarity(good, good)).toBe(1);
  });
  it('weighted score requires all ratings; status needs >=70 and no BLOCK', () => {
    const r = (n: number | null) => ({ rating: n, reason: '' });
    expect(weightedQualityScore({ context_match: r(5), brand_relevance: r(4), naturalness: r(4), uniqueness: r(4), factuality: r(5) })).toBe(88);
    expect(weightedQualityScore({ context_match: r(null), brand_relevance: r(4), naturalness: r(4), uniqueness: r(4), factuality: r(5) })).toBeNull();
    expect(reviewStatus(69, [])).toBe('FAIL');
    expect(reviewStatus(70, [{ code: 'SCENE_REFERENCE', state: 'PASS', message: '' }])).toBe('PASS');
    expect(reviewStatus(null, [])).toBe('FAIL');
  });
});

describe('Research scoring (TEST-VID-01, TEST-TREND-01)', () => {
  const r = (n: number | null) => ({ rating: n, reason: '' });
  it('NOT_ASSESSED instead of zero when a rating is missing', () => {
    expect(scoreFit({ ratings: { romance_relevance: r(5), brand_fit: r(null), evidence_depth: r(3), audience_interest: r(3) }, summary: '' })).toEqual({ state: 'NOT_ASSESSED', score: null, tier: null });
    expect(scoreFit({ ratings: { romance_relevance: r(5), brand_fit: r(5), evidence_depth: r(5), audience_interest: r(5) }, summary: '' })).toEqual({ state: 'SCORED', score: 100, tier: 'PRIORITY' });
    expect(scoreFit({ ratings: { romance_relevance: r(2), brand_fit: r(2), evidence_depth: r(2), audience_interest: r(2) }, summary: '' }).tier).toBe('LOW');
  });
  it('rising detection: 연애 keyword + 1,000~5,000 views + >=150/h', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    const base = { title: '연애 고민 상담', description: '', publishedAt: '2026-10-20T00:00:00Z' };
    expect(computeTrend({ ...base, viewCount: 2400 }, now)).toEqual({ isRising: true, viewsPerHour: 200 });
    expect(computeTrend({ ...base, viewCount: 6000 }, now).isRising).toBe(false);
    expect(computeTrend({ ...base, title: '요리', viewCount: 2400 }, now).isRising).toBe(false);
    expect(computeTrend({ ...base, viewCount: null }, now)).toEqual({ isRising: false, viewsPerHour: null });
  });
});

describe('Agent output semantic validation (docs/06 §4)', () => {
  it('drops evidence ids that do not exist and records limitation', () => {
    const out = validateContext({ core_problem: 'x'.repeat(100), evidence_ids: ['e1', 'ghost'], audience_insights: [], limitations: [], requested_checks: [] }, evidence);
    expect(out.evidence_ids).toEqual(['e1']);
    expect(out.core_problem.length).toBe(80);
    expect(out.limitations.join(' ')).toContain('존재하지 않는 근거 ID');
  });
  it('requires exactly the three strategies and filters unapproved brand facts', () => {
    const cand = (strategy: 'EMPATHY' | 'QUESTION' | 'INFO') => ({ strategy, content: good, used_evidence_ids: ['e2', 'ghost'], rationale: '', no_fit: false });
    const ok = validateMarketing({ strategy_summary: '', brand_facts_used: ['BF-1', 'BF-2'], candidates: [cand('EMPATHY'), cand('QUESTION'), cand('INFO')] }, evidence, [{ id: 'BF-1', text: '' }]);
    expect(ok.brand_facts_used).toEqual(['BF-1']);
    expect(ok.candidates[0]!.used_evidence_ids).toEqual(['e2']);
    expect(() => validateMarketing({ strategy_summary: '', brand_facts_used: [], candidates: [cand('EMPATHY')] }, evidence, [])).toThrow();
  });
});
