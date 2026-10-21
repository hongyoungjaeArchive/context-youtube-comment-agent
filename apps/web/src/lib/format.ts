export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

const dateTimeFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const dateFmt = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function safeDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDateTime(iso: string | null | undefined): string {
  const d = safeDate(iso);
  return d ? dateTimeFmt.format(d) : '—';
}

export function fmtDate(iso: string | null | undefined): string {
  const d = safeDate(iso);
  return d ? dateFmt.format(d) : '—';
}

export function fmtTime(iso: string | null | undefined): string {
  const d = safeDate(iso);
  return d ? timeFmt.format(d) : '—';
}

export function fmtCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}만`;
  return n.toLocaleString('ko-KR');
}

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'NOT MEASURED';
  return `${(n * 100).toFixed(1)}%`;
}

/** 실행 요청 ID: crypto.randomUUID() 하이픈 제거 앞 24자. */
export function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
}

/** mm:ss 또는 h:mm:ss */
export const TIMESTAMP_PATTERN = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;
