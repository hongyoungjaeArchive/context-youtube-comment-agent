import { describe, expect, it } from 'vitest';
import { KeychainSecretStore, MemorySecretStore } from '../security/secretStore.ts';
import { redactString, redactValue } from '../security/redact.ts';

describe('SecretStore (TEST-SEC-01)', () => {
  it('memory store set/get/has/remove', async () => {
    const s = new MemorySecretStore();
    expect(await s.has('anthropic')).toBe(false);
    await s.set('anthropic', 'dummy-value-for-test');
    expect(await s.get('anthropic')).toBe('dummy-value-for-test');
    await s.remove('anthropic');
    expect(await s.get('anthropic')).toBeNull();
  });

  it.runIf(process.platform === 'darwin')('macOS Keychain round-trip on an isolated test service', async () => {
    const store = new KeychainSecretStore('context-marketing-agent-vitest');
    const dummy = `dummy "quoted" \\ value ${Date.now()}`;
    try {
      await store.set('youtube', dummy);
      expect(await store.has('youtube')).toBe(true);
      expect(await store.get('youtube')).toBe(dummy);
    } finally {
      await store.remove('youtube');
    }
    expect(await store.has('youtube')).toBe(false);
  });

  it('rejects secrets with newlines (command injection guard)', async () => {
    const store = new KeychainSecretStore('context-marketing-agent-vitest');
    await expect(store.set('youtube', 'a\nadd-generic-password -s x')).rejects.toThrow();
  });
});

describe('redaction (TEST-SEC-02)', () => {
  it('masks key-shaped strings and sensitive fields', () => {
    const fakeAnthropic = ['sk', 'ant', 'api03', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const fakeGoogle = `AIza${'x'.repeat(35)}`;
    expect(redactString(`key=${fakeAnthropic} and ${fakeGoogle}`)).toBe('key=[REDACTED] and [REDACTED]');
    expect(redactValue({ apiKey: 'plain', nested: { secret: 'x', ok: 'fine' } })).toEqual({ apiKey: '[REDACTED]', nested: { secret: '[REDACTED]', ok: 'fine' } });
  });
});
