import { describe, expect, it } from 'vitest';
import { stripEvidenceIds } from './evidenceText.ts';

describe('stripEvidenceIds', () => {
  it('removes a parenthesised evidence id', () => {
    expect(stripEvidenceIds('대화 이어가기가 어렵다(ev_d51b37cd04d44d15a01f). 영상은')).toBe('대화 이어가기가 어렵다. 영상은');
  });
  it('removes several comma-separated ids', () => {
    expect(stripEvidenceIds('비하 성격의 글(ev_4a0475a060ff4926b715, ev_20774b5b9b0a4ed4996a)이 있다')).toBe('비하 성격의 글이 있다');
  });
  it('leaves text without ids unchanged', () => {
    expect(stripEvidenceIds('자동 자막이라 오탈자가 있을 수 있다')).toBe('자동 자막이라 오탈자가 있을 수 있다');
  });
});
