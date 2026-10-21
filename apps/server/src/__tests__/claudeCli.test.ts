import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ClaudeCliLlmClient, checkClaudeCli } from '../clients/claudeCli.ts';
import { LlmError } from '../clients/llm.ts';

/** 실제 claude를 부르지 않고, 같은 인터페이스의 가짜 실행 파일로 출력 파싱·오류 매핑을 검증한다. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function fakeBin(name: string, script: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/bash\n${script}\n`, { mode: 0o755 });
  return p;
}

const schema = z.object({ sum: z.number() });
const req = { role: 'CONTEXT' as const, model: 'claude-sonnet-5-5', system: 'sys', prompt: 'hello', schema, maxTokens: 100, effort: 'low' as const, input: {} };

describe('ClaudeCliLlmClient (기본 Provider, 구독 사용량)', () => {
  it('parses structured_output and usage; passes model/schema flags; strips API key env; reads prompt from stdin', async () => {
    const log = path.join(dir, 'args.txt');
    const bin = fakeBin(
      'ok',
      `printf '%s\\n' "$@" > ${log}; echo "KEY=\${ANTHROPIC_API_KEY:-none}" >> ${log}; IN=$(cat); echo "STDIN=$IN" >> ${log}
echo '{"type":"result","subtype":"success","is_error":false,"result":"{\\"sum\\":5}","structured_output":{"sum":5},"usage":{"input_tokens":10,"output_tokens":3,"cache_read_input_tokens":2,"cache_creation_input_tokens":4},"modelUsage":{"claude-sonnet-5-5":{}}}'`,
    );
    process.env.ANTHROPIC_API_KEY = 'should-not-leak';
    try {
      const client = new ClaudeCliLlmClient(bin);
      expect(client.billing).toBe('SUBSCRIPTION');
      const res = await client.generate(req);
      expect(res.data).toEqual({ sum: 5 });
      expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 3, cacheReadTokens: 2, cacheWriteTokens: 4 });
      const args = fs.readFileSync(log, 'utf8');
      expect(args).toContain('--output-format\njson');
      expect(args).toContain('--model\nclaude-sonnet-5-5');
      expect(args).toContain('--json-schema');
      expect(args).toContain('--no-session-persistence');
      expect(args).toContain('KEY=none');
      expect(args).toContain('STDIN=hello');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('falls back to JSON inside result text when structured_output is absent', async () => {
    const bin = fakeBin('fenced', `cat >/dev/null; echo '{"type":"result","subtype":"success","is_error":false,"result":"\`\`\`json\\n{\\"sum\\":7}\\n\`\`\`"}'`);
    expect((await new ClaudeCliLlmClient(bin).generate(req)).data).toEqual({ sum: 7 });
  });

  it.each([
    ['schema mismatch', `echo '{"type":"result","subtype":"success","is_error":false,"structured_output":{"sum":"x"}}'`, 'INVALID_OUTPUT'],
    ['non-JSON stdout', `echo 'not json'`, 'INVALID_OUTPUT'],
    ['rate limit', `echo '{"type":"result","subtype":"success","is_error":true,"api_error_status":429,"result":"limit"}'`, 'RATE_LIMITED'],
    ['auth', `echo '{"type":"result","subtype":"error","is_error":true,"api_error_status":401,"result":"x"}'`, 'AUTH'],
    ['server', `echo '{"type":"result","subtype":"success","is_error":true,"api_error_status":500,"result":"x"}'`, 'SERVER'],
  ])('%s → %s', async (_n, script, kind) => {
    const bin = fakeBin(`e_${kind}_${Math.random().toString(36).slice(2, 6)}`, `cat >/dev/null; ${script}`);
    await expect(new ClaudeCliLlmClient(bin).generate(req)).rejects.toMatchObject({ kind });
  });

  it('times out and kills the process', async () => {
    const bin = fakeBin('slow', 'cat >/dev/null; sleep 5');
    const err = await new ClaudeCliLlmClient(bin, 300).generate(req).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).kind).toBe('TIMEOUT');
  });

  it('missing binary → PROVIDER_UNAVAILABLE', async () => {
    await expect(new ClaudeCliLlmClient(path.join(dir, 'nope')).generate(req)).rejects.toMatchObject({ kind: 'PROVIDER_UNAVAILABLE' });
  });

  it('checkClaudeCli only runs --version (no model call)', async () => {
    const bin = fakeBin('ver', 'if [ "$1" = "--version" ]; then echo "9.9.9 (Claude Code)"; else echo CALLED >&2; exit 3; fi');
    const r = await checkClaudeCli(bin);
    expect(r).toMatchObject({ available: true, version: '9.9.9 (Claude Code)' });
    expect((await checkClaudeCli(null)).available).toBe(false);
  });
});
