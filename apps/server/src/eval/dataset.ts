import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const EvidenceSeed = z.object({ grade: z.enum(['A', 'B', 'C']), sourceType: z.enum(['TITLE', 'DESCRIPTION', 'COMMENT', 'OPERATOR_QUOTE', 'TRANSCRIPT']), text: z.string(), timestamp: z.string().optional() });

export const EvalCaseSchema = z.object({
  caseId: z.string(),
  kind: z.enum(['GOLDEN', 'ADVERSARIAL']),
  source: z.enum(['ACTUAL', 'SYNTHETIC']),
  label: z.string().optional(),
  channelId: z.string().optional(),
  channelName: z.string().optional(),
  videoId: z.string().nullable().optional(),
  status: z.string().optional(),
  note: z.string().optional(),
  fault: z.string().nullable().optional(),
  title: z.string().nullable(),
  evidence: z.array(EvidenceSeed),
  human: z
    .object({
      coreProblem: z.string().nullable(),
      verifiedQuotes: z.array(z.string()),
      unclear: z.array(z.string()),
      brandFit: z.number().nullable(),
      expectedRefusal: z.boolean(),
      labeler: z.string().nullable(),
    })
    .optional(),
  expect: z.record(z.string(), z.unknown()).optional(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const DatasetSchema = z.object({ version: z.string(), createdAt: z.string(), notes: z.array(z.string()), cases: z.array(EvalCaseSchema) });
export type Dataset = z.infer<typeof DatasetSchema>;

export function datasetPath(): string {
  if (process.env.CONTEXT_EVAL_DATASET) return process.env.CONTEXT_EVAL_DATASET;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/eval 또는 dist/eval → 저장소 루트/evaluation/golden/dataset.json
  return path.resolve(here, '../../../../evaluation/golden/dataset.json');
}

export function loadDataset(file: string = datasetPath()): Dataset {
  return DatasetSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}

/** 실행 가능한 사례: 합성 적대 사례 + 실제 근거가 수집된 골든 사례. */
export function isRunnable(c: EvalCase): boolean {
  if (c.kind === 'ADVERSARIAL') return c.evidence.length > 0 && c.title !== null;
  return c.status === 'COLLECTED' && c.evidence.length > 0 && c.title !== null;
}
