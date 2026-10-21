import type { Strategy, TrustGrade } from './constants.ts';
import type { StaticCheckResult } from './commentRules.ts';

export type DataSourceMode = 'LIVE' | 'SYNTHETIC';
export type AiMode = 'LIVE' | 'MOCK';
/** CLAUDE_CLI = 로컬 Claude Code(구독, 추가 비용 없음), ANTHROPIC_API = 종량 과금 API 키, MOCK = 모의. */
export type AiProvider = 'CLAUDE_CLI' | 'ANTHROPIC_API' | 'MOCK';
export type KeyState = 'REGISTERED' | 'MISSING' | 'UNAVAILABLE';

export type JobStatus =
  | 'QUEUED'
  | 'WAITING_DEPENDENCY'
  | 'RUNNING'
  | 'RATE_LIMITED'
  | 'RETRY_SCHEDULED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'NEEDS_REVIEW'
  | 'BUDGET_BLOCKED';

export type JobType = 'VIDEO_FIT' | 'CONTEXT' | 'MARKETING' | 'QUALITY';

export interface FitRating {
  readonly rating: number | null;
  readonly reason: string;
}

export interface VideoFitDTO {
  readonly state: 'SCORED' | 'NOT_ASSESSED' | 'PENDING';
  readonly score: number | null;
  readonly tier: 'PRIORITY' | 'NORMAL' | 'LOW' | null;
  readonly summary: string | null;
  readonly ratings: Record<string, FitRating> | null;
  readonly keywordHits: readonly string[];
}

export interface VideoDTO {
  readonly videoId: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly title: string;
  readonly description: string;
  readonly thumbnailUrl: string | null;
  readonly publishedAt: string;
  readonly viewCount: number | null;
  readonly commentCount: number | null;
  readonly source: DataSourceMode;
  readonly allowed: boolean;
  /** 지정 채널 밖 '뜨기 직전' 영상: 분석(초안)만 가능, 승인·게시 불가. */
  readonly draftOnly: boolean;
  readonly fit: VideoFitDTO;
  readonly trend: { readonly isRising: boolean; readonly viewsPerHour: number | null };
  readonly lastSeenAt: string;
  readonly latestAnalysisId: string | null;
}

export type EvidenceSourceType = 'TITLE' | 'DESCRIPTION' | 'COMMENT' | 'OPERATOR_QUOTE' | 'TRANSCRIPT';

export interface EvidenceDTO {
  readonly id: string;
  readonly videoId: string;
  readonly sourceType: EvidenceSourceType;
  readonly text: string;
  readonly timestamp: string | null;
  readonly trustGrade: TrustGrade;
  readonly verifiedBy: string;
  readonly createdAt: string;
}

export type EvidenceState = 'VERIFIED' | 'PARTIAL' | 'NEEDS_EVIDENCE' | 'BLOCKED_EVIDENCE';

export interface RevisionDTO {
  readonly id: string;
  readonly candidateId: string;
  readonly versionNo: number;
  readonly content: string;
  readonly contentHash: string;
  readonly editedBy: 'AI' | 'OPERATOR';
  readonly usedEvidenceIds: readonly string[];
  readonly createdAt: string;
  readonly staticCheck: StaticCheckResult;
}

export type HardCheckState = 'PASS' | 'BLOCK' | 'WARN';

export interface HardCheckDTO {
  readonly code: string;
  readonly state: HardCheckState;
  readonly message: string;
}

export type ReviewStatus = 'PASS' | 'FAIL' | 'NEEDS_EVIDENCE';

export interface ReviewDTO {
  readonly id: string;
  readonly revisionId: string;
  readonly status: ReviewStatus;
  readonly score: number | null;
  readonly ratings: Record<string, FitRating>;
  readonly hardChecks: readonly HardCheckDTO[];
  readonly riskFlags: readonly string[];
  readonly improvement: string | null;
  readonly evidenceSnapshotHash: string;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly mode: AiMode;
  readonly createdAt: string;
  /** 근거 스냅샷이 바뀌어 더 이상 유효하지 않은 평가. */
  readonly stale: boolean;
}

export interface ApprovalDTO {
  readonly id: string;
  readonly revisionId: string;
  readonly reviewId: string;
  readonly contentHash: string;
  readonly testTargetId: string;
  readonly profileId: string;
  readonly approvedAt: string;
  readonly invalidatedAt: string | null;
  readonly invalidReason: string | null;
  readonly valid: boolean;
}

export interface CandidateDTO {
  readonly id: string;
  readonly analysisId: string;
  readonly strategy: Strategy;
  readonly rationale: string;
  readonly noFit: boolean;
  readonly latestRevision: RevisionDTO;
  readonly revisionCount: number;
  /** 최신 revision에 결속된 가장 최근 평가 (없으면 null = 재검증 필요). */
  readonly review: ReviewDTO | null;
  readonly approval: ApprovalDTO | null;
}

export interface AnalysisDTO {
  readonly id: string;
  readonly videoId: string;
  readonly status: JobStatus;
  readonly evidenceState: EvidenceState;
  readonly evidenceHash: string;
  readonly coreProblem: string | null;
  readonly evidenceIds: readonly string[];
  readonly audienceInsights: readonly string[];
  readonly limitations: readonly string[];
  readonly requestedChecks: readonly string[];
  readonly modelId: string | null;
  readonly promptVersion: string;
  readonly mode: AiMode;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly stale: boolean;
  readonly candidates: readonly CandidateDTO[];
  readonly evidence: readonly EvidenceDTO[];
}

export type ProfileStatus = 'REGISTERED' | 'READY' | 'AUTH_REQUIRED' | 'LOCKED' | 'ERROR';

export interface ProfileDTO {
  readonly id: string;
  readonly alias: string;
  readonly status: ProfileStatus;
  readonly accountLabel: string | null;
  readonly lastAuthCheck: string | null;
  readonly lastError: string | null;
}

export interface TestTargetDTO {
  readonly id: string;
  readonly videoId: string;
  readonly url: string;
  readonly title: string | null;
  readonly ownerChannelId: string | null;
  readonly ownershipState: 'VERIFIED' | 'UNVERIFIED';
  readonly verificationMethod: string | null;
  readonly isFixture: boolean;
  readonly claimStatus: PostingClaimStatus | null;
}

export type PostingClaimStatus =
  | 'RESERVED'
  | 'PRE_SUBMIT_FAILED'
  | 'SUBMIT_ATTEMPTED'
  | 'SUCCESS'
  | 'UNKNOWN'
  | 'FAILED_VERIFIED_NOT_POSTED';

export type ExecutionStatus =
  | 'QUEUED'
  | 'PREFLIGHT'
  | 'LAUNCHING'
  | 'AUTH_CHECK'
  | 'NAVIGATING'
  | 'EDITOR_READY'
  | 'TYPING'
  | 'SUBMITTING'
  | 'VERIFYING'
  | 'SUCCESS'
  | 'UNKNOWN'
  | 'FAILED_PRE_SUBMIT'
  | 'AUTH_REQUIRED'
  | 'CANCELLED'
  | 'POLICY_BLOCKED'
  | 'PROFILE_LOCKED'
  | 'INTERRUPTED';

export const TERMINAL_EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  'SUCCESS',
  'UNKNOWN',
  'FAILED_PRE_SUBMIT',
  'AUTH_REQUIRED',
  'CANCELLED',
  'POLICY_BLOCKED',
  'PROFILE_LOCKED',
  'INTERRUPTED',
];

export interface ExecutionEventDTO {
  readonly step: string;
  readonly result: 'START' | 'OK' | 'FAIL' | 'INFO';
  readonly message: string;
  readonly at: string;
  readonly screenshotRef: string | null;
}

export interface ExecutionDTO {
  readonly id: string;
  readonly approvalId: string;
  readonly targetVideoId: string;
  /** 게시한 영상 제목·주소 (기록·"댓글 보기" 링크용). */
  readonly targetTitle: string | null;
  readonly targetUrl: string;
  readonly sourceVideoId: string;
  /** 초안을 만든 원본 영상 제목. */
  readonly sourceTitle: string | null;
  readonly profileId: string;
  readonly profileAlias: string;
  readonly status: ExecutionStatus;
  readonly mode: 'REAL_CHROME' | 'FIXTURE';
  readonly revisionHash: string;
  readonly content: string;
  readonly createdAt: string;
  readonly submittedAt: string | null;
  readonly verifiedAt: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly humanResolution: string | null;
  readonly events: readonly ExecutionEventDTO[];
}

export interface AuditEventDTO {
  readonly id: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly action: string;
  readonly actor: string;
  readonly createdAt: string;
  readonly localDate: string;
  readonly metadata: Record<string, unknown>;
}

export interface JobDTO {
  readonly id: string;
  readonly type: JobType;
  readonly status: JobStatus;
  readonly priority: number;
  readonly attempts: number;
  readonly modelId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly subjectId: string;
}

export interface UsageSummaryDTO {
  readonly today: UsageBucket;
  readonly month: UsageBucket;
  readonly budget: {
    readonly dailyLimitUsd: number;
    readonly monthlyLimitUsd: number;
    readonly warningRatio: number;
    readonly state: 'OK' | 'WARNING' | 'BLOCKED';
  };
  readonly byModel: readonly (UsageBucket & { readonly modelId: string })[];
  readonly priceCatalog: readonly { readonly modelId: string; readonly inputPerMTok: number; readonly outputPerMTok: number; readonly note: string }[];
}

export interface UsageBucket {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  /** 종량 과금(API 키) 추정 청구액. 구독 CLI·모의는 0. */
  readonly estimatedUsd: number;
  /** 구독 CLI 호출의 API 환산 참고값(청구액 아님, Claude Code가 보고한 값). */
  readonly notionalUsd: number;
  readonly cacheHits: number;
  readonly errors: number;
}

export interface HealthDTO {
  readonly status: 'LOCAL_READY' | 'DEGRADED';
  readonly version: string;
  readonly db: 'OK' | 'ERROR';
  readonly aiMode: AiMode;
  readonly aiProvider: AiProvider;
  readonly youtubeMode: DataSourceMode;
  readonly keys: { readonly anthropic: KeyState; readonly youtube: KeyState };
  readonly fixtureMode: boolean;
  readonly daily: { readonly localDate: string; readonly reserved: number; readonly limit: number };
  readonly queue: { readonly running: number; readonly waiting: number };
}

export interface SettingsDTO {
  readonly models: { readonly light: string; readonly heavy: string; readonly fallbacks: readonly string[] };
  readonly aiMode: AiMode;
  /** 현재 적용 중인 Provider (선호값이 사용 불가하면 MOCK으로 내려감). */
  readonly aiProvider: AiProvider;
  /** 저장된 선호 Provider. ANTHROPIC_API는 종량 과금. */
  readonly llmProvider: AiProvider;
  readonly claudeCli: { readonly path: string | null };
  readonly youtubeMode: DataSourceMode;
  readonly promptVersion: string;
  readonly budget: { readonly dailyLimitUsd: number; readonly monthlyLimitUsd: number; readonly warningRatio: number };
  readonly dailyMaxComments: number;
  readonly ownerChannelId: string | null;
  readonly keys: { readonly anthropic: KeyState; readonly youtube: KeyState };
  readonly maxConcurrency: number;
  readonly autoPrescore: boolean;
}

export interface ApiErrorBody {
  readonly error: { readonly code: string; readonly message: string };
}

/** Sage 비서 질문 (읽기 전용 질의응답 — 게시·승인 권한 없음). */
export interface SageAskRequest {
  readonly question: string;
  readonly selectedVideoId?: string | null;
}

export interface SageAnswerDTO {
  readonly answer: string;
  readonly aiMode: 'LIVE' | 'MOCK';
}
