import { describe, expect, it } from 'vitest';
import { createProfile } from '../execution/profiles.ts';
import { checkProfileAuth } from '../execution/profileSession.ts';
import { createSandbox } from '../eval/sandbox.ts';

describe('checkProfileAuth while the login window is still open (TEST-PRO-02)', () => {
  it('answers PROFILE_IN_USE with a close-the-window hint instead of a 500', async () => {
    const sbx = createSandbox();
    const { chromium } = await import('playwright');
    const profile = createProfile(sbx.ctx, '유튜브9');
    const dir = sbx.ctx.db.prepare('SELECT user_data_dir FROM browser_profiles WHERE profile_id = ?').get(profile.id) as { user_data_dir: string };
    const holder = await chromium.launchPersistentContext(dir.user_data_dir, { headless: true, channel: 'chrome' });
    try {
      await expect(checkProfileAuth(sbx.ctx, profile.id)).rejects.toMatchObject({ code: 'PROFILE_IN_USE', status: 409, message: expect.stringMatching(/창을 닫/) });
    } finally {
      await holder.close();
      await sbx.dispose();
    }
  }, 60_000);
});
