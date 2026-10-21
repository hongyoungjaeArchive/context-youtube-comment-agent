import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { createAppContext } from './bootstrap.ts';
import { BIND_HOST, loadRuntimeConfig, type RuntimeConfig } from './config.ts';
import { ensurePrivateDir } from './db/database.ts';
import { PlaywrightPostingDriver } from './execution/playwrightDriver.ts';
import { createServices, recoverOnStartup } from './services/container.ts';
import { createDefaultSecretStore } from './security/secretStore.ts';

function defaultWebDist(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../web/dist');
}

async function main(): Promise<void> {
  const loaded = loadRuntimeConfig();
  const config: RuntimeConfig = { ...loaded, webDistDir: loaded.webDistDir ?? defaultWebDist() };
  for (const dir of [config.paths.dataDir, config.paths.artifactsDir, config.paths.profilesDir, config.paths.logsDir, config.paths.runDir, config.paths.backupsDir]) {
    ensurePrivateDir(dir);
  }
  const ctx = createAppContext({ config, secrets: createDefaultSecretStore() });
  const services = createServices(ctx, new PlaywrightPostingDriver());
  const recovered = recoverOnStartup(services);
  const devPorts = process.env.CONTEXT_DEV === '1' ? [5173] : [];
  const { app } = await buildApp({ services, devPorts, logger: true });
  services.queue.start();
  await app.listen({ host: BIND_HOST, port: config.port });
  const pidFile = path.join(config.paths.runDir, 'server.pid');
  fs.writeFileSync(pidFile, String(process.pid), { mode: 0o600 });
  app.log.info({ recovered, fixtureMode: config.fixtureMode }, `CONTEXT 로컬 서버 http://${BIND_HOST}:${config.port}`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} 수신 — 안전 종료`);
    await services.queue.stop();
    // 진행 중 게시 실행은 기다린다. 강제 종료되면 다음 시작 시 UNKNOWN/INTERRUPTED로 복구된다.
    await services.executor.waitAll();
    await app.close();
    ctx.db.close();
    fs.rmSync(pidFile, { force: true });
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('[CONTEXT] 서버 시작 실패:', error instanceof Error ? error.message : error);
  process.exit(1);
});
