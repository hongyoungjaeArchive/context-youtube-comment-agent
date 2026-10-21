import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { LlmError, type LlmClient, type LlmRequest, type LlmResponse } from './llm.ts';

const DEFAULT_TIMEOUT_MS = 240_000;
const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
/** 자식 프로세스에 넘기지 않는 환경 변수 — 종량 과금 API 키로 새는 것을 막는다(구독 OAuth만 사용). */
const STRIPPED_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX'];

export function resolveClaudeBinary(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.CONTEXT_CLAUDE_BIN,
    ...(env.PATH ?? '').split(':').filter(Boolean).map((d) => path.join(d, 'claude')),
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ].filter((p): p is string => Boolean(p));
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      // 다음 후보
    }
  }
  return null;
}

interface CliResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  api_error_status?: number | null;
  result?: string;
  structured_output?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  modelUsage?: Record<string, unknown>;
}

function runProcess(bin: string, args: readonly string[], stdin: string, timeoutMs: number, cwd: string): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const k of STRIPPED_ENV) delete env[k];
    const child = spawn(bin, [...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3_000).unref();
    }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < MAX_STDOUT_BYTES) stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += d.toString('utf8');
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.end(stdin);
  });
}

function mapApiStatus(status: number | null | undefined, message: string): LlmError {
  if (status === 429) return new LlmError('RATE_LIMITED', `Claude 사용량 한도(429): ${message}`);
  if (status === 529) return new LlmError('OVERLOADED', 'Claude 과부하(529)');
  if (status === 401 || status === 403) return new LlmError('AUTH', 'Claude Code 로그인/권한 문제 — 터미널에서 `claude` 로그인 상태를 확인하세요.');
  if (status === 404) return new LlmError('MODEL_UNAVAILABLE', '모델을 사용할 수 없습니다.');
  if (typeof status === 'number' && status >= 500) return new LlmError('SERVER', `Claude 서버 오류(${status})`);
  return new LlmError('BAD_REQUEST', `Claude Code CLI 오류: ${message.slice(0, 200)}`);
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('JSON 없음');
  return JSON.parse(body.slice(start, end + 1));
}

/**
 * 기본 Provider: 로컬 Claude Code CLI(`claude -p --output-format json`).
 * 사용자의 Claude 구독 사용량으로 처리되어 추가 종량 과금이 없다(billing=SUBSCRIPTION).
 * - 도구 전부 비활성(--tools ""), MCP·설정 파일 미로드, 세션 저장 안 함, 빈 임시 폴더에서 실행.
 * - --json-schema로 구조화 출력, 그래도 서버에서 zod로 다시 검증.
 * - 재시도는 하지 않는다(오케스트레이터 한 곳에서만).
 */
export class ClaudeCliLlmClient implements LlmClient {
  readonly mode = 'LIVE' as const;
  readonly provider = 'CLAUDE_CLI' as const;
  readonly billing = 'SUBSCRIPTION' as const;
  private readonly bin: string;
  private readonly timeoutMs: number;

  constructor(bin: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.bin = bin;
    this.timeoutMs = timeoutMs;
  }

  async generate<T>(req: LlmRequest<T>): Promise<LlmResponse<T>> {
    const started = Date.now();
    const schema = JSON.stringify(z.toJSONSchema(req.schema as z.ZodType, { target: 'draft-7' }));
    const args = [
      '-p',
      '--output-format',
      'json',
      '--model',
      req.model,
      '--system-prompt',
      req.system,
      '--json-schema',
      schema,
      '--tools',
      '',
      '--no-session-persistence',
      '--strict-mcp-config',
      '--setting-sources',
      '',
    ];
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'context-claude-'));
    let out: Awaited<ReturnType<typeof runProcess>>;
    try {
      out = await runProcess(this.bin, args, req.prompt, this.timeoutMs, cwd);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new LlmError('PROVIDER_UNAVAILABLE', code === 'ENOENT' ? 'Claude Code CLI(claude)를 찾을 수 없습니다.' : `Claude Code CLI 실행 실패: ${String(code ?? error)}`);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
    if (out.timedOut) throw new LlmError('TIMEOUT', `Claude Code CLI 응답 시간 초과(${Math.round(this.timeoutMs / 1000)}초)`);
    let parsed: CliResult;
    try {
      parsed = JSON.parse(out.stdout) as CliResult;
    } catch {
      const hint = out.stderr.trim().split('\n').slice(-1)[0] ?? '';
      throw new LlmError(out.code === 0 ? 'INVALID_OUTPUT' : 'BAD_REQUEST', `Claude Code CLI 출력이 JSON이 아닙니다 (종료 코드 ${String(out.code)}) ${hint.slice(0, 160)}`);
    }
    if (parsed.is_error || parsed.subtype !== 'success') {
      throw mapApiStatus(parsed.api_error_status, String(parsed.result ?? parsed.subtype ?? 'error'));
    }
    let candidate: unknown = parsed.structured_output;
    if (candidate === undefined || candidate === null) {
      try {
        candidate = extractJson(parsed.result ?? '');
      } catch {
        throw new LlmError('INVALID_OUTPUT', '구조화 출력(JSON)을 찾지 못했습니다.');
      }
    }
    const check = req.schema.safeParse(candidate);
    if (!check.success) throw new LlmError('INVALID_OUTPUT', `출력이 스키마와 맞지 않습니다: ${check.error.issues[0]?.message ?? ''}`);
    const usage = parsed.usage ?? {};
    return {
      data: check.data,
      modelId: Object.keys(parsed.modelUsage ?? {})[0] ?? req.model,
      latencyMs: Date.now() - started,
      usage: {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}

/** 모델 호출 없이 CLI 존재·버전만 확인 (사용량 0). */
export async function checkClaudeCli(bin: string | null): Promise<{ available: boolean; version: string | null; message: string }> {
  if (!bin) return { available: false, version: null, message: 'Claude Code CLI(claude)를 찾을 수 없습니다. 설치·로그인 후 다시 확인하세요.' };
  try {
    const cwd = os.tmpdir();
    const out = await runProcess(bin, ['--version'], '', 15_000, cwd);
    const version = out.stdout.trim().split('\n')[0] ?? null;
    return out.code === 0 ? { available: true, version, message: `Claude Code CLI 확인: ${version}` } : { available: false, version: null, message: 'claude --version 실행 실패' };
  } catch {
    return { available: false, version: null, message: 'claude 실행 실패' };
  }
}
