import fs from 'node:fs';
import path from 'node:path';
import { OPERATION_LIMITS, type ProfileDTO, type ProfileStatus } from '@context/shared';
import type { AppContext } from '../context.ts';
import { ensurePrivateDir } from '../db/database.ts';
import { AppError, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';

export interface ProfileRow {
  profile_id: string;
  alias: string;
  user_data_dir: string;
  status: ProfileStatus;
  account_label: string | null;
  last_auth_check: string | null;
  last_error: string | null;
}

const ALIAS_PATTERN = /^[\p{L}\p{N} _-]{1,20}$/u;

export function toProfileDTO(r: ProfileRow): ProfileDTO {
  return { id: r.profile_id, alias: r.alias, status: r.status, accountLabel: r.account_label, lastAuthCheck: r.last_auth_check, lastError: r.last_error };
}

export function listProfiles(ctx: AppContext): ProfileDTO[] {
  return (ctx.db.prepare('SELECT * FROM browser_profiles ORDER BY created_at, rowid').all() as ProfileRow[]).map(toProfileDTO);
}

export function profileRow(ctx: AppContext, id: string): ProfileRow {
  const r = ctx.db.prepare('SELECT * FROM browser_profiles WHERE profile_id = ?').get(id) as ProfileRow | undefined;
  if (!r) throw notFound('브라우저 프로필');
  return r;
}

/** 최대 3개 전용 테스트 프로필 등록 (REQ-PRO-001). 기본 Chrome User Data 폴더는 절대 쓰지 않는다. */
export function createProfile(ctx: AppContext, alias: string): ProfileDTO {
  if (!ALIAS_PATTERN.test(alias)) throw new AppError('INVALID_ALIAS', '프로필 이름은 1~20자의 글자·숫자로 입력해 주세요.');
  const count = (ctx.db.prepare('SELECT COUNT(*) n FROM browser_profiles').get() as { n: number }).n;
  if (count >= OPERATION_LIMITS.maxProfiles) throw new AppError('PROFILE_LIMIT', `프로필은 최대 ${OPERATION_LIMITS.maxProfiles}개까지 등록할 수 있습니다.`, 409);
  const id = newId('prof');
  const dir = path.join(ctx.config.paths.profilesDir, id);
  ensurePrivateDir(ctx.config.paths.profilesDir);
  ensurePrivateDir(dir);
  try {
    ctx.db
      .prepare('INSERT INTO browser_profiles (profile_id, alias, user_data_dir, status, created_at) VALUES (?,?,?,?,?)')
      .run(id, alias, dir, 'REGISTERED', ctx.clock().toISOString());
  } catch {
    throw new AppError('DUPLICATE_ALIAS', '이미 같은 이름의 프로필이 있습니다.', 409);
  }
  ctx.audit.record('profile', id, 'PROFILE_CREATED', 'OPERATOR', { alias });
  return toProfileDTO(profileRow(ctx, id));
}

export function ensureDefaultProfile(ctx: AppContext): void {
  const count = (ctx.db.prepare('SELECT COUNT(*) n FROM browser_profiles').get() as { n: number }).n;
  if (count === 0) createProfile(ctx, '유튜브1');
}

export function setProfileStatus(ctx: AppContext, id: string, status: ProfileStatus, patch: { error?: string | null; authCheckedAt?: string | null } = {}): void {
  ctx.db
    .prepare('UPDATE browser_profiles SET status = ?, last_error = COALESCE(?, last_error), last_auth_check = COALESCE(?, last_auth_check) WHERE profile_id = ?')
    .run(status, patch.error ?? null, patch.authCheckedAt ?? null, id);
}

export function deleteProfile(ctx: AppContext, id: string): void {
  const r = profileRow(ctx, id);
  if (r.status === 'LOCKED') throw new AppError('PROFILE_LOCKED', '실행 중인 프로필은 삭제할 수 없습니다.', 409);
  const used = ctx.db.prepare('SELECT COUNT(*) n FROM approvals WHERE profile_id = ?').get(id) as { n: number };
  if (used.n > 0) throw new AppError('PROFILE_IN_HISTORY', '승인·실행 이력이 있는 프로필은 기록 보존을 위해 삭제할 수 없습니다.', 409);
  ctx.db.prepare('DELETE FROM browser_profiles WHERE profile_id = ?').run(id);
  const root = path.resolve(ctx.config.paths.profilesDir);
  const dir = path.resolve(r.user_data_dir);
  if (dir.startsWith(root + path.sep)) fs.rmSync(dir, { recursive: true, force: true });
  ctx.audit.record('profile', id, 'PROFILE_DELETED', 'OPERATOR', { alias: r.alias });
}
