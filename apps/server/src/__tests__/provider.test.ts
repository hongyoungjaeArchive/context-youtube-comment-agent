import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { createAppContext } from '../bootstrap.ts';
import { buildPaths } from '../config.ts';
import { openDatabase } from '../db/database.ts';
import { MemorySecretStore } from '../security/secretStore.ts';
import { createServices } from '../services/container.ts';
import { FakePostingDriver } from '../execution/fakeDriver.ts';
import { buildApp } from '../app.ts';
import { reserveBudget, updateBudgetPolicy } from '../orchestrator/budget.ts';

/** 사용자 비용 0원 원칙: 기본은 Claude Code CLI(구독), Anthropic API(종량 과금)는 명시적 동의 없이는 켜지지 않는다. */
const PORT = 4398;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-provider-'));
const fakeClaude = path.join(dir, 'claude');
let app: FastifyInstance;
let token = '';
const secrets = new MemorySecretStore({ anthropic: 'dummy-anthropic-key-for-test' });
const ctx = createAppContext({
  config: { port: PORT, paths: buildPaths(dir), fixtureMode: false, headlessBrowser: true, webDistDir: null },
  secrets,
  db: openDatabase(':memory:'),
});

async function api<T>(method: string, url: string, body?: unknown) {
  const r = await app.inject({ method: method as 'GET', url, headers: { host: `127.0.0.1:${PORT}`, origin: `http://127.0.0.1:${PORT}`, 'x-csrf-token': token, 'content-type': 'application/json' }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
  return { status: r.statusCode, json: r.json() as T };
}

beforeAll(async () => {
  fs.writeFileSync(fakeClaude, '#!/bin/bash\necho "1.0.0 (Claude Code)"\n', { mode: 0o755 });
  process.env.CONTEXT_CLAUDE_BIN = fakeClaude;
  const services = createServices(ctx, new FakePostingDriver());
  const built = await buildApp({ services });
  app = built.app;
  token = built.sessionToken;
});
afterAll(async () => {
  delete process.env.CONTEXT_CLAUDE_BIN;
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('LLM provider selection', () => {
  it('defaults to CLAUDE_CLI even when an Anthropic API key is registered', async () => {
    const m = await ctx.modes();
    expect(m.aiProvider).toBe('CLAUDE_CLI');
    const llm = await ctx.getLlm();
    expect(llm.provider).toBe('CLAUDE_CLI');
    expect(llm.billing).toBe('SUBSCRIPTION');
  });

  it('refuses to enable ANTHROPIC_API without explicit metered-cost confirmation', async () => {
    const r = await api<{ error: { code: string } }>('PATCH', '/api/settings', { llmProvider: 'ANTHROPIC_API' });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('METERED_CONFIRMATION_REQUIRED');
    expect((await ctx.modes()).aiProvider).toBe('CLAUDE_CLI');
  });

  it('Anthropic key test does not call the API while the metered provider is off', async () => {
    const r = await api<{ ok: boolean; message: string }>('POST', '/api/settings/api-key/anthropic/test');
    expect(r.json.message).toContain('호출은 하지 않았습니다');
  });

  it('CLI check runs only --version', async () => {
    const r = await api<{ available: boolean; version: string }>('POST', '/api/settings/llm/check');
    expect(r.json).toMatchObject({ available: true, version: '1.0.0 (Claude Code)' });
  });

  it('with confirmation the metered provider can be enabled, and falls back to MOCK when no key', async () => {
    const r = await api<{ llmProvider: string; aiProvider: string }>('PATCH', '/api/settings', { llmProvider: 'ANTHROPIC_API', confirmMetered: true });
    expect(r.json).toMatchObject({ llmProvider: 'ANTHROPIC_API', aiProvider: 'ANTHROPIC_API' });
    await secrets.remove('anthropic');
    ctx.resetClients();
    expect((await ctx.modes()).aiProvider).toBe('MOCK');
    await api('PATCH', '/api/settings', { llmProvider: 'CLAUDE_CLI' });
  });

  it('budget limits apply only to METERED billing', () => {
    updateBudgetPolicy(ctx, { dailyLimitUsd: 0, monthlyLimitUsd: 0, warningRatio: 0.7 });
    expect(reserveBudget(ctx, 'j1', 5, 'SUBSCRIPTION').ok).toBe(true);
    expect(reserveBudget(ctx, 'j2', 5, 'NONE').ok).toBe(true);
    expect(reserveBudget(ctx, 'j3', 5, 'METERED').ok).toBe(false);
  });
});
