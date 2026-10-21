import { describe, expect, it } from 'vitest';
import { faultScenarios } from './scenarios.ts';

describe('장애 주입 10종 (TEST-OPS-01, TEST-SEC-05/06, TEST-POL-02, TEST-EXE-02/03, TEST-DATA-01)', () => {
  for (const s of faultScenarios()) {
    it(`${s.id} ${s.title}`, async () => {
      const r = await s.run();
      expect(r.passed, r.detail).toBe(true);
    });
  }
});
