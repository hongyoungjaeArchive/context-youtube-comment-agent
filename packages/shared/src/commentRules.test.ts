import { describe, expect, it } from 'vitest';
import { checkCommentStatic, countChars, extractQuotedPhrases } from './commentRules.ts';
import { parseVideoId, isValidChannelId } from './videoUrl.ts';

const OK = '"연락이 줄었다고 마음이 식은 건 아니에요" 이 말 듣고 좀 안심됐어요. 운명원 연애사주로 제 인연 흐름도 보고 싶네요.';

describe('checkCommentStatic (TEST-AI-03/04)', () => {
  it('counts unicode code points, not UTF-16 units', () => {
    expect(countChars('가나다😀')).toBe(4);
  });
  it('passes a compliant 40~120 char comment', () => {
    const r = checkCommentStatic(OK);
    expect(r.ok).toBe(true);
    expect(r.mentionsBrand).toBe(true);
  });
  it('blocks too short / too long', () => {
    expect(checkCommentStatic('짧은 댓글').violations[0]?.code).toBe('TOO_SHORT');
    expect(checkCommentStatic('가'.repeat(121)).violations[0]?.code).toBe('TOO_LONG');
    expect(checkCommentStatic('가'.repeat(120)).violations).toHaveLength(0);
    expect(checkCommentStatic('가'.repeat(40)).violations).toHaveLength(0);
  });
  it('blocks links and domains', () => {
    expect(checkCommentStatic(`${OK} https://a.com`).violations.map((v) => v.code)).toContain('HAS_LINK');
    expect(checkCommentStatic(`${OK.slice(0, 50)} unmyungwon.kr 가보세요`).violations.map((v) => v.code)).toContain('HAS_LINK');
  });
  it('blocks hashtags but not inline # symbols inside words', () => {
    expect(checkCommentStatic(`${OK.slice(0, 60)} #연애사주`).violations.map((v) => v.code)).toContain('HAS_HASHTAG');
  });
  it('blocks fabricated first-person brand reviews', () => {
    const fake = '영상 보니까 생각나네요. 저 운명원에서 봤는데 진짜 소름 돋게 맞았어요 다들 꼭 가보세요 진심입니다요.';
    expect(checkCommentStatic(fake).violations.map((v) => v.code)).toContain('FAKE_REVIEW');
    const fake2 = '제가 직접 받아봤는데 연애운이 그대로 맞았어요. 운명원 연애사주 다들 한번 보세요 진짜 추천합니다요.';
    expect(checkCommentStatic(fake2).violations.map((v) => v.code)).toContain('FAKE_REVIEW');
  });
  it('extracts quoted phrases for evidence matching', () => {
    expect(extractQuotedPhrases(OK)).toEqual(['연락이 줄었다고 마음이 식은 건 아니에요']);
  });
});

describe('parseVideoId (TEST-VID-02)', () => {
  it.each([
    ['https://youtu.be/akn-AvCeHBI', 'akn-AvCeHBI'],
    ['youtu.be/akn-AvCeHBI', 'akn-AvCeHBI'],
    ['https://www.youtube.com/watch?v=JjY09DSdzx0&t=10', 'JjY09DSdzx0'],
    ['https://m.youtube.com/shorts/DvxMfC_KjX0', 'DvxMfC_KjX0'],
    ['3K82-PjUeP0', '3K82-PjUeP0'],
  ])('%s → %s', (input, id) => expect(parseVideoId(input)).toBe(id));
  it.each(['https://evil.com/watch?v=akn-AvCeHBI', 'javascript:alert(1)', 'not a url', 'https://youtube.com/watch?v=short'])('rejects %s', (input) => {
    expect(parseVideoId(input)).toBeNull();
  });
  it('validates channel ids', () => {
    expect(isValidChannelId('UCxlc0Ky0aWoD8uI09ad44Tg')).toBe(true);
    expect(isValidChannelId('UCshort')).toBe(false);
  });
});
