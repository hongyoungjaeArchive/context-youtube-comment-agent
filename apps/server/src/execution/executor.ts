import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { checkCommentStatic, type ExecutionDTO, type ExecutionEventDTO, type ExecutionStatus, type PostingClaimStatus } from '@context/shared';
import type { AppContext } from '../context.ts';
import { AppError, notFound, policyBlocked } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { localDate } from '../lib/time.ts';
import { getRevisionRow } from '../services/analysis.ts';
import { approvalRow, assertApprovable } from './approvals.ts';
import type { DriverStep, PostingDriver } from './driver.ts';
import { profileRow, setProfileStatus } from './profiles.ts';
import { isPostableUrl, targetRow } from './targets.ts';

const SCREENSHOT_RETENTION_DAYS = 30;
/** 재예약 가능한 claim 상태: 제출 전 실패 또는 사람이 미게시를 확인한 경우만 (사람의 명시적 재실행). */
const RECLAIMABLE: readonly PostingClaimStatus[] = ['PRE_SUBMIT_FAILED', 'FAILED_VERIFIED_NOT_POSTED'];

interface ExecutionRow {
  execution_id: string;
  approval_id: string;
  target_video_id: string;
  source_video_id: string;
  profile_id: string;
  claim_id: string;
  request_id: string;
  status: ExecutionStatus;
  mode: 'REAL_CHROME' | 'FIXTURE';
  revision_hash: string;
  content: string;
  created_at: string;
  submitted_at: string | null;
  verified_at: string | null;
  error_code: string | null;
  error_message: string | null;
  human_resolution: string | null;
}

export interface StartExecutionInput {
  readonly approvalId: string;
  readonly profileId: string;
  readonly confirm: boolean;
  readonly requestId: string;
}

export class Executor {
  private readonly running = new Map<string, Promise<void>>();

  private readonly ctx: AppContext;
  private readonly driver: PostingDriver;
  constructor(ctx: AppContext, driver: PostingDriver) {
    this.ctx = ctx;
    this.driver = driver;
  }

  /**
   * Preflight Gate (docs/10 §4) — 서버·DB에서 강제. claim 생성·하루 한도 예약·승인 버전 확인을 한 트랜잭션으로.
   * 같은 requestId 재요청은 기존 실행을 돌려준다 (새로고침 중복 실행 방지).
   */
  start(input: StartExecutionInput): ExecutionDTO {
    const ctx = this.ctx;
    if (!input.confirm) throw policyBlocked('CONFIRMATION_REQUIRED', '테스트 실행에는 운영자의 명시적 확인이 필요합니다.');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.requestId)) throw new AppError('INVALID_REQUEST_ID', 'requestId 형식이 올바르지 않습니다.');
    const existing = ctx.db.prepare('SELECT execution_id FROM execution_jobs WHERE request_id = ?').get(input.requestId) as { execution_id: string } | undefined;
    if (existing) return this.get(existing.execution_id);

    const preflight = ctx.db.transaction(() => {
      const approval = approvalRow(ctx, input.approvalId);
      const block = (code: string, message: string): never => {
        throw policyBlocked(code, message);
      };
      if (approval.invalidated_at) block('APPROVAL_INVALID', `승인이 무효화되었습니다: ${approval.invalid_reason ?? ''}`);
      // 승인 시점의 결속 조건을 현재 상태와 다시 대조 (바꿔치기 방지).
      try {
        const bound = assertApprovable(ctx, approval.revision_id, approval.review_id);
        if (bound.contentHash !== approval.content_hash) block('HASH_MISMATCH', '승인된 문장 해시와 현재 문장이 다릅니다.');
        if (bound.evidenceHash !== approval.evidence_snapshot_hash) block('EVIDENCE_CHANGED', '승인 이후 근거가 바뀌었습니다.');
      } catch (e) {
        if (e instanceof AppError) block(e.code, e.message);
        throw e;
      }
      const revision = getRevisionRow(ctx, approval.revision_id);
      if (!checkCommentStatic(revision.content).ok) block('STATIC_RULES', '댓글 규칙 위반');
      if (input.profileId !== approval.profile_id) block('PROFILE_MISMATCH', '승인된 프로필과 다른 프로필로 실행할 수 없습니다. 다시 승인해 주세요.');
      const profile = profileRow(ctx, input.profileId);
      if (profile.status === 'LOCKED' || this.isProfileBusy(input.profileId)) block('PROFILE_LOCKED', '이 프로필은 다른 실행에서 사용 중입니다.');
      const target = targetRow(ctx, approval.test_target_id);
      if (!target.ownership_verified_at) block('TARGET_NOT_VERIFIED', '본인 소유가 확인되지 않은 영상에는 게시할 수 없습니다.');
      if (!isPostableUrl(ctx, target.url, target.is_fixture === 1)) block('TARGET_URL_BLOCKED', '허용되지 않은 게시 URL입니다.');

      const now = ctx.clock();
      const nowIso = now.toISOString();
      const claim = ctx.db.prepare('SELECT * FROM posting_claims WHERE video_id = ?').get(target.video_id) as { claim_id: string; status: PostingClaimStatus } | undefined;
      if (claim && !RECLAIMABLE.includes(claim.status)) {
        block('VIDEO_ALREADY_CLAIMED', `이 영상에는 이미 게시 기록(${claim.status})이 있습니다. 영상당 1개만 허용되며 자동 재게시하지 않습니다.`);
      }
      const day = localDate(now);
      const limit = ctx.settings.get().dailyMaxComments;
      ctx.db.prepare('INSERT OR IGNORE INTO daily_usage (local_date) VALUES (?)').run(day);
      const reservedRes = ctx.db
        .prepare('UPDATE daily_usage SET submit_attempts_reserved = submit_attempts_reserved + 1 WHERE local_date = ? AND submit_attempts_reserved < ?')
        .run(day, limit);
      if (reservedRes.changes !== 1) block('DAILY_LIMIT', `오늘(${day}, Asia/Seoul) 게시 한도 ${limit}개에 도달했습니다.`);

      const id = newId('exe');
      const claimId = claim?.claim_id ?? newId('clm');
      if (claim) {
        ctx.db.prepare("UPDATE posting_claims SET status = 'RESERVED', execution_id = ?, claimed_at = ?, resolved_at = NULL WHERE claim_id = ?").run(id, nowIso, claimId);
      } else {
        ctx.db.prepare("INSERT INTO posting_claims (claim_id, video_id, execution_id, status, claimed_at) VALUES (?,?,?,'RESERVED',?)").run(claimId, target.video_id, id, nowIso);
      }
      ctx.db
        .prepare(
          `INSERT INTO execution_jobs (execution_id, approval_id, target_video_id, source_video_id, profile_id, claim_id, request_id, status, mode, revision_hash, content, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(id, approval.approval_id, target.video_id, approval.source_video_id, input.profileId, claimId, input.requestId, 'PREFLIGHT', target.is_fixture ? 'FIXTURE' : 'REAL_CHROME', approval.content_hash, revision.content, nowIso, nowIso);
      setProfileStatus(ctx, input.profileId, 'LOCKED');
      this.event(id, 'PREFLIGHT', 'OK', '승인 해시·근거·소유권·영상당 1개·일일 한도·프로필 잠금 확인 완료');
      ctx.audit.record('execution', id, 'EXECUTION_STARTED', 'OPERATOR', { approvalId: approval.approval_id, targetVideoId: target.video_id, profileId: input.profileId, contentHash: approval.content_hash });
      return id;
    });
    let executionId: string;
    try {
      executionId = preflight();
    } catch (error) {
      // 트랜잭션 롤백 후 별도로 차단 사유를 감사 로그에 남긴다.
      if (error instanceof AppError) ctx.audit.record('execution', input.approvalId, 'PREFLIGHT_BLOCKED', 'SYSTEM', { code: error.code, message: error.message });
      throw error;
    }

    const p = this.run(executionId).finally(() => this.running.delete(executionId));
    this.running.set(executionId, p);
    return this.get(executionId);
  }

  isProfileBusy(profileId: string): boolean {
    const r = this.ctx.db
      .prepare(`SELECT COUNT(*) n FROM execution_jobs WHERE profile_id = ? AND status NOT IN ('SUCCESS','UNKNOWN','FAILED_PRE_SUBMIT','AUTH_REQUIRED','CANCELLED','POLICY_BLOCKED','PROFILE_LOCKED','INTERRUPTED')`)
      .get(profileId) as { n: number };
    return r.n > 0;
  }

  async waitFor(executionId: string): Promise<ExecutionDTO> {
    await this.running.get(executionId);
    return this.get(executionId);
  }

  async waitAll(): Promise<void> {
    await Promise.allSettled([...this.running.values()]);
  }

  private async run(executionId: string): Promise<void> {
    const ctx = this.ctx;
    const row = this.row(executionId);
    const target = ctx.db.prepare('SELECT * FROM test_targets WHERE video_id = ?').get(row.target_video_id) as { url: string; is_fixture: number };
    const profile = profileRow(ctx, row.profile_id);
    try {
      const outcome = await this.driver.run(
        {
          executionId,
          url: target.url,
          content: row.content,
          userDataDir: profile.user_data_dir,
          useRealChrome: row.mode === 'REAL_CHROME' && !ctx.config.headlessBrowser,
          headless: ctx.config.headlessBrowser,
          artifactsDir: ctx.config.paths.artifactsDir,
        },
        {
          step: (step: DriverStep, result, message, screenshotPath) => {
            if (result === 'START') this.setStatus(executionId, step);
            this.event(executionId, step, result, message, screenshotPath ? this.saveArtifact(executionId, screenshotPath) : null);
          },
          beforeSubmit: () => {
            const now = ctx.clock().toISOString();
            ctx.db.transaction(() => {
              ctx.db.prepare("UPDATE execution_jobs SET status='SUBMITTING', submitted_at=?, updated_at=? WHERE execution_id=?").run(now, now, executionId);
              ctx.db.prepare("UPDATE posting_claims SET status='SUBMIT_ATTEMPTED' WHERE claim_id=?").run(row.claim_id);
            })();
          },
        },
      );
      const now = ctx.clock().toISOString();
      if (outcome.status === 'SUCCESS') {
        ctx.db.transaction(() => {
          ctx.db.prepare("UPDATE execution_jobs SET status='SUCCESS', verified_at=?, updated_at=? WHERE execution_id=?").run(now, now, executionId);
          ctx.db.prepare("UPDATE posting_claims SET status='SUCCESS', resolved_at=? WHERE claim_id=?").run(now, row.claim_id);
          ctx.db.prepare('UPDATE daily_usage SET confirmed_count = confirmed_count + 1 WHERE local_date = ?').run(localDate(new Date(row.created_at)));
        })();
        ctx.audit.record('execution', executionId, 'POST_VERIFIED', 'BROWSER', { authorLabel: outcome.authorLabel, mode: row.mode });
      } else {
        const claimStatus: PostingClaimStatus = outcome.status === 'UNKNOWN' ? 'UNKNOWN' : 'PRE_SUBMIT_FAILED';
        ctx.db.transaction(() => {
          ctx.db.prepare('UPDATE execution_jobs SET status=?, error_code=?, error_message=?, updated_at=? WHERE execution_id=?').run(outcome.status, outcome.errorCode, outcome.message, now, executionId);
          ctx.db.prepare('UPDATE posting_claims SET status=?, resolved_at=? WHERE claim_id=?').run(claimStatus, outcome.status === 'UNKNOWN' ? null : now, row.claim_id);
        })();
        if (outcome.status === 'AUTH_REQUIRED') setProfileStatus(ctx, row.profile_id, 'AUTH_REQUIRED', { error: outcome.message });
        ctx.audit.record('execution', executionId, `EXECUTION_${outcome.status}`, 'BROWSER', { code: outcome.errorCode, message: outcome.message });
      }
    } catch (error) {
      this.failUnexpected(executionId, error);
    } finally {
      const current = profileRow(ctx, row.profile_id);
      if (current.status === 'LOCKED') setProfileStatus(ctx, row.profile_id, 'READY', { authCheckedAt: ctx.clock().toISOString() });
    }
  }

  private failUnexpected(executionId: string, error: unknown): void {
    const ctx = this.ctx;
    const row = this.row(executionId);
    const submitted = row.submitted_at !== null;
    const status: ExecutionStatus = submitted ? 'UNKNOWN' : 'FAILED_PRE_SUBMIT';
    const now = ctx.clock().toISOString();
    ctx.db.prepare('UPDATE execution_jobs SET status=?, error_code=?, error_message=?, updated_at=? WHERE execution_id=?').run(status, 'EXECUTOR_ERROR', error instanceof Error ? error.message : String(error), now, executionId);
    ctx.db.prepare('UPDATE posting_claims SET status=? WHERE claim_id=?').run(submitted ? 'UNKNOWN' : 'PRE_SUBMIT_FAILED', row.claim_id);
  }

  /** 서버 재시작 시: 끝나지 않은 실행 복구. 제출 시도 흔적이 있으면 UNKNOWN, 아니면 INTERRUPTED (게시 여부 추측 금지). */
  recover(): number {
    const ctx = this.ctx;
    const rows = ctx.db
      .prepare(`SELECT * FROM execution_jobs WHERE status NOT IN ('SUCCESS','UNKNOWN','FAILED_PRE_SUBMIT','AUTH_REQUIRED','CANCELLED','POLICY_BLOCKED','PROFILE_LOCKED','INTERRUPTED')`)
      .all() as ExecutionRow[];
    const now = ctx.clock().toISOString();
    for (const r of rows) {
      const submitted = r.submitted_at !== null || r.status === 'SUBMITTING' || r.status === 'VERIFYING';
      ctx.db.prepare('UPDATE execution_jobs SET status=?, error_code=?, error_message=?, updated_at=? WHERE execution_id=?').run(
        submitted ? 'UNKNOWN' : 'INTERRUPTED',
        'APP_RESTARTED',
        submitted ? '제출 시도 중 앱이 종료되었습니다. 게시 여부를 직접 확인해 주세요.' : '제출 전에 앱이 종료되었습니다.',
        now,
        r.execution_id,
      );
      ctx.db.prepare('UPDATE posting_claims SET status=? WHERE claim_id=?').run(submitted ? 'UNKNOWN' : 'PRE_SUBMIT_FAILED', r.claim_id);
      this.event(r.execution_id, 'RECOVERY', 'INFO', submitted ? 'UNKNOWN 보류 — 자동 재게시 금지' : 'INTERRUPTED (제출 전)');
    }
    ctx.db.prepare("UPDATE browser_profiles SET status='REGISTERED' WHERE status='LOCKED'").run();
    return rows.length;
  }

  /** UNKNOWN 실행을 사람이 직접 확인한 결과 기록. 확인 없는 SUCCESS 설정 금지 — 운영자 확인으로만 전환. */
  resolve(executionId: string, outcome: 'CONFIRMED_POSTED' | 'CONFIRMED_NOT_POSTED', note: string): ExecutionDTO {
    const ctx = this.ctx;
    const row = this.row(executionId);
    if (row.status !== 'UNKNOWN') throw new AppError('NOT_UNKNOWN', 'UNKNOWN 상태의 실행만 수동 확인할 수 있습니다.', 409);
    if (row.human_resolution) throw new AppError('ALREADY_RESOLVED', '이미 수동 확인이 기록되었습니다.', 409);
    const now = ctx.clock().toISOString();
    const label = `${outcome === 'CONFIRMED_POSTED' ? 'HUMAN_CONFIRMED_POSTED' : 'HUMAN_CONFIRMED_NOT_POSTED'}: ${note.slice(0, 200)}`;
    ctx.db.transaction(() => {
      if (outcome === 'CONFIRMED_POSTED') {
        ctx.db.prepare("UPDATE execution_jobs SET status='SUCCESS', verified_at=?, human_resolution=?, updated_at=? WHERE execution_id=?").run(now, label, now, executionId);
        ctx.db.prepare("UPDATE posting_claims SET status='SUCCESS', resolved_at=? WHERE claim_id=?").run(now, row.claim_id);
        ctx.db.prepare('UPDATE daily_usage SET confirmed_count = confirmed_count + 1 WHERE local_date = ?').run(localDate(new Date(row.created_at)));
      } else {
        ctx.db.prepare('UPDATE execution_jobs SET human_resolution=?, updated_at=? WHERE execution_id=?').run(label, now, executionId);
        ctx.db.prepare("UPDATE posting_claims SET status='FAILED_VERIFIED_NOT_POSTED', resolved_at=? WHERE claim_id=?").run(now, row.claim_id);
      }
    })();
    this.event(executionId, 'HUMAN_RESOLUTION', 'INFO', label);
    ctx.audit.record('execution', executionId, 'HUMAN_RESOLVED', 'OPERATOR', { outcome });
    return this.get(executionId);
  }

  private setStatus(executionId: string, status: ExecutionStatus): void {
    this.ctx.db.prepare('UPDATE execution_jobs SET status=?, updated_at=? WHERE execution_id=?').run(status, this.ctx.clock().toISOString(), executionId);
  }

  private event(executionId: string, step: string, result: string, message: string, diagnosticRef: string | null = null): void {
    this.ctx.db
      .prepare('INSERT INTO execution_events (event_id, execution_id, step, result, message, diagnostic_ref, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(newId('evt'), executionId, step, result, message, diagnosticRef, this.ctx.clock().toISOString());
  }

  private saveArtifact(executionId: string, file: string): string | null {
    try {
      const sha = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      const id = newId('art');
      const now = this.ctx.clock();
      this.ctx.db
        .prepare('INSERT INTO artifacts (artifact_id, execution_id, kind, path, sha256, retention_deadline, created_at) VALUES (?,?,?,?,?,?,?)')
        .run(id, executionId, 'screenshot', file, sha, new Date(now.getTime() + SCREENSHOT_RETENTION_DAYS * 86400_000).toISOString(), now.toISOString());
      return id;
    } catch {
      return null;
    }
  }

  private row(id: string): ExecutionRow {
    const r = this.ctx.db.prepare('SELECT * FROM execution_jobs WHERE execution_id = ?').get(id) as ExecutionRow | undefined;
    if (!r) throw notFound('실행');
    return r;
  }

  get(id: string): ExecutionDTO {
    const r = this.row(id);
    const events = this.ctx.db.prepare('SELECT * FROM execution_events WHERE execution_id = ? ORDER BY created_at, rowid').all(id) as {
      step: string;
      result: ExecutionEventDTO['result'];
      message: string;
      diagnostic_ref: string | null;
      created_at: string;
    }[];
    const profile = this.ctx.db.prepare('SELECT alias FROM browser_profiles WHERE profile_id = ?').get(r.profile_id) as { alias: string } | undefined;
    const target = this.ctx.db.prepare('SELECT title, url FROM test_targets WHERE video_id = ?').get(r.target_video_id) as { title: string | null; url: string } | undefined;
    const titleOf = (videoId: string) => (this.ctx.db.prepare('SELECT title FROM videos WHERE video_id = ?').get(videoId) as { title: string } | undefined)?.title ?? null;
    return {
      id: r.execution_id,
      approvalId: r.approval_id,
      targetVideoId: r.target_video_id,
      targetTitle: target?.title ?? titleOf(r.target_video_id),
      targetUrl: target?.url ?? `https://www.youtube.com/watch?v=${r.target_video_id}`,
      sourceVideoId: r.source_video_id,
      sourceTitle: titleOf(r.source_video_id),
      profileId: r.profile_id,
      profileAlias: profile?.alias ?? '(삭제됨)',
      status: r.status,
      mode: r.mode,
      revisionHash: r.revision_hash,
      content: r.content,
      createdAt: r.created_at,
      submittedAt: r.submitted_at,
      verifiedAt: r.verified_at,
      errorCode: r.error_code,
      errorMessage: r.error_message,
      humanResolution: r.human_resolution,
      events: events.map((e) => ({ step: e.step, result: e.result, message: e.message, at: e.created_at, screenshotRef: e.diagnostic_ref })),
    };
  }

  list(limit = 100): ExecutionDTO[] {
    const ids = this.ctx.db.prepare('SELECT execution_id FROM execution_jobs ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as { execution_id: string }[];
    return ids.map((r) => this.get(r.execution_id));
  }

  artifactPath(artifactId: string): string {
    const r = this.ctx.db.prepare('SELECT path FROM artifacts WHERE artifact_id = ?').get(artifactId) as { path: string } | undefined;
    if (!r) throw notFound('증거 파일');
    return r.path;
  }
}
