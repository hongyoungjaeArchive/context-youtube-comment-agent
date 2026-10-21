import { BRAND_NAME, COMMENT_RULES } from './constants.ts';

export type StaticViolationCode =
  | 'TOO_SHORT'
  | 'TOO_LONG'
  | 'HAS_LINK'
  | 'HAS_HASHTAG'
  | 'FAKE_REVIEW'
  | 'EMPTY';

export interface StaticViolation {
  readonly code: StaticViolationCode;
  readonly message: string;
}

export interface StaticCheckResult {
  /** 유니코드 코드포인트 기준 글자 수(공백 포함, 앞뒤 공백 제외). */
  readonly charCount: number;
  readonly mentionsBrand: boolean;
  readonly violations: readonly StaticViolation[];
  readonly ok: boolean;
}

const LINK_PATTERN = /(https?:\/\/|www\.|youtu\.be|[a-z0-9-]+\.(com|net|kr|co|io|me|ly|org)(\/|\b))/i;
const HASHTAG_PATTERN = /(^|\s)#[^\s#]+/u;

/**
 * 운명원을 직접 이용한 것처럼 지어낸 후기 표현 (과제 p.3 금지).
 * 브랜드명 근처에 1인칭 이용 경험 서술이 있으면 차단한다.
 */
const FAKE_REVIEW_PATTERNS: readonly RegExp[] = [
  new RegExp(`${BRAND_NAME}[^.!?\\n]{0,20}(봤는데|받았는데|받아봤|봤더니|가봤|다녀왔|상담받|해봤는데|봤어요|봤음|맞았|맞더라|소름)`),
  /(제가|내가|저도|나도)\s?[^.!?\n]{0,12}(직접\s?)?(받아\s?봤|가\s?봤|다녀왔|상담\s?받았)/,
  /(후기|리뷰)\s?(남겨|남깁|올려)/,
];

export function countChars(text: string): number {
  return Array.from(text.trim()).length;
}

export function checkCommentStatic(content: string): StaticCheckResult {
  const charCount = countChars(content);
  const violations: StaticViolation[] = [];
  if (charCount === 0) {
    violations.push({ code: 'EMPTY', message: '댓글이 비어 있습니다.' });
  } else if (charCount < COMMENT_RULES.minChars) {
    violations.push({ code: 'TOO_SHORT', message: `${COMMENT_RULES.minChars}자 이상이어야 합니다 (현재 ${charCount}자).` });
  } else if (charCount > COMMENT_RULES.maxChars) {
    violations.push({ code: 'TOO_LONG', message: `${COMMENT_RULES.maxChars}자 이하여야 합니다 (현재 ${charCount}자).` });
  }
  if (LINK_PATTERN.test(content)) {
    violations.push({ code: 'HAS_LINK', message: '링크·도메인은 포함할 수 없습니다.' });
  }
  if (HASHTAG_PATTERN.test(content)) {
    violations.push({ code: 'HAS_HASHTAG', message: '해시태그는 포함할 수 없습니다.' });
  }
  if (FAKE_REVIEW_PATTERNS.some((p) => p.test(content))) {
    violations.push({ code: 'FAKE_REVIEW', message: '운명원을 직접 이용한 것처럼 보이는 후기 표현은 금지입니다.' });
  }
  return {
    charCount,
    mentionsBrand: content.includes(BRAND_NAME),
    violations,
    ok: violations.length === 0,
  };
}

/** 댓글 안에서 따옴표로 인용한 구절을 추출한다 (인용 원문 대조용). */
export function extractQuotedPhrases(content: string): string[] {
  const out: string[] = [];
  const pattern = /["“”'‘’「『]([^"“”'‘’」』]{4,})["“”'‘’」』]/gu;
  for (const match of content.matchAll(pattern)) {
    const phrase = match[1]?.trim();
    if (phrase) out.push(phrase);
  }
  return out;
}

/** 공백·문장부호를 제거한 비교용 정규화. */
export function normalizeForMatch(text: string): string {
  return text.replace(/[\s.,!?~…·"“”'‘’「」『』()\[\]]/gu, '').toLowerCase();
}
