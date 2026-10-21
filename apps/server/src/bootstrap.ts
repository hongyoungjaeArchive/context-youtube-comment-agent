import { NoTranscriptSource, YtDlpTranscriptSource, type TranscriptSource } from './clients/transcript.ts';
import type { AiMode, AiProvider, DataSourceMode, KeyState } from '@context/shared';
import { ClaudeCliLlmClient, resolveClaudeBinary } from './clients/claudeCli.ts';
import { AnthropicLlmClient } from './clients/anthropicClient.ts';
import type { LlmClient } from './clients/llm.ts';
import { MockLlmClient } from './clients/mockLlm.ts';
import { HttpYouTubeClient, SyntheticYouTubeClient, type YouTubeClient } from './clients/youtube.ts';
import type { RuntimeConfig } from './config.ts';
import type { AppContext, ModeState } from './context.ts';
import { openDatabase, type Db } from './db/database.ts';
import { AuditLog } from './lib/audit.ts';
import { SettingsRepo } from './lib/settings.ts';
import { systemClock, type Clock } from './lib/time.ts';
import type { SecretStore } from './security/secretStore.ts';

export interface ContextOptions {
  readonly config: RuntimeConfig;
  readonly secrets: SecretStore;
  readonly db?: Db;
  readonly clock?: Clock;
  /** 테스트/평가: 고정 클라이언트 주입 (키·설정과 무관). */
  readonly llmOverride?: LlmClient;
  readonly youtubeOverride?: YouTubeClient;
  readonly transcriptOverride?: TranscriptSource;
}

export function createAppContext(opts: ContextOptions): AppContext {
  const db = opts.db ?? openDatabase(opts.config.paths.dbFile);
  const clock = opts.clock ?? systemClock;
  const settings = new SettingsRepo(db, clock);
  const audit = new AuditLog(db, clock);
  let llm: LlmClient | null = null;
  let yt: YouTubeClient | null = null;

  async function keyState(account: 'anthropic' | 'youtube'): Promise<KeyState> {
    try {
      return (await opts.secrets.has(account)) ? 'REGISTERED' : 'MISSING';
    } catch {
      return 'UNAVAILABLE';
    }
  }

  async function modes(): Promise<ModeState> {
    const keys = { anthropic: await keyState('anthropic'), youtube: await keyState('youtube') };
    const s = settings.get();
    // CONTEXT_FORCE_MOCK_AI=1 / CONTEXT_FORCE_SYNTHETIC_YT=1: 개발·E2E에서 사용량을 쓰지 않도록 강제.
    const forceMock = process.env.CONTEXT_FORCE_MOCK_AI === '1';
    const forceSynthetic = process.env.CONTEXT_FORCE_SYNTHETIC_YT === '1';
    const claudeCliPath = resolveClaudeBinary();
    let aiProvider: AiProvider;
    if (opts.llmOverride) aiProvider = opts.llmOverride.provider;
    else if (forceMock || s.llmProvider === 'MOCK') aiProvider = 'MOCK';
    else if (s.llmProvider === 'ANTHROPIC_API') aiProvider = keys.anthropic === 'REGISTERED' ? 'ANTHROPIC_API' : 'MOCK';
    else aiProvider = claudeCliPath ? 'CLAUDE_CLI' : 'MOCK';
    const aiMode: AiMode = aiProvider === 'MOCK' ? 'MOCK' : 'LIVE';
    const youtubeMode: DataSourceMode = opts.youtubeOverride
      ? opts.youtubeOverride.mode
      : forceSynthetic || s.youtubeModePreference === 'SYNTHETIC' || keys.youtube !== 'REGISTERED'
        ? 'SYNTHETIC'
        : 'LIVE';
    return { aiMode, aiProvider, claudeCliPath, youtubeMode, keys };
  }

  return {
    db,
    clock,
    audit,
    settings,
    secrets: opts.secrets,
    config: opts.config,
    modes,
    resetClients() {
      llm = null;
      yt = null;
    },
    async getLlm() {
      if (opts.llmOverride) return opts.llmOverride;
      if (llm) return llm;
      const m = await modes();
      if (m.aiProvider === 'CLAUDE_CLI' && m.claudeCliPath) {
        llm = new ClaudeCliLlmClient(m.claudeCliPath);
      } else if (m.aiProvider === 'ANTHROPIC_API') {
        // 종량 과금 — 설정에서 명시적으로 켠 경우에만 도달한다.
        const key = await opts.secrets.get('anthropic');
        llm = key ? new AnthropicLlmClient(key) : new MockLlmClient();
      } else {
        llm = new MockLlmClient();
      }
      return llm;
    },
    async getYouTube() {
      if (opts.youtubeOverride) return opts.youtubeOverride;
      if (yt) return yt;
      const { youtubeMode } = await modes();
      const key = youtubeMode === 'LIVE' ? await opts.secrets.get('youtube') : null;
      yt = key ? new HttpYouTubeClient(key) : new SyntheticYouTubeClient(clock());
      return yt;
    },
    async getTranscripts() {
      if (opts.transcriptOverride) return opts.transcriptOverride;
      return (await modes()).youtubeMode === 'LIVE' ? new YtDlpTranscriptSource() : new NoTranscriptSource();
    },
  };
}
