import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { z, ZodError } from 'zod';
import { PROMPT_VERSIONS, checkCommentStatic, type HealthDTO, type SettingsDTO } from '@context/shared';
import { APP_VERSION } from './config.ts';
import { AppError } from './lib/errors.ts';
import { localDate } from './lib/time.ts';
import { buildLocalGuard, createSessionToken } from './security/localGuard.ts';
import { redactString } from './security/redact.ts';
import { inspectUrl, listVideos, refreshVideos, toVideoDTO, videoRow } from './agents/research.ts';
import { createRevision, enqueuePrescore, getAnalysis, requestRevalidation, startAnalysis } from './services/analysis.ts';
import { addOperatorQuote, listEvidence, removeEvidence } from './services/evidence.ts';
import { approve, revokeApproval } from './execution/approvals.ts';
import { createProfile, deleteProfile, listProfiles } from './execution/profiles.ts';
import { checkProfileAuth, openProfileForLogin } from './execution/profileSession.ts';
import { listTargets, registerTarget } from './execution/targets.ts';
import { PRIORITY } from './orchestrator/queue.ts';
import { getBudgetPolicy, updateBudgetPolicy, usageSummary } from './orchestrator/budget.ts';
import { verifyAnthropicKey } from './clients/anthropicClient.ts';
import { checkClaudeCli, resolveClaudeBinary } from './clients/claudeCli.ts';
import { HttpYouTubeClient, YouTubeError } from './clients/youtube.ts';
import { backupDatabase } from './db/database.ts';
import type { Services } from './services/container.ts';
import { createSageService } from './services/sage.ts';
import { findRisingVideos, listTrendVideos } from './services/trends.ts';
import {
  HumanLabelSchema,
  StartEvalSchema,
  abComparison,
  addHumanLabel,
  datasetOverview,
  getRun,
  humanAiComparison,
  listRuns,
  regressionReport,
  releaseGates,
  startEval,
} from './eval/service.ts';

export interface AppOptions {
  readonly services: Services;
  readonly sessionToken?: string;
  readonly devPorts?: readonly number[];
  readonly logger?: boolean;
}

/** CLI 플래그로 해석되지 않도록 영문/숫자로 시작하는 모델 ID만 허용. */
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/;
const VideoIdParam = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{11}$/) });
const IdParam = z.object({ id: z.string().min(3).max(64).regex(/^[A-Za-z0-9_-]+$/) });

function fixtureHtmlPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'fixtures', 'youtube-fixture.html');
}

export async function buildApp(opts: AppOptions): Promise<{ app: FastifyInstance; sessionToken: string }> {
  const { services } = opts;
  const { ctx, queue, executor } = services;
  const sessionToken = opts.sessionToken ?? createSessionToken();
  const app = Fastify({
    logger: opts.logger
      ? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-csrf-token"]', 'req.headers["x-api-key"]'] }
      : false,
    bodyLimit: 256 * 1024,
    forceCloseConnections: true,
  });

  // 빈 본문 + application/json 요청을 {}로 처리 (본문 없는 POST 버튼 호출 허용).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (!text.trim()) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new AppError('INVALID_JSON', '요청 본문이 올바른 JSON이 아닙니다.'), undefined);
    }
  });
  app.addHook('onRequest', buildLocalGuard({ port: ctx.config.port, devPorts: opts.devPorts ?? [] }, sessionToken));
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    return payload;
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: { code: 'VALIDATION', message: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } });
    }
    if (error instanceof YouTubeError) return reply.code(502).send({ error: { code: `YOUTUBE_${error.code}`, message: error.message } });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: { code: 'BAD_REQUEST', message: redactString((error as Error).message) } });
    req.log.error({ err: redactString(String((error as Error).message ?? error)) }, 'unhandled');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: '서버 내부 오류가 발생했습니다. 실행 로그를 확인해 주세요.' } });
  });

  // ---------- 시스템 ----------
  app.get('/api/health', async (): Promise<HealthDTO> => {
    let db: HealthDTO['db'] = 'OK';
    try {
      ctx.db.prepare('SELECT 1').get();
    } catch {
      db = 'ERROR';
    }
    const modes = await ctx.modes();
    const day = localDate(ctx.clock());
    const usage = ctx.db.prepare('SELECT submit_attempts_reserved n FROM daily_usage WHERE local_date = ?').get(day) as { n: number } | undefined;
    const counts = queue.counts();
    return {
      status: db === 'OK' ? 'LOCAL_READY' : 'DEGRADED',
      version: APP_VERSION,
      db,
      aiMode: modes.aiMode,
      aiProvider: modes.aiProvider,
      youtubeMode: modes.youtubeMode,
      keys: modes.keys,
      fixtureMode: ctx.config.fixtureMode,
      daily: { localDate: day, reserved: usage?.n ?? 0, limit: ctx.settings.get().dailyMaxComments },
      queue: { running: counts.RUNNING ?? 0, waiting: (counts.QUEUED ?? 0) + (counts.WAITING_DEPENDENCY ?? 0) + (counts.RETRY_SCHEDULED ?? 0) },
    };
  });

  app.get('/api/session', async () => ({ csrfToken: sessionToken }));

  // ---------- 영상 탐색 (Research) ----------
  app.post('/api/videos/refresh', async () => {
    const result = await refreshVideos(ctx);
    const scoringQueued = ctx.settings.get().autoPrescore ? enqueuePrescore(ctx, queue) : 0;
    return { ...result, scoringQueued };
  });
  app.get('/api/videos', async (req) => {
    const q = z.object({ sort: z.enum(['recommended', 'latest', 'channel']).default('recommended') }).parse(req.query);
    return { videos: listVideos(ctx, q.sort) };
  });
  app.get('/api/videos/:id', async (req) => {
    const { id } = VideoIdParam.parse(req.params);
    const r = videoRow(ctx, id);
    if (!r) throw new AppError('NOT_FOUND', '영상을 찾을 수 없습니다.', 404);
    return toVideoDTO(ctx, r);
  });
  app.post('/api/trends/search', async () => findRisingVideos(ctx));
  app.get('/api/trends', async () => ({ videos: listTrendVideos(ctx) }));
  app.post('/api/videos/inspect-url', async (req) => {
    const body = z.object({ url: z.string().min(5).max(300) }).parse(req.body);
    return inspectUrl(ctx, body.url);
  });
  app.get('/api/videos/:id/evidence', async (req) => {
    const { id } = VideoIdParam.parse(req.params);
    return { evidence: listEvidence(ctx, id) };
  });
  app.post('/api/videos/:id/evidence', async (req) => {
    const { id } = VideoIdParam.parse(req.params);
    const body = z.object({ text: z.string().min(1).max(300), timestamp: z.string().max(10).nullable().default(null) }).parse(req.body);
    return addOperatorQuote(ctx, id, body.text, body.timestamp);
  });
  app.delete('/api/evidence/:id', async (req) => {
    const { id } = IdParam.parse(req.params);
    removeEvidence(ctx, id);
    return { ok: true };
  });

  // ---------- 분석·댓글 (Context / Marketing / Quality) ----------
  app.post('/api/analyses', async (req) => {
    const body = z.object({ videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/), force: z.boolean().default(false) }).parse(req.body);
    return startAnalysis(ctx, queue, body.videoId, { force: body.force });
  });
  app.get('/api/analyses/:id', async (req) => getAnalysis(ctx, IdParam.parse(req.params).id));
  app.post('/api/comments/revisions', async (req) => {
    const body = z.object({ candidateId: z.string().min(3).max(64), content: z.string().max(1000) }).parse(req.body);
    return createRevision(ctx, body.candidateId, body.content);
  });
  app.post('/api/comments/revalidate', async (req) => {
    const body = z.object({ revisionId: z.string().min(3).max(64) }).parse(req.body);
    return requestRevalidation(ctx, queue, body.revisionId);
  });
  app.post('/api/comments/static-check', async (req) => {
    const body = z.object({ content: z.string().max(1000) }).parse(req.body);
    return checkCommentStatic(body.content);
  });

  // ---------- 승인·실행 (Execution) ----------
  app.post('/api/approvals', async (req) => {
    const body = z.object({ revisionId: z.string(), reviewId: z.string(), testTargetId: z.string(), profileId: z.string() }).parse(req.body);
    return approve(ctx, body);
  });
  app.post('/api/approvals/:id/revoke', async (req) => revokeApproval(ctx, IdParam.parse(req.params).id));

  app.get('/api/targets', async () => ({ targets: listTargets(ctx) }));
  app.post('/api/targets', async (req) => {
    const body = z
      .object({
        url: z.string().max(300).default(''),
        attestOwnership: z.boolean().default(false),
        fixture: z.object({ videoId: z.string().max(11), mode: z.enum(['ok', 'signedout', 'nocomments', 'hang', 'slow', 'captcha']).optional() }).optional(),
      })
      .parse(req.body);
    return registerTarget(ctx, { url: body.url, attestOwnership: body.attestOwnership, ...(body.fixture ? { fixture: { videoId: body.fixture.videoId, ...(body.fixture.mode && body.fixture.mode !== 'ok' ? { mode: body.fixture.mode } : {}) } } : {}) });
  });

  app.get('/api/profiles', async () => ({ profiles: listProfiles(ctx) }));
  app.post('/api/profiles', async (req) => createProfile(ctx, z.object({ alias: z.string().min(1).max(20) }).parse(req.body).alias));
  app.delete('/api/profiles/:id', async (req) => {
    deleteProfile(ctx, IdParam.parse(req.params).id);
    return { ok: true };
  });
  app.post('/api/profiles/:id/open-login', async (req) => {
    await openProfileForLogin(ctx, IdParam.parse(req.params).id);
    return { ok: true, message: '전용 Chrome 창이 열렸습니다. 직접 로그인한 뒤 창을 닫아 주세요.' };
  });
  app.post('/api/profiles/:id/check-auth', async (req) => ({ status: await checkProfileAuth(ctx, IdParam.parse(req.params).id) }));

  app.post('/api/executions/test', async (req) => {
    const body = z.object({ approvalId: z.string(), profileId: z.string(), confirm: z.literal(true), requestId: z.string() }).parse(req.body);
    return executor.start(body);
  });
  app.get('/api/executions', async () => ({ executions: executor.list() }));
  app.get('/api/executions/:id', async (req) => executor.get(IdParam.parse(req.params).id));
  app.post('/api/executions/:id/resolve', async (req) => {
    const body = z.object({ outcome: z.enum(['CONFIRMED_POSTED', 'CONFIRMED_NOT_POSTED']), note: z.string().min(2).max(200) }).parse(req.body);
    return executor.resolve(IdParam.parse(req.params).id, body.outcome, body.note);
  });
  app.get('/api/artifacts/:id', async (req, reply) => {
    const file = path.resolve(executor.artifactPath(IdParam.parse(req.params).id));
    const root = path.resolve(ctx.config.paths.artifactsDir);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) throw new AppError('NOT_FOUND', '증거 파일이 없습니다.', 404);
    return reply.type('image/png').send(fs.createReadStream(file));
  });

  // ---------- Activity Center ----------
  app.get('/api/activity', async (req) => {
    const q = z.object({ type: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    return { events: ctx.audit.list(q.limit, q.type) };
  });
  app.post('/api/videos/:id/score', async (req) => {
    const { id } = VideoIdParam.parse(req.params);
    if (!videoRow(ctx, id)) throw new AppError('NOT_FOUND', '영상을 찾을 수 없습니다.', 404);
    const pv = ctx.settings.get().promptVersion;
    const r = queue.enqueue({ type: 'VIDEO_FIT', subjectId: id, priority: PRIORITY.RECOMMEND, idempotencyKey: `fit:${id}:${pv}`, payload: { videoId: id }, maxAttempts: 2 });
    return { jobId: r.job.job_id, created: r.created };
  });
  // ---------- Sage 비서 (읽기 전용 질의응답) ----------
  const sage = createSageService(ctx, queue);
  const SageAskBody = z.object({ question: z.string().trim().min(1).max(500), selectedVideoId: z.string().max(64).nullish() });
  app.post('/api/sage/ask', async (req) => sage.ask(SageAskBody.parse(req.body)));

  app.get('/api/jobs', async () => ({ jobs: queue.list(150), counts: queue.counts() }));
  app.post('/api/jobs/:id/cancel', async (req) => ({ cancelled: queue.cancel(IdParam.parse(req.params).id) }));
  app.get('/api/ai/usage', async () => usageSummary(ctx));
  app.get('/api/daily-usage', async () => ({ days: ctx.db.prepare('SELECT * FROM daily_usage ORDER BY local_date DESC LIMIT 30').all() }));

  // ---------- 설정 ----------
  const settingsDTO = async (): Promise<SettingsDTO> => {
    const s = ctx.settings.get();
    const modes = await ctx.modes();
    const b = getBudgetPolicy(ctx);
    return {
      models: { light: s.lightModel, heavy: s.heavyModel, fallbacks: s.fallbackModels },
      aiMode: modes.aiMode,
      aiProvider: modes.aiProvider,
      llmProvider: s.llmProvider,
      claudeCli: { path: modes.claudeCliPath },
      youtubeMode: modes.youtubeMode,
      promptVersion: s.promptVersion,
      budget: b,
      dailyMaxComments: s.dailyMaxComments,
      ownerChannelId: s.ownerChannelId,
      keys: modes.keys,
      maxConcurrency: s.maxConcurrency,
      autoPrescore: s.autoPrescore,
    };
  };
  app.get('/api/settings', settingsDTO);
  app.patch('/api/settings', async (req) => {
    const body = z
      .object({
        llmProvider: z.enum(['CLAUDE_CLI', 'ANTHROPIC_API', 'MOCK']).optional(),
        /** ANTHROPIC_API(종량 과금) 선택 시 반드시 true. */
        confirmMetered: z.boolean().optional(),
        youtubeModePreference: z.enum(['AUTO', 'LIVE', 'SYNTHETIC']).optional(),
        lightModel: z.string().regex(MODEL_ID_PATTERN, '모델 ID 형식이 아닙니다.').optional(),
        heavyModel: z.string().regex(MODEL_ID_PATTERN, '모델 ID 형식이 아닙니다.').optional(),
        promptVersion: z.enum(PROMPT_VERSIONS).optional(),
        ownerChannelId: z.string().nullable().optional(),
        dailyMaxComments: z.number().int().min(1).max(10).optional(),
        maxConcurrency: z.number().int().min(1).max(4).optional(),
        autoPrescore: z.boolean().optional(),
      })
      .parse(req.body);
    const { confirmMetered, ...patch } = body;
    if (patch.llmProvider === 'ANTHROPIC_API' && confirmMetered !== true) {
      throw new AppError('METERED_CONFIRMATION_REQUIRED', 'Anthropic API 키 Provider는 호출마다 종량 과금됩니다. 비용 발생에 동의(confirmMetered=true)해야 켤 수 있습니다.', 409);
    }
    ctx.settings.update(Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    if (patch.llmProvider) ctx.audit.record('settings', 'llm', 'LLM_PROVIDER_CHANGED', 'OPERATOR', { provider: patch.llmProvider, metered: patch.llmProvider === 'ANTHROPIC_API' });
    ctx.resetClients();
    ctx.audit.record('settings', 'app', 'SETTINGS_UPDATED', 'OPERATOR', { keys: Object.keys(body) });
    return settingsDTO();
  });
  app.put('/api/settings/budget', async (req) => {
    const body = z.object({ dailyLimitUsd: z.number().min(0).max(100), monthlyLimitUsd: z.number().min(0).max(1000), warningRatio: z.number().min(0.1).max(1) }).parse(req.body);
    updateBudgetPolicy(ctx, body);
    ctx.audit.record('settings', 'budget', 'BUDGET_UPDATED', 'OPERATOR', body);
    return settingsDTO();
  });
  const Provider = z.object({ provider: z.enum(['anthropic', 'youtube']) });
  app.post('/api/settings/api-key', async (req) => {
    const body = Provider.extend({ secret: z.string().min(10).max(300) }).parse(req.body);
    await ctx.secrets.set(body.provider, body.secret.trim());
    ctx.resetClients();
    ctx.audit.record('secret', body.provider, 'API_KEY_SAVED', 'OPERATOR', { store: ctx.secrets.kind });
    return { provider: body.provider, state: 'REGISTERED' };
  });
  app.delete('/api/settings/api-key/:provider', async (req) => {
    const { provider } = Provider.parse(req.params);
    await ctx.secrets.remove(provider);
    ctx.resetClients();
    ctx.audit.record('secret', provider, 'API_KEY_REMOVED', 'OPERATOR', {});
    return { provider, state: 'MISSING' };
  });
  app.post('/api/settings/api-key/:provider/test', async (req) => {
    const { provider } = Provider.parse(req.params);
    const key = await ctx.secrets.get(provider);
    if (!key) return { ok: false, message: '등록된 키가 없습니다.' };
    if (provider === 'anthropic') {
      // 사용자 비용 0원 원칙: 종량 과금 Provider를 명시적으로 켜지 않았으면 Anthropic API를 호출하지 않는다.
      if (ctx.settings.get().llmProvider !== 'ANTHROPIC_API') {
        return { ok: true, message: 'Keychain에 키가 등록되어 있습니다. 종량 과금 Provider가 꺼져 있어 API 확인 호출은 하지 않았습니다.' };
      }
      return verifyAnthropicKey(key, ctx.settings.get().heavyModel);
    }
    try {
      await new HttpYouTubeClient(key).getUploadsPlaylistId('UCxlc0Ky0aWoD8uI09ad44Tg');
      return { ok: true, message: 'YouTube Data API 키 확인 완료 (channels.list 1회)' };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : '확인 실패' };
    }
  });
  app.post('/api/settings/llm/check', async () => checkClaudeCli(resolveClaudeBinary()));
  app.post('/api/data/backup', async () => {
    const file = path.join(ctx.config.paths.backupsDir, `context-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    await backupDatabase(ctx.db, file);
    ctx.audit.record('data', 'backup', 'BACKUP_CREATED', 'OPERATOR', { file: path.basename(file) });
    return { ok: true, file: path.basename(file) };
  });

  // ---------- Evaluation Lab ----------
  app.get('/api/eval/dataset', async () => datasetOverview());
  app.get('/api/eval/runs', async () => ({ runs: listRuns(ctx) }));
  app.get('/api/eval/runs/:id', async (req) => getRun(ctx, IdParam.parse(req.params).id));
  app.post('/api/eval/runs', async (req) => startEval(ctx, StartEvalSchema.parse(req.body)));
  app.post('/api/eval/human-labels', async (req) => addHumanLabel(ctx, HumanLabelSchema.parse(req.body)));
  app.get('/api/eval/report', async () => ({
    gates: releaseGates(ctx),
    ab: abComparison(ctx),
    regression: regressionReport(ctx),
    humanComparison: humanAiComparison(ctx),
  }));

  // ---------- 로컬 픽스처 (E2E·데모 전용) ----------
  if (ctx.config.fixtureMode) {
    const html = fs.readFileSync(fixtureHtmlPath(), 'utf8');
    app.get('/__fixture/watch', async (_req, reply) => reply.type('text/html; charset=utf-8').send(html));
  }

  // ---------- 대시보드 정적 파일 ----------
  const webDist = ctx.config.webDistDir;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '없는 API 경로입니다.' } });
      return reply.sendFile('index.html');
    });
  }

  return { app, sessionToken };
}
