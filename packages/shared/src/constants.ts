/** 과제 원문 p.2~3 지정 채널 allowlist (REQ-VID-001, REQ-EXE-003). */
export const ALLOWED_CHANNELS = [
  { channelId: 'UCxlc0Ky0aWoD8uI09ad44Tg', name: '외롭여' },
  { channelId: 'UC-ee_ziASM251TMXe3P3VZA', name: '리즈시절 LizTV' },
  { channelId: 'UC09L3JxGVcn7SKLa-pjTEmw', name: '러브커넥트 유지연' },
  { channelId: 'UCVdtDW-HF4KluixGaBAcI4w', name: '연애데이터 노노' },
  { channelId: 'UCkGl2jieOVhGiHPdXF77Yyw', name: '심리조각' },
] as const;

export const ALLOWED_CHANNEL_IDS: ReadonlySet<string> = new Set(ALLOWED_CHANNELS.map((c) => c.channelId));

export const BRAND_NAME = '운명원';

export const COMMENT_RULES = {
  minChars: 40,
  maxChars: 120,
} as const;

export const OPERATION_LIMITS = {
  dailyMaxComments: 10,
  commentsPerVideo: 1,
  maxProfiles: 3,
  timezone: 'Asia/Seoul',
} as const;

export const DISCOVERY_LIMITS = {
  perChannel: 10,
  maxTotal: 50,
  preScoreCount: 15,
  topRecommendations: 5,
} as const;

/** REQ-TREND-001: 연애 키워드 + 조회수 1,000~5,000 + 시간당 150 이상 (초안까지만). */
export const TREND_RULES = {
  keyword: '연애',
  minViews: 1000,
  maxViews: 5000,
  minViewsPerHour: 150,
} as const;

export const TRUST_GRADES = ['A', 'B', 'C', 'D'] as const;
export type TrustGrade = (typeof TRUST_GRADES)[number];
export const TRUST_GRADE_LABEL: Record<TrustGrade, string> = {
  A: 'A 직접확인',
  B: 'B 공식 메타',
  C: 'C 댓글 반응',
  D: 'D 추론(인용 금지)',
};

export const STRATEGIES = ['EMPATHY', 'QUESTION', 'INFO'] as const;
export type Strategy = (typeof STRATEGIES)[number];
export const STRATEGY_LABEL: Record<Strategy, string> = {
  EMPATHY: 'A 공감형',
  QUESTION: 'B 질문형',
  INFO: 'C 정보형',
};

/** docs/05 §3 영상 적합도 가중치 (자체 점수, 심사 점수 아님). */
export const VIDEO_FIT_WEIGHTS = {
  romance_relevance: 35,
  brand_fit: 25,
  evidence_depth: 25,
  audience_interest: 15,
} as const;

/** docs/05 §5 Quality 내부 평가 가중치. */
export const QUALITY_WEIGHTS = {
  context_match: 30,
  brand_relevance: 25,
  naturalness: 20,
  uniqueness: 15,
  factuality: 10,
} as const;

export const QUALITY_PASS_SCORE = 70;

export const DEFAULT_MODELS = {
  light: 'claude-haiku-5-5',
  heavy: 'claude-sonnet-5-5',
} as const;

export const PROMPT_VERSIONS = ['A-1.0', 'B-1.0', 'B-1.1', 'B-1.2', 'B-1.3', 'B-2.0'] as const;
export type PromptVersion = (typeof PROMPT_VERSIONS)[number];
export const DEFAULT_PROMPT_VERSION: PromptVersion = 'B-2.0';
export const SCHEMA_VERSION = 'S-1';
