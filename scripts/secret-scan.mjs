// Git 추적 파일·빌드 산출물에서 실제 키 형태의 문자열을 찾는다 (TEST-SEC-02). 값은 출력하지 않고 위치만 보고.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const PATTERNS = [
  { name: 'anthropic-key', re: /sk-ant-[a-z0-9]{2,8}-[A-Za-z0-9_-]{20,}/ },
  { name: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'private-key', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];
const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const extra = [];
for (const dir of ['apps/web/dist', 'apps/server/dist', 'packages/shared/dist']) {
  const abs = path.join(root, dir);
  if (!fs.existsSync(abs)) continue;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : extra.push(path.relative(root, path.join(d, e.name)))));
  walk(abs);
}
let findings = 0;
for (const rel of [...tracked, ...extra]) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs) || fs.statSync(abs).size > 5_000_000) continue;
  const text = fs.readFileSync(abs, 'utf8');
  for (const p of PATTERNS) {
    if (p.re.test(text)) {
      findings++;
      console.error(`[secret-scan] ${p.name} 의심 문자열: ${rel}`);
    }
  }
}
console.log(`[secret-scan] 검사 파일 ${tracked.length + extra.length}개, 발견 ${findings}건`);
process.exit(findings ? 1 : 0);
