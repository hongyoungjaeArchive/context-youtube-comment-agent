import { NoTranscriptSource, type TranscriptSource } from '../clients/transcript.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppContext } from '../bootstrap.ts';
import type { LlmClient } from '../clients/llm.ts';
import { MockLlmClient } from '../clients/mockLlm.ts';
import { SyntheticYouTubeClient } from '../clients/youtube.ts';
import { buildPaths, type RuntimeConfig } from '../config.ts';
import type { AppContext } from '../context.ts';
import { openDatabase } from '../db/database.ts';
import type { PostingDriver } from '../execution/driver.ts';
import { FakePostingDriver } from '../execution/fakeDriver.ts';
import { insertEvidence } from '../services/evidence.ts';
import { createServices, type Services } from '../services/container.ts';
import { MemorySecretStore } from '../security/secretStore.ts';
import type { Clock } from '../lib/time.ts';

export interface Sandbox extends Services {
  readonly dir: string;
  dispose(): Promise<void>;
}

/** 평가·장애 주입·테스트용 격리 환경: 임시 폴더 + 메모리(또는 임시 파일) DB + 주입 클라이언트. 실데이터 DB와 분리. */
export function createSandbox(opts: { llm?: LlmClient; transcripts?: TranscriptSource; driver?: PostingDriver; clock?: Clock; fileDb?: boolean; port?: number } = {}): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-sbx-'));
  const config: RuntimeConfig = { port: opts.port ?? 4399, paths: buildPaths(dir), fixtureMode: true, headlessBrowser: true, webDistDir: null };
  const db = openDatabase(opts.fileDb ? config.paths.dbFile : ':memory:');
  const ctx: AppContext = createAppContext({
    config,
    secrets: new MemorySecretStore(),
    db,
    ...(opts.clock ? { clock: opts.clock } : {}),
    llmOverride: opts.llm ?? new MockLlmClient(),
    youtubeOverride: new SyntheticYouTubeClient(opts.clock?.() ?? new Date()),
    transcriptOverride: opts.transcripts ?? new NoTranscriptSource(),
  });
  const services = createServices(ctx, opts.driver ?? new FakePostingDriver());
  return {
    ...services,
    dir,
    async dispose() {
      await services.queue.stop();
      await services.executor.waitAll();
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function seedVideo(
  ctx: AppContext,
  input: { videoId: string; title: string; channelId?: string; evidence: readonly { grade: 'A' | 'B' | 'C'; sourceType: 'TITLE' | 'DESCRIPTION' | 'COMMENT' | 'OPERATOR_QUOTE' | 'TRANSCRIPT'; text: string; timestamp?: string }[] },
): void {
  const now = ctx.clock().toISOString();
  ctx.db
    .prepare(
      `INSERT OR REPLACE INTO videos (video_id, channel_id, channel_name, title, description, thumbnail_url, published_at, view_count, comment_count, source, allowed, first_seen_at, last_seen_at)
       VALUES (?,?,?,?,?,NULL,?,NULL,NULL,'SYNTHETIC',1,?,?)`,
    )
    .run(input.videoId, input.channelId ?? 'UCxlc0Ky0aWoD8uI09ad44Tg', '평가', input.title, '', now, now, now);
  for (const e of input.evidence) {
    insertEvidence(ctx, { videoId: input.videoId, sourceType: e.sourceType, text: e.text, grade: e.grade, verifiedBy: 'EVAL_SEED', timestamp: e.timestamp ?? null });
  }
}
