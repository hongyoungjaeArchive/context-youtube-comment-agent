import type { TranscriptSource } from './clients/transcript.ts';
import type { AiMode, AiProvider, DataSourceMode, KeyState } from '@context/shared';
import type { AnthropicLlmClient } from './clients/anthropicClient.ts';
import type { LlmClient } from './clients/llm.ts';
import type { YouTubeClient } from './clients/youtube.ts';
import type { RuntimeConfig } from './config.ts';
import type { Db } from './db/database.ts';
import type { AuditLog } from './lib/audit.ts';
import type { SettingsRepo } from './lib/settings.ts';
import type { Clock } from './lib/time.ts';
import type { SecretStore } from './security/secretStore.ts';

export interface ModeState {
  readonly aiMode: AiMode;
  readonly aiProvider: AiProvider;
  readonly claudeCliPath: string | null;
  readonly youtubeMode: DataSourceMode;
  readonly keys: { readonly anthropic: KeyState; readonly youtube: KeyState };
}

/** 서비스 계층 공통 의존성. 테스트에서는 메모리 DB·모의 클라이언트로 교체한다. */
export interface AppContext {
  readonly db: Db;
  readonly clock: Clock;
  readonly audit: AuditLog;
  readonly settings: SettingsRepo;
  readonly secrets: SecretStore;
  readonly config: RuntimeConfig;
  getLlm(): Promise<LlmClient>;
  getYouTube(): Promise<YouTubeClient>;
  /** 공개 영상 자막. YouTube 모의 모드에서는 자막 없음. */
  getTranscripts(): Promise<TranscriptSource>;
  modes(): Promise<ModeState>;
  /** 키·설정 변경 후 캐시된 클라이언트를 버린다. */
  resetClients(): void;
}

export interface ClientFactories {
  readonly createLlm: (apiKey: string) => LlmClient | AnthropicLlmClient;
  readonly createMockLlm: () => LlmClient;
  readonly createYouTube: (apiKey: string) => YouTubeClient;
  readonly createSyntheticYouTube: () => YouTubeClient;
}
