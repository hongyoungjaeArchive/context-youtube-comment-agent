import {
  MarketingOutputSchema,
  STRATEGIES,
  type ContextOutput,
  type EvidenceDTO,
  type MarketingOutput,
  type PromptVersion,
} from '@context/shared';
import type { AppContext } from '../context.ts';
import { LlmError } from '../clients/llm.ts';
import { sha256, stableStringify } from '../lib/ids.ts';
import { runAgentCall, type AgentResult } from '../orchestrator/llmRunner.ts';
import { evidencePayload } from './context.ts';
import { systemPrompt, untrusted } from './prompts.ts';

export interface BrandFact {
  readonly id: string;
  readonly text: string;
}

export function approvedBrandFacts(ctx: AppContext): BrandFact[] {
  return (ctx.db.prepare("SELECT fact_id id, text FROM brand_facts WHERE status = 'APPROVED'").all() as BrandFact[]).map((f) => ({ ...f }));
}

/** Marketing 에이전트: 전략별 댓글 3개 (REQ-CMT-001/003). */
export async function runMarketingAgent(
  ctx: AppContext,
  args: { jobId: string; attemptId: string; context: ContextOutput; evidence: readonly EvidenceDTO[]; evidenceHash: string; promptVersion: PromptVersion; otherComments: readonly string[] },
): Promise<AgentResult<MarketingOutput>> {
  const facts = approvedBrandFacts(ctx);
  const input = {
    core_problem: args.context.core_problem,
    audience_insights: args.context.audience_insights,
    evidence: evidencePayload(args.evidence),
    brand_facts: facts,
    avoid_similar_to: args.otherComments.slice(0, 10),
  };
  const result = await runAgentCall(ctx, {
    jobId: args.jobId,
    attemptId: args.attemptId,
    role: 'MARKETING',
    tier: 'heavy',
    system: systemPrompt(args.promptVersion, 'MARKETING'),
    prompt: [
      `핵심 고민: ${args.context.core_problem}`,
      `검증된 브랜드 사실(이것만 사용): ${JSON.stringify(facts)}`,
      '다른 영상에 이미 쓴 댓글과 비슷하게 쓰지 말 것.',
      untrusted('evidence', input.evidence),
      untrusted('other_video_comments', input.avoid_similar_to),
      '세 전략(EMPATHY, QUESTION, INFO) 각각 1개씩 정확히 3개의 후보를 작성하라.',
    ].join('\n'),
    schema: MarketingOutputSchema,
    maxTokens: 6000,
    input,
    promptVersion: args.promptVersion,
    dataHash: sha256(stableStringify({ e: args.evidenceHash, c: args.context.core_problem, o: input.avoid_similar_to })),
  });
  return { ...result, data: validateMarketing(result.data, args.evidence, facts) };
}

/** 후보 3개(전략별 1개), 근거 ID 실존, 승인된 브랜드 사실만 사용했는지 검증. */
export function validateMarketing(out: MarketingOutput, evidence: readonly EvidenceDTO[], facts: readonly BrandFact[]): MarketingOutput {
  const known = new Set(evidence.map((e) => e.id));
  const factIds = new Set(facts.map((f) => f.id));
  const candidates = STRATEGIES.map((strategy) => {
    const c = out.candidates.find((x) => x.strategy === strategy);
    if (!c) throw new LlmError('INVALID_OUTPUT', `${strategy} 전략 후보가 누락되었습니다.`);
    return { ...c, content: c.content.trim(), used_evidence_ids: c.used_evidence_ids.filter((id) => known.has(id)) };
  });
  return { ...out, brand_facts_used: out.brand_facts_used.filter((id) => factIds.has(id)), candidates };
}
