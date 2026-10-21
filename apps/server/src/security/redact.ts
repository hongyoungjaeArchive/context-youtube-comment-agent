/** 로그·감사 메타데이터에서 비밀값 패턴을 마스킹한다 (docs/12 §3). */
const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_\-]{8,}/g,
  /AIza[0-9A-Za-z_\-]{20,}/g,
  /ya29\.[0-9A-Za-z_\-]+/g,
  /(x-api-key|authorization|cookie|set-cookie)\s*[:=]\s*[^\s,;]+/gi,
];

const SENSITIVE_KEYS = /^(secret|apikey|api_key|key|token|password|cookie|authorization|x-api-key)$/i;

export function redactString(text: string): string {
  return SECRET_PATTERNS.reduce((acc, p) => acc.replace(p, '[REDACTED]'), text);
}

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redactValue(v, depth + 1)]),
    );
  }
  return value;
}
