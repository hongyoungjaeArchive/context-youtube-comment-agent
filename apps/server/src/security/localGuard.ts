import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface GuardOptions {
  readonly port: number;
  /** 개발용 Vite 서버 포트 (프록시 경유 허용). */
  readonly devPorts: readonly number[];
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

function allowedHosts(opts: GuardOptions): Set<string> {
  const ports = [opts.port, ...opts.devPorts];
  return new Set(ports.flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]));
}

function allowedOrigins(opts: GuardOptions): Set<string> {
  const ports = [opts.port, ...opts.devPorts];
  return new Set(ports.flatMap((p) => [`http://127.0.0.1:${p}`, `http://localhost:${p}`]));
}

function safeEqual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SAFE_METHODS = new Set(['GET', 'HEAD']);

/**
 * 로컬 API 보호 (docs/09 §4, docs/12 §2):
 * 1) Host allowlist — DNS rebinding 차단
 * 2) 변경 요청은 Origin allowlist + Sec-Fetch-Site 검사
 * 3) 변경 요청은 서버 시작 시 생성한 세션 CSRF 토큰 헤더 필수 (임의 웹페이지의 localhost POST 차단)
 */
export function buildLocalGuard(opts: GuardOptions, token: string) {
  const hosts = allowedHosts(opts);
  const origins = allowedOrigins(opts);
  return async function localGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const host = (req.headers.host ?? '').toLowerCase();
    if (!hosts.has(host)) {
      await reply.code(421).send({ error: { code: 'HOST_NOT_ALLOWED', message: '허용되지 않은 Host 헤더입니다.' } });
      return;
    }
    // 경로 문자열로 /api/ 여부를 판별하지 않는다 — 퍼센트 인코딩(/%61pi/...)으로 우회될 수 있음.
    // Origin·Sec-Fetch-Site는 모든 요청에, CSRF는 모든 변경 메서드에 경로와 무관하게 적용한다.
    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    if (origin !== undefined && !origins.has(origin)) {
      await reply.code(403).send({ error: { code: 'ORIGIN_NOT_ALLOWED', message: '허용되지 않은 Origin입니다.' } });
      return;
    }
    // 다른 사이트의 링크로 대시보드를 여는 최상위 GET 문서 이동은 허용한다.
    // GET은 부작용이 없고, 응답은 교차 출처에서 읽을 수 없으므로 안전하다.
    const isSafeTopLevelNavigation =
      SAFE_METHODS.has(req.method) &&
      req.headers['sec-fetch-mode'] === 'navigate' &&
      req.headers['sec-fetch-dest'] === 'document';
    if (typeof site === 'string' && !['same-origin', 'none'].includes(site) && !isSafeTopLevelNavigation) {
      await reply.code(403).send({ error: { code: 'CROSS_SITE_BLOCKED', message: '교차 사이트 요청은 허용되지 않습니다.' } });
      return;
    }
    if (MUTATING.has(req.method)) {
      if (origin === undefined) {
        await reply.code(403).send({ error: { code: 'ORIGIN_REQUIRED', message: '변경 요청에는 Origin 헤더가 필요합니다.' } });
        return;
      }
      const supplied = req.headers['x-csrf-token'];
      if (typeof supplied !== 'string' || !safeEqual(supplied, token)) {
        await reply.code(403).send({ error: { code: 'CSRF_INVALID', message: 'CSRF 토큰이 없거나 올바르지 않습니다.' } });
        return;
      }
    }
  };
}
