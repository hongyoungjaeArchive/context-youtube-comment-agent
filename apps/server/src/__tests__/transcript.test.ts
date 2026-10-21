import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chunkTranscript, parseJson3, YtDlpTranscriptSource, type TranscriptCue, type TranscriptSource } from '../clients/transcript.ts';
import { collectEvidence } from '../agents/research.ts';
import { hardChecks } from '../agents/quality.ts';
import { listEvidence } from '../services/evidence.ts';
import { createSandbox, seedVideo, type Sandbox } from '../eval/sandbox.ts';

const JSON3 = JSON.stringify({
  events: [
    { tStartMs: 80, segs: [{ utf8: '남자는 생각보다 ' }, { utf8: '단순합니다.' }] },
    { tStartMs: 2750, segs: [{ utf8: '\n' }] },
    { tStartMs: 50_000, segs: [{ utf8: '처음에는 보고 싶다고 하고 연락도 먼저 해' }] },
    { tStartMs: 61_000 },
  ],
});

class StubTranscripts implements TranscriptSource {
  calls = 0;
  constructor(private readonly respond: () => Promise<TranscriptCue[] | null>) {}
  async fetch(): Promise<TranscriptCue[] | null> {
    this.calls++;
    return this.respond();
  }
}

describe('transcript parsing (TEST-CTX-03)', () => {
  it('parses json3 events into cues and skips blank lines', () => {
    expect(parseJson3(JSON3)).toEqual([
      { startMs: 80, text: '남자는 생각보다 단순합니다.' },
      { startMs: 50_000, text: '처음에는 보고 싶다고 하고 연락도 먼저 해' },
    ]);
  });

  it('returns an empty list for malformed json3', () => {
    expect(parseJson3('not json')).toEqual([]);
  });

  it('groups cues into 45-second windows with m:ss labels', () => {
    const cues = [
      { startMs: 0, text: '하나' },
      { startMs: 30_000, text: '둘' },
      { startMs: 46_000, text: '셋' },
      { startMs: 125_000, text: '넷' },
    ];
    expect(chunkTranscript(cues)).toEqual([
      { timestamp: '0:00', text: '하나 둘' },
      { timestamp: '0:46', text: '셋' },
      { timestamp: '2:05', text: '넷' },
    ]);
  });

  it('samples evenly across the whole video when there are too many windows', () => {
    const cues = Array.from({ length: 100 }, (_, i) => ({ startMs: i * 60_000, text: `구간${i}` }));
    const chunks = chunkTranscript(cues, { maxChunks: 10 });
    expect(chunks).toHaveLength(10);
    expect(chunks[0]!.text).toBe('구간0');
    expect(chunks[9]!.text).toBe('구간99');
  });
});

describe('YtDlpTranscriptSource (TEST-CTX-03)', () => {
  it('rejects malformed video ids without running the binary', async () => {
    let ran = false;
    const src = new YtDlpTranscriptSource({ run: async () => { ran = true; } });
    await expect(src.fetch('bad id; rm -rf')).rejects.toThrow(/영상 ID/);
    expect(ran).toBe(false);
  });

  it('reads the Korean json3 file the runner wrote and removes the temp folder', async () => {
    let usedDir = '';
    const src = new YtDlpTranscriptSource({
      run: async (_bin, args, cwd) => {
        usedDir = cwd;
        expect(args).toContain('--skip-download');
        expect(args.at(-1)).toBe('https://www.youtube.com/watch?v=akn-AvCeHBI');
        fs.writeFileSync(path.join(cwd, 'akn-AvCeHBI.ko.json3'), JSON3);
      },
    });
    const cues = await src.fetch('akn-AvCeHBI');
    expect(cues).toHaveLength(2);
    expect(fs.existsSync(usedDir)).toBe(false);
  });

  it('returns null when no Korean subtitles exist', async () => {
    const src = new YtDlpTranscriptSource({ run: async () => undefined });
    expect(await src.fetch('akn-AvCeHBI')).toBeNull();
  });
});

describe('collectEvidence with transcripts (TEST-CTX-03)', () => {
  let sbx: Sandbox | null = null;
  afterEach(async () => {
    await sbx?.dispose();
    sbx = null;
  });

  it('stores transcript windows as TRANSCRIPT evidence with timestamps, once', async () => {
    const transcripts = new StubTranscripts(async () => parseJson3(JSON3));
    sbx = createSandbox({ transcripts });
    seedVideo(sbx.ctx, { videoId: 'tr-vid-1', title: '남자 심리', evidence: [] });
    const first = await collectEvidence(sbx.ctx, 'tr-vid-1');
    await collectEvidence(sbx.ctx, 'tr-vid-1');
    const rows = listEvidence(sbx.ctx, 'tr-vid-1').filter((e) => e.sourceType === 'TRANSCRIPT');
    expect(rows.map((r) => r.timestamp)).toEqual(['0:00', '0:50']);
    expect(rows[1]!.text).toContain('연락도 먼저 해');
    expect(transcripts.calls).toBe(1);
    expect(first.limitations.join(' ')).not.toMatch(/자막/);
  });

  it('falls back to title·description when subtitles are missing', async () => {
    sbx = createSandbox({ transcripts: new StubTranscripts(async () => null) });
    seedVideo(sbx.ctx, { videoId: 'tr-vid-2', title: '남자 심리', evidence: [] });
    const r = await collectEvidence(sbx.ctx, 'tr-vid-2');
    expect(r.limitations.join(' ')).toMatch(/자막이 없어 제목·설명/);
  });

  it('keeps going when subtitle download fails', async () => {
    sbx = createSandbox({ transcripts: new StubTranscripts(async () => { throw new Error('yt-dlp 없음'); }) });
    seedVideo(sbx.ctx, { videoId: 'tr-vid-3', title: '남자 심리', evidence: [] });
    const r = await collectEvidence(sbx.ctx, 'tr-vid-3');
    expect(r.limitations.join(' ')).toMatch(/자막 수집 실패: yt-dlp 없음/);
  });
});

describe('SCENE_REFERENCE with transcripts (TEST-CTX-03)', () => {
  it('credits a comment that echoes a transcript line, with its timestamp', () => {
    const evidence = [
      { id: 'e1', sourceType: 'TITLE' as const, trustGrade: 'B' as const, text: '남자 심리 총정리', timestamp: null },
      { id: 'e2', sourceType: 'TRANSCRIPT' as const, trustGrade: 'B' as const, text: '처음에는 보고 싶다고 하고 연락도 먼저 해', timestamp: '0:50' },
    ];
    const checks = hardChecks(
      { id: 'r1', content: '처음엔 연락도 먼저 해주던 사람이 변하는 거 진짜 공감ㅠㅠ 운명원에서 우리 인연은 어떤지 한번 보고 싶다', usedEvidenceIds: ['e2'] },
      evidence as never,
      [],
    );
    const scene = checks.find((c) => c.code === 'SCENE_REFERENCE')!;
    expect(scene.state).toBe('PASS');
    expect(scene.message).toMatch(/자막 발언 반영 \(0:50\)/);
  });
});
