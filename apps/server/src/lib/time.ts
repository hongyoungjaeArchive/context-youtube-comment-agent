import { OPERATION_LIMITS } from '@context/shared';

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();

/** Asia/Seoul 기준 YYYY-MM-DD (하루 한도 계산 기준, docs/08 §5). */
export function localDate(date: Date, timeZone: string = OPERATION_LIMITS.timezone): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function localMonth(date: Date): string {
  return localDate(date).slice(0, 7);
}
