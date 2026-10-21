import { describe, expect, it } from 'vitest';
import { REAL_CHROME_IGNORED_DEFAULT_ARGS, buildLoginChromeArgs } from '../execution/chromeLaunch.ts';

describe('chromeLaunch', () => {
  it('opens the login window as plain Chrome on the dedicated profile without automation flags', () => {
    const args = buildLoginChromeArgs('/tmp/profile-a', 'https://www.youtube.com/');
    expect(args).toContain('--user-data-dir=/tmp/profile-a');
    expect(args).toContain('--no-first-run');
    expect(args[args.length - 1]).toBe('https://www.youtube.com/');
    expect(args.some((a) => a.includes('enable-automation') || a.includes('remote-debugging'))).toBe(false);
  });

  it('only drops the keychain-related defaults so the real-Chrome session cookies stay readable', () => {
    expect(REAL_CHROME_IGNORED_DEFAULT_ARGS).toEqual(['--use-mock-keychain', '--password-store=basic']);
    expect(REAL_CHROME_IGNORED_DEFAULT_ARGS).not.toContain('--enable-automation');
  });
});
