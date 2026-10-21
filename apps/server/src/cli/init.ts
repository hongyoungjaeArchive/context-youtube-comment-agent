/** Setup 1회 초기화: 데이터 폴더(0700)·SQLite 마이그레이션·기본 프로필 생성. 비밀값은 다루지 않는다. */
import { buildPaths, resolveDataDir } from '../config.ts';
import { ensurePrivateDir, openDatabase } from '../db/database.ts';

const paths = buildPaths(resolveDataDir());
for (const dir of [paths.dataDir, paths.artifactsDir, paths.profilesDir, paths.logsDir, paths.runDir, paths.backupsDir]) ensurePrivateDir(dir);
const db = openDatabase(paths.dbFile);
const version = db.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number };
db.close();
process.stdout.write(`데이터 폴더: ${paths.dataDir}\nSQLite 스키마 버전: ${version.v}\n`);
