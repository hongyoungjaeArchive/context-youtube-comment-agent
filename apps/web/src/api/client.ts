import type { ApiErrorBody } from '@context/shared';

/** 서버가 돌려준 `{ error: { code, message } }`를 그대로 담는 오류. message는 한국어로 사용자에게 바로 표시한다. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** CSRF 토큰은 메모리에만 보관한다 (localStorage 금지). */
let csrfToken: string | null = null;
let sessionPromise: Promise<string> | null = null;

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as Partial<ApiErrorBody>;
    if (body.error && typeof body.error.code === 'string') {
      return new ApiError(body.error.code, body.error.message ?? '요청이 실패했습니다.', res.status);
    }
  } catch {
    // JSON이 아닌 응답 — 아래 일반 오류로 처리
  }
  return new ApiError(`HTTP_${res.status}`, `서버 응답 오류 (${res.status})`, res.status);
}

async function fetchSession(): Promise<string> {
  const res = await fetch('/api/session', { credentials: 'same-origin' });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { csrfToken: string };
  csrfToken = body.csrfToken;
  return body.csrfToken;
}

export function ensureSession(): Promise<string> {
  if (csrfToken) return Promise.resolve(csrfToken);
  sessionPromise ??= fetchSession().finally(() => {
    sessionPromise = null;
  });
  return sessionPromise;
}

async function send(method: string, url: string, body: unknown): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (MUTATING_METHODS.has(method)) {
    headers['x-csrf-token'] = await ensureSession();
    headers['content-type'] = 'application/json';
  }
  const init: RequestInit = { method, headers, credentials: 'same-origin' };
  if (MUTATING_METHODS.has(method)) init.body = JSON.stringify(body ?? {});
  return fetch(url, init);
}

export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await send(method, url, body);
    // 서버 재시작으로 토큰이 바뀐 경우 1회만 다시 받아 재시도한다.
    if (res.status === 403 && MUTATING_METHODS.has(method)) {
      const err = await parseError(res.clone());
      if (err.code === 'CSRF_INVALID') {
        csrfToken = null;
        res = await send(method, url, body);
      }
    }
  } catch {
    throw new ApiError('NETWORK', '로컬 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해 주세요.', 0);
  }
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError('UNKNOWN_ERROR', e instanceof Error ? e.message : '알 수 없는 오류', 0);
}
