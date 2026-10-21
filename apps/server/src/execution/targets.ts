import { ALLOWED_CHANNEL_IDS, isValidChannelId, parseVideoId, canonicalWatchUrl, type TestTargetDTO, type PostingClaimStatus } from '@context/shared';
import type { AppContext } from '../context.ts';
import { AppError, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';

export interface TargetRow {
  target_id: string;
  video_id: string;
  url: string;
  title: string | null;
  owner_channel_id: string | null;
  ownership_verified_at: string | null;
  verification_method: string | null;
  is_fixture: number;
}

const FIXTURE_ID_PATTERN = /^FIXTURE[A-Z0-9]{4}$/;

export function fixtureUrl(ctx: AppContext, videoId: string, mode = ''): string {
  return `http://127.0.0.1:${ctx.config.port}/__fixture/watch?v=${videoId}${mode ? `&mode=${encodeURIComponent(mode)}` : ''}`;
}

export function toTargetDTO(ctx: AppContext, r: TargetRow): TestTargetDTO {
  const claim = ctx.db.prepare('SELECT status FROM posting_claims WHERE video_id = ?').get(r.video_id) as { status: PostingClaimStatus } | undefined;
  return {
    id: r.target_id,
    videoId: r.video_id,
    url: r.url,
    title: r.title,
    ownerChannelId: r.owner_channel_id,
    ownershipState: r.ownership_verified_at ? 'VERIFIED' : 'UNVERIFIED',
    verificationMethod: r.verification_method,
    isFixture: r.is_fixture === 1,
    claimStatus: claim?.status ?? null,
  };
}

export function listTargets(ctx: AppContext): TestTargetDTO[] {
  return (ctx.db.prepare('SELECT * FROM test_targets ORDER BY created_at DESC, rowid DESC').all() as TargetRow[]).map((r) => toTargetDTO(ctx, r));
}

export function targetRow(ctx: AppContext, id: string): TargetRow {
  const r = ctx.db.prepare('SELECT * FROM test_targets WHERE target_id = ?').get(id) as TargetRow | undefined;
  if (!r) throw notFound('테스트 영상');
  return r;
}

/**
 * 본인 채널이 아직 없을 때, 운영자가 소유를 서약한 첫 테스트 영상의 채널을 본인 채널로 확정한다.
 * 지정(제3자) 채널은 절대 본인 채널로 받아들이지 않는다.
 */
function adoptOwnerChannel(ctx: AppContext, videoId: string, channelId: string | null, attested: boolean): string {
  if (!attested) throw new AppError('ATTESTATION_REQUIRED', '본인 소유 영상인지 확인(체크)해 주세요.', 400);
  if (!channelId || !isValidChannelId(channelId) || ALLOWED_CHANNEL_IDS.has(channelId)) {
    ctx.audit.record('test_target', videoId, 'TARGET_REJECTED', 'SYSTEM', { reason: 'NOT_OWN_CHANNEL', channelId });
    throw new AppError('NOT_OWN_VIDEO', '지정 채널 영상은 본인 테스트 영상으로 등록할 수 없습니다. 본인 채널에 올린 영상을 넣어 주세요.', 403);
  }
  ctx.settings.update({ ownerChannelId: channelId });
  ctx.audit.record('settings', 'ownerChannelId', 'OWNER_CHANNEL_SET', 'OPERATOR', { channelId, fromVideoId: videoId });
  return channelId;
}

/**
 * 본인 소유 테스트 영상 등록 (REQ-EXE-003).
 * 실영상: 본인 Channel ID(없으면 첫 서약 영상의 채널로 확정)와 YouTube API의 영상 채널이 일치 + 운영자 소유 확인 서약이 모두 있어야 VERIFIED.
 * 픽스처: 픽스처 모드에서만 허용, 로컬 가짜 페이지.
 */
export async function registerTarget(ctx: AppContext, input: { url: string; attestOwnership: boolean; fixture?: { videoId: string; mode?: string } }): Promise<TestTargetDTO> {
  const now = ctx.clock().toISOString();
  if (input.fixture) {
    if (!ctx.config.fixtureMode) throw new AppError('FIXTURE_DISABLED', '픽스처 모드에서만 로컬 테스트 대상을 등록할 수 있습니다.', 403);
    if (!FIXTURE_ID_PATTERN.test(input.fixture.videoId)) throw new AppError('INVALID_FIXTURE_ID', '픽스처 ID는 FIXTURE + 대문자/숫자 4자리입니다.');
    const id = newId('tgt');
    ctx.db
      .prepare('INSERT INTO test_targets (target_id, video_id, url, title, owner_channel_id, ownership_verified_at, verification_method, is_fixture, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, input.fixture.videoId, fixtureUrl(ctx, input.fixture.videoId, input.fixture.mode), '[로컬 픽스처] 가짜 YouTube 댓글 페이지', null, now, 'FIXTURE_LOCAL', 1, now);
    ctx.audit.record('test_target', id, 'TARGET_REGISTERED', 'OPERATOR', { videoId: input.fixture.videoId, fixture: true });
    return toTargetDTO(ctx, targetRow(ctx, id));
  }
  const videoId = parseVideoId(input.url);
  if (!videoId) throw new AppError('INVALID_URL', 'YouTube 영상 URL이 아닙니다.');
  const savedOwner = ctx.settings.get().ownerChannelId;
  const yt = await ctx.getYouTube();
  if (yt.mode !== 'LIVE' && (!savedOwner || !isValidChannelId(savedOwner))) {
    throw new AppError('OWNER_CHANNEL_REQUIRED', '설정에서 본인 YouTube Channel ID를 먼저 등록해 주세요.', 409);
  }
  let channelId: string | null = null;
  let title: string | null = null;
  if (yt.mode === 'LIVE') {
    const meta = (await yt.getVideos([videoId]))[0];
    if (!meta) throw new AppError('VIDEO_NOT_FOUND', '영상을 찾을 수 없거나 비공개입니다 (일부 공개로 설정해 주세요).', 404);
    channelId = meta.channelId;
    title = meta.title;
  }
  const owner = savedOwner && isValidChannelId(savedOwner) ? savedOwner : adoptOwnerChannel(ctx, videoId, channelId, input.attestOwnership);
  const verified = yt.mode === 'LIVE' && channelId === owner && input.attestOwnership;
  if (yt.mode === 'LIVE' && channelId !== owner) {
    ctx.audit.record('test_target', videoId, 'TARGET_REJECTED', 'SYSTEM', { reason: 'CHANNEL_MISMATCH', channelId });
    throw new AppError('NOT_OWN_VIDEO', '이 영상의 채널이 등록된 본인 채널과 다릅니다. 본인 소유 테스트 영상만 등록할 수 있습니다.', 403);
  }
  const id = newId('tgt');
  try {
    ctx.db
      .prepare('INSERT INTO test_targets (target_id, video_id, url, title, owner_channel_id, ownership_verified_at, verification_method, is_fixture, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, videoId, canonicalWatchUrl(videoId), title, channelId, verified ? now : null, verified ? 'API_CHANNEL_MATCH+OPERATOR_ATTESTATION' : null, 0, now);
  } catch {
    throw new AppError('DUPLICATE_TARGET', '이미 등록된 테스트 영상입니다.', 409);
  }
  ctx.audit.record('test_target', id, 'TARGET_REGISTERED', 'OPERATOR', { videoId, verified, channelId });
  return toTargetDTO(ctx, targetRow(ctx, id));
}

/** 게시 가능한 URL인지: youtube.com watch URL 또는 (픽스처 모드일 때만) 로컬 픽스처. */
export function isPostableUrl(ctx: AppContext, url: string, isFixture: boolean): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (isFixture) return ctx.config.fixtureMode && u.hostname === '127.0.0.1' && u.port === String(ctx.config.port) && u.pathname === '/__fixture/watch';
  return u.protocol === 'https:' && u.hostname === 'www.youtube.com' && u.pathname === '/watch' && parseVideoId(url) !== null;
}
