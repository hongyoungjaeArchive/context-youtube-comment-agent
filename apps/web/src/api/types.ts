import type { AuditEventDTO, ExecutionDTO, JobDTO, JobStatus, ProfileDTO, TestTargetDTO, VideoDTO } from '@context/shared';

/** 서버 라우트 응답 중 shared에 DTO가 없는 것들 (apps/server/src 정의를 그대로 옮김). */

export type VideoSort = 'recommended' | 'latest' | 'channel';

export interface RefreshResult {
  readonly state: 'LIST_READY' | 'PARTIAL' | 'ERROR';
  readonly source: 'LIVE' | 'SYNTHETIC';
  readonly fetched: number;
  readonly channels: readonly { channelId: string; name: string; ok: boolean; count: number; error: string | null }[];
  readonly scoringQueued: number;
}

export interface InspectResult {
  readonly videoId: string | null;
  readonly channelId: string | null;
  readonly scope: 'ALLOWED_CHANNEL' | 'OWN_TEST_CHANNEL' | 'NOT_ALLOWED' | 'INVALID_URL' | 'NOT_FOUND';
  readonly message: string;
  readonly video: VideoDTO | null;
}

export interface VideosResponse {
  readonly videos: readonly VideoDTO[];
}
export interface JobsResponse {
  readonly jobs: readonly JobDTO[];
  readonly counts: Partial<Record<JobStatus, number>>;
}
export interface ExecutionsResponse {
  readonly executions: readonly ExecutionDTO[];
}
export interface ActivityResponse {
  readonly events: readonly AuditEventDTO[];
}
export interface TargetsResponse {
  readonly targets: readonly TestTargetDTO[];
}
export interface ProfilesResponse {
  readonly profiles: readonly ProfileDTO[];
}

export type FixtureMode = 'ok' | 'signedout' | 'nocomments' | 'hang' | 'slow' | 'captcha';

// ---------- Evaluation Lab ----------
export type EvalKind = 'FAULTS' | 'SINGLE' | 'AB' | 'REGRESSION';

export interface EvalCaseOverview {
  readonly caseId: string;
  readonly kind: 'GOLDEN' | 'ADVERSARIAL';
  readonly source: string;
  readonly label: string | null;
  readonly channelName: string | null;
  readonly videoId: string | null;
  readonly status: string;
  readonly runnable: boolean;
  readonly evidenceCount: number;
  readonly hasHumanLabel: boolean;
}
export interface EvalDataset {
  readonly version: string;
  readonly notes: readonly string[];
  readonly cases: readonly EvalCaseOverview[];
}

export interface EvalRun {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly promptVersion: string | null;
  readonly aiMode: string;
  readonly status: string;
  readonly summary: Record<string, unknown>;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

export interface CaseMetrics {
  readonly caseId: string;
  readonly kind: string;
  readonly label: string;
  readonly status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
  readonly candidates: number;
  readonly formatPass: number;
  readonly hallucinatedQuotes: number;
  readonly sceneReferencePass: number;
  readonly qualityPass: number;
  readonly avgScore: number | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimatedUsd: number;
  readonly latencyMs: number;
  readonly calls: number;
  readonly errors: number;
  readonly expectation: { readonly defined: boolean; readonly met: boolean | null; readonly detail: string };
  readonly aiTopStrategy: string | null;
}

export interface EvalRunDetail extends EvalRun {
  readonly results: readonly { caseId: string; metrics: CaseMetrics; output: unknown }[];
}

export type GateState = 'PASS' | 'FAILED' | 'NOT_RUN' | 'PARTIAL';
export interface EvalGate {
  readonly id: string;
  readonly title: string;
  readonly state: GateState;
  readonly evidence: string;
}

export interface EvalReport {
  readonly gates: readonly EvalGate[];
  readonly ab:
    | { readonly state: 'NOT_RUN' }
    | {
        readonly state: 'MEASURED';
        readonly aiMode: string;
        readonly caveat: string;
        readonly a: { id: string; summary: Record<string, unknown> };
        readonly b: { id: string; summary: Record<string, unknown> };
      };
  readonly regression:
    | { readonly state: 'NOT_RUN'; readonly message: string }
    | {
        readonly state: 'ADOPTION_BLOCKED' | 'NO_REGRESSION';
        readonly latest: { id: string; label: string; aiMode: string };
        readonly previous: { id: string; label: string; aiMode: string };
        readonly worsened: readonly string[];
      };
  readonly humanComparison: {
    readonly state: 'NOT_MEASURED' | 'MEASURED';
    readonly labels: number;
    readonly topPickAgreement: number | null;
    readonly meanAbsError: number | null;
    readonly rows: readonly { caseId: string; runId: string; humanPick: string; aiPick: string | null; agree: boolean; mae: number | null }[];
  };
}
