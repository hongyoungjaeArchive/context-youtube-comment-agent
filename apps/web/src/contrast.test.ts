import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** TEST-UX-02: 밝은 배경에서 보조 글자색(--color-muted, 4.9:1)을 투명하게 낮추면 4.5:1 아래로 떨어진다. */
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return e.name.endsWith('.tsx') ? [full] : [];
  });
}

describe('light theme text contrast', () => {
  it('never fades the muted text color with opacity', () => {
    const offenders = sourceFiles(path.join(import.meta.dirname, 'components')).flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(/text-muted\/\d+/g)].map((m) => `${path.basename(file)}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });
});
