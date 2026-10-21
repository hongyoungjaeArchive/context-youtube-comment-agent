import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSandbox, type Sandbox } from '../eval/sandbox.ts';
import { applyRetention } from '../services/retention.ts';

let sbx: Sandbox | null = null;
afterEach(async () => {
  await sbx?.dispose();
  sbx = null;
});

describe('retention (docs/08 §5)', () => {
  it('deletes expired screenshots inside artifacts dir and old usage rows only', () => {
    sbx = createSandbox();
    const dir = sbx.ctx.config.paths.artifactsDir;
    fs.mkdirSync(dir, { recursive: true });
    const oldFile = path.join(dir, 'old.png');
    const newFile = path.join(dir, 'new.png');
    fs.writeFileSync(oldFile, 'x');
    fs.writeFileSync(newFile, 'y');
    const ins = sbx.ctx.db.prepare('INSERT INTO artifacts (artifact_id, execution_id, kind, path, sha256, retention_deadline, created_at) VALUES (?,NULL,?,?,?,?,?)');
    ins.run('a1', 'screenshot', oldFile, 'h', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z');
    ins.run('a2', 'screenshot', newFile, 'h', '2999-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    sbx.ctx.db.prepare("INSERT INTO ai_usage (usage_id, model_id, ai_mode, local_date, created_at) VALUES ('u1','m','MOCK','2000-01-01','2000-01-01T00:00:00Z')").run();
    const r = applyRetention(sbx.ctx);
    expect(r).toEqual({ usageDeleted: 1, artifactsDeleted: 1 });
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(newFile)).toBe(true);
  });
});
