import {
  BRAND_NAME,
  QUALITY_PASS_SCORE,
  QUALITY_WEIGHTS,
  QualityOutputSchema,
  checkCommentStatic,
  extractQuotedPhrases,
  normalizeForMatch,
  type EvidenceDTO,
  type FitRating,
  type HardCheckDTO,
  type PromptVersion,
  type QualityOutput,
  type ReviewStatus,
} from '@context/shared';
import type { AppContext } from '../context.ts';
import { sha256, stableStringify } from '../lib/ids.ts';
import { runAgentCall, type AgentResult } from '../orchestrator/llmRunner.ts';
import { evidencePayload } from './context.ts';
import { approvedBrandFacts } from './marketing.ts';
import { systemPrompt, untrusted } from './prompts.ts';

const SCENE_OVERLAP_MIN = 4;
const SIMILARITY_BLOCK = 0.6;
const UNVERIFIED_CLAIM_BLOCK = /(유명한|유명해|적중률|정확도|100\s?%|무조건|확실히 맞|소문난|1위|최고의)/;
const HEARSAY_WARN = /(잘\s?본다|잘\s?맞는다|용하다|잘 맞춘)/;

export interface RevisionForReview {
  readonly id: string;
  readonly content: string;
  readonly usedEvidenceIds: readonly string[];
}

/** 정규화한 두 문자열의 최장 공통 부분 문자열 길이. */
export function longestCommonSubstring(a: string, b: string): number {
  if (!a || !b) return 0;
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best) best = cur[j]!;
      }
    }
    prev = cur;
  }
  return best;
}

function bigrams(text: string): Set<string> {
  const t = normalizeForMatch(text);
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

export function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * 결정적 하드 게이트 (docs/05 §5, docs/06 §4). 점수와 별개로 PASS/BLOCK/WARN.
 * 모델 평가가 아무리 높아도 BLOCK 하나면 승인 불가.
 */
export function hardChecks(revision: RevisionForReview, evidence: readonly EvidenceDTO[], otherComments: readonly string[]): HardCheckDTO[] {
  const checks: HardCheckDTO[] = [];
  const s = checkCommentStatic(revision.content);
  const has = (code: string) => s.violations.find((v) => v.code === code);
  const lengthV = has('TOO_SHORT') ?? has('TOO_LONG') ?? has('EMPTY');
  checks.push({ code: 'LENGTH', state: lengthV ? 'BLOCK' : 'PASS', message: lengthV?.message ?? `${s.charCount}자 (40~120자)` });
  checks.push({ code: 'NO_LINK', state: has('HAS_LINK') ? 'BLOCK' : 'PASS', message: has('HAS_LINK')?.message ?? '링크 없음' });
  checks.push({ code: 'NO_HASHTAG', state: has('HAS_HASHTAG') ? 'BLOCK' : 'PASS', message: has('HAS_HASHTAG')?.message ?? '해시태그 없음' });
  checks.push({ code: 'NO_FAKE_REVIEW', state: has('FAKE_REVIEW') ? 'BLOCK' : 'PASS', message: has('FAKE_REVIEW')?.message ?? '지어낸 이용 후기 표현 없음' });

  const byId = new Map(evidence.map((e) => [e.id, e]));
  const unknownRefs = revision.usedEvidenceIds.filter((id) => !byId.has(id));
  checks.push({
    code: 'EVIDENCE_REFS',
    state: unknownRefs.length ? 'BLOCK' : 'PASS',
    message: unknownRefs.length ? `존재하지 않는 근거 ID ${unknownRefs.length}개` : `근거 ID ${revision.usedEvidenceIds.length}개 확인`,
  });

  const corpus = evidence.map((e) => normalizeForMatch(e.text));
  const quotes = extractQuotedPhrases(revision.content);
  const badQuotes = quotes.filter((q) => !corpus.some((c) => c.includes(normalizeForMatch(q))));
  checks.push({
    code: 'QUOTE_MATCH',
    state: badQuotes.length ? 'BLOCK' : 'PASS',
    message: badQuotes.length ? `근거 원문과 일치하지 않는 인용: "${badQuotes[0]}"` : quotes.length ? `인용 ${quotes.length}개 원문 일치` : '따옴표 인용 없음',
  });

  // "영상 속 구체적 장면·말" — 근거 원문과 실제로 겹치는 표현이 있어야 PASS (docs/05 §2-5).
  // 과제 기준 "자막(없으면 제목·설명)"에 따라 직접 확인(A)이 없으면 제목·설명(B)과 겹치는 표현도 인정한다 (결정 로그 18).
  const normalized = normalizeForMatch(revision.content);
  const overlaps = (e: EvidenceDTO) => longestCommonSubstring(normalized, normalizeForMatch(e.text)) >= SCENE_OVERLAP_MIN;
  const sceneHit = evidence.filter((e) => e.trustGrade === 'A').find(overlaps);
  const metaHit = evidence.filter((e) => e.sourceType === 'TRANSCRIPT').find(overlaps) ?? evidence.filter((e) => e.trustGrade === 'B').find(overlaps);
  checks.push({
    code: 'SCENE_REFERENCE',
    state: sceneHit || metaHit ? 'PASS' : 'WARN',
    message: sceneHit
      ? `직접 확인된 발언 반영${sceneHit.timestamp ? ` (${sceneHit.timestamp})` : ''}`
      : metaHit?.sourceType === 'TRANSCRIPT'
        ? `자막 발언 반영${metaHit.timestamp ? ` (${metaHit.timestamp})` : ''}`
        : metaHit
          ? `영상 ${metaHit.sourceType === 'TITLE' ? '제목' : '설명'} 내용 반영 (자막 없음 — 제목·설명 근거)`
        : '영상 고유 장면·발언 언급이 확인되지 않음',
  });

  checks.push({
    code: 'BRAND_MENTION',
    state: s.mentionsBrand ? 'PASS' : 'WARN',
    message: s.mentionsBrand ? `${BRAND_NAME} 언급` : `${BRAND_NAME} 언급 없음`,
  });

  const claim = revision.content.match(UNVERIFIED_CLAIM_BLOCK);
  const hearsay = revision.content.match(HEARSAY_WARN);
  checks.push({
    code: 'UNVERIFIED_CLAIM',
    state: claim ? 'BLOCK' : hearsay ? 'WARN' : 'PASS',
    message: claim ? `검증되지 않은 평판·성과 주장: "${claim[0]}"` : hearsay ? `평판 전언 표현 주의: "${hearsay[0]}"` : '평판·성과 주장 없음',
  });

  const maxSim = otherComments.reduce((m, o) => Math.max(m, similarity(revision.content, o)), 0);
  checks.push({
    code: 'UNIQUENESS',
    state: maxSim >= SIMILARITY_BLOCK ? 'BLOCK' : 'PASS',
    message: maxSim >= SIMILARITY_BLOCK ? `다른 영상 댓글과 유사도 ${maxSim.toFixed(2)}` : `다른 영상 댓글과 최대 유사도 ${maxSim.toFixed(2)}`,
  });
  return checks;
}

export function weightedQualityScore(ratings: Record<string, FitRating>): number | null {
  const entries = Object.entries(QUALITY_WEIGHTS);
  if (entries.some(([k]) => ratings[k]?.rating === null || ratings[k]?.rating === undefined)) return null;
  return Math.round(entries.reduce((sum, [k, w]) => sum + (w * (ratings[k]!.rating ?? 0)) / 5, 0));
}

export function reviewStatus(score: number | null, checks: readonly HardCheckDTO[]): ReviewStatus {
  if (checks.some((c) => c.state === 'BLOCK')) return 'FAIL';
  if (score === null || score < QUALITY_PASS_SCORE) return 'FAIL';
  if (checks.find((c) => c.code === 'SCENE_REFERENCE')?.state !== 'PASS') return 'NEEDS_EVIDENCE';
  return 'PASS';
}

/** Quality 에이전트 (모델 평가) — 하드 게이트는 hardChecks()가 별도로 계산. */
export async function runQualityAgent(
  ctx: AppContext,
  args: { jobId: string; attemptId: string; revisions: readonly RevisionForReview[]; evidence: readonly EvidenceDTO[]; evidenceHash: string; promptVersion: PromptVersion; coreProblem: string | null },
): Promise<AgentResult<QualityOutput>> {
  const gradeA = new Set(args.evidence.filter((e) => e.trustGrade === 'A').map((e) => e.id));
  const input = {
    core_problem: args.coreProblem,
    evidence: evidencePayload(args.evidence),
    revisions: args.revisions.map((r) => ({ id: r.id, content: r.content, used_evidence_ids: r.usedEvidenceIds, citesGradeA: r.usedEvidenceIds.some((id) => gradeA.has(id)) })),
  };
  return runAgentCall(ctx, {
    jobId: args.jobId,
    attemptId: args.attemptId,
    role: 'QUALITY',
    tier: 'heavy',
    system: systemPrompt(args.promptVersion, 'QUALITY'),
    prompt: [
      `영상 핵심 고민: ${args.coreProblem ?? '(미확인)'}`,
      `운영자가 승인한 브랜드 사실(brand_facts): ${JSON.stringify(approvedBrandFacts(ctx))}`,
      untrusted('evidence', input.evidence),
      '평가할 댓글 revision 목록 (각 revision id를 candidate_ref로 그대로 사용):',
      JSON.stringify(input.revisions.map((r) => ({ id: r.id, content: r.content, used_evidence_ids: r.used_evidence_ids }))),
    ].join('\n'),
    schema: QualityOutputSchema,
    maxTokens: 6000,
    input,
    promptVersion: args.promptVersion,
    dataHash: sha256(stableStringify({ e: args.evidenceHash, r: input.revisions.map((r) => [r.id, r.content]) })),
  });
}
