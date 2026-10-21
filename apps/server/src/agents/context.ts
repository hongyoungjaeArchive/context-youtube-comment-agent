import { ContextOutputSchema, type ContextOutput, type EvidenceDTO, type PromptVersion } from '@context/shared';
import type { AppContext } from '../context.ts';
import { runAgentCall, type AgentResult } from '../orchestrator/llmRunner.ts';
import { systemPrompt, untrusted } from './prompts.ts';

const CORE_PROBLEM_MAX = 80;

export function evidencePayload(evidence: readonly EvidenceDTO[]) {
  return evidence.map((e) => ({ id: e.id, grade: e.trustGrade, sourceType: e.sourceType, timestamp: e.timestamp, text: e.text }));
}

/** Context 에이전트: 근거 → 핵심 고민 한 줄 (REQ-CTX-001/002). */
export async function runContextAgent(
  ctx: AppContext,
  args: { jobId: string; attemptId: string; title: string; evidence: readonly EvidenceDTO[]; evidenceHash: string; promptVersion: PromptVersion },
): Promise<AgentResult<ContextOutput>> {
  const payload = { evidence: evidencePayload(args.evidence) };
  const result = await runAgentCall(ctx, {
    jobId: args.jobId,
    attemptId: args.attemptId,
    role: 'CONTEXT',
    tier: 'heavy',
    system: systemPrompt(args.promptVersion, 'CONTEXT'),
    prompt: `아래 근거만 사용해 영상의 연애 고민을 정리하라.\n${untrusted('evidence', payload.evidence)}`,
    schema: ContextOutputSchema,
    maxTokens: 4000,
    input: payload,
    promptVersion: args.promptVersion,
    dataHash: args.evidenceHash,
  });
  return { ...result, data: validateContext(result.data, args.evidence) };
}

/** 서버 의미 검증: 존재하지 않는 근거 ID 제거, 길이 제한, 근거 없음 표시 (docs/06 §4). */
export function validateContext(out: ContextOutput, evidence: readonly EvidenceDTO[]): ContextOutput {
  const known = new Set(evidence.map((e) => e.id));
  const evidenceIds = out.evidence_ids.filter((id) => known.has(id));
  const dropped = out.evidence_ids.length - evidenceIds.length;
  const limitations = [...out.limitations];
  if (dropped > 0) limitations.push(`존재하지 않는 근거 ID ${dropped}개를 제거했습니다.`);
  if (evidenceIds.length === 0) limitations.push('핵심 고민을 뒷받침하는 근거 ID가 없습니다 (미확인).');
  if (!evidence.some((e) => e.trustGrade === 'A') && !limitations.some((l) => l.includes('A 등급') || l.includes('직접'))) {
    limitations.push('직접 확인된 영상 발언(A 등급)이 없습니다.');
  }
  const core = Array.from(out.core_problem.trim()).slice(0, CORE_PROBLEM_MAX).join('');
  return { ...out, core_problem: core, evidence_ids: evidenceIds, limitations };
}
