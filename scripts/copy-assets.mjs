// 서버 빌드 후 HTML 픽스처를 dist로 복사한다 (tsc는 비-TS 파일을 복사하지 않음).
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'apps/server/src/fixtures');
const dst = path.join(root, 'apps/server/dist/fixtures');
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log('fixtures copied');
