import { describe, expect, it } from 'vitest';
import { hasSeenGreeting, markGreetingSeen } from './greetingFlag.ts';

/** TEST-UX-02: 브라우저 저장소가 막힌 환경에서도 Sage 첫 인사가 앱을 멈추지 않는다. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

const throwing: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('Sage greeting flag', () => {
  it('reports not seen when storage read throws', () => {
    expect(hasSeenGreeting(throwing)).toBe(false);
  });

  it('does not throw when storage write throws', () => {
    expect(() => markGreetingSeen(throwing)).not.toThrow();
  });

  it('remembers the greeting once marked', () => {
    const storage = memoryStorage();
    expect(hasSeenGreeting(storage)).toBe(false);
    markGreetingSeen(storage);
    expect(hasSeenGreeting(storage)).toBe(true);
  });
});
