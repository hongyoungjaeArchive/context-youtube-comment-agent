import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 자막 한 줄 (영상 시작 기준 ms). */
export interface TranscriptCue {
  readonly startMs: number;
  readonly text: string;
}

/** 근거로 저장할 자막 구간. timestamp는 "m:ss". */
export interface TranscriptChunk {
  readonly timestamp: string;
  readonly text: string;
}

/** 공개 영상의 한국어 자막(수동 또는 자동 생성)을 가져온다. 자막이 없으면 null. */
export interface TranscriptSource {
  fetch(videoId: string): Promise<TranscriptCue[] | null>;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const WINDOW_MS = 45_000;
const MAX_CHUNKS = 40;
const RUN_TIMEOUT_MS = 60_000;
/** .command로 띄운 서버는 PATH에 Homebrew가 없을 수 있다. */
const EXTRA_PATHS = ['/opt/homebrew/bin', '/usr/local/bin'];

interface Json3Event {
  readonly tStartMs?: number;
  readonly segs?: readonly { readonly utf8?: string }[];
}

export function parseJson3(raw: string): TranscriptCue[] {
  let events: readonly Json3Event[];
  try {
    events = (JSON.parse(raw) as { events?: Json3Event[] }).events ?? [];
  } catch {
    return [];
  }
  return events.flatMap((e) => {
    const text = (e.segs ?? []).map((s) => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim();
    return text ? [{ startMs: e.tStartMs ?? 0, text }] : [];
  });
}

function formatTimestamp(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** 자막을 시간 구간으로 묶는다. 구간이 많으면 영상 전체에서 고르게 골라 앞부분만 남지 않게 한다. */
export function chunkTranscript(cues: readonly TranscriptCue[], opts: { windowMs?: number; maxChunks?: number } = {}): TranscriptChunk[] {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const maxChunks = opts.maxChunks ?? MAX_CHUNKS;
  const chunks = cues.reduce<{ startMs: number; texts: string[] }[]>((acc, cue) => {
    const last = acc.at(-1);
    if (last && cue.startMs - last.startMs < windowMs) {
      return [...acc.slice(0, -1), { ...last, texts: [...last.texts, cue.text] }];
    }
    return [...acc, { startMs: cue.startMs, texts: [cue.text] }];
  }, []);
  const picked =
    chunks.length <= maxChunks
      ? chunks
      : Array.from({ length: maxChunks }, (_, i) => chunks[Math.round((i * (chunks.length - 1)) / (maxChunks - 1))]!);
  return picked.map((c) => ({ timestamp: formatTimestamp(c.startMs), text: c.texts.join(' ') }));
}

type Runner = (bin: string, args: readonly string[], cwd: string) => Promise<void>;

const defaultRunner: Runner = (bin, args, cwd) =>
  new Promise((resolve, reject) => {
    const env = { ...process.env, PATH: [process.env.PATH ?? '', ...EXTRA_PATHS].join(':') };
    execFile(bin, [...args], { cwd, env, timeout: RUN_TIMEOUT_MS }, (error, _stdout, stderr) => {
      if (!error) return resolve();
      const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'yt-dlp를 찾지 못했습니다 (brew install yt-dlp)' : String(stderr || error.message).split('\n')[0];
      reject(new Error(reason));
    });
  });

/** yt-dlp로 자막 파일만 받는다(영상은 받지 않음). 임시 폴더는 항상 지운다. */
export class YtDlpTranscriptSource implements TranscriptSource {
  private readonly run: Runner;
  private readonly bin: string;

  constructor(opts: { run?: Runner; bin?: string } = {}) {
    this.run = opts.run ?? defaultRunner;
    this.bin = opts.bin ?? process.env.CONTEXT_YTDLP_BIN ?? 'yt-dlp';
  }

  async fetch(videoId: string): Promise<TranscriptCue[] | null> {
    if (!VIDEO_ID.test(videoId)) throw new Error('올바르지 않은 영상 ID입니다.');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-subs-'));
    try {
      await this.run(
        this.bin,
        ['--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', 'ko,ko-orig', '--sub-format', 'json3', '--no-playlist', '-o', '%(id)s.%(ext)s', `https://www.youtube.com/watch?v=${videoId}`],
        dir,
      );
      const file = ['ko', 'ko-orig'].map((lang) => path.join(dir, `${videoId}.${lang}.json3`)).find((f) => fs.existsSync(f));
      if (!file) return null;
      const cues = parseJson3(fs.readFileSync(file, 'utf8'));
      return cues.length ? cues : null;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

/** 모의 모드·테스트용: 자막 없음. */
export class NoTranscriptSource implements TranscriptSource {
  async fetch(): Promise<null> {
    return null;
  }
}
