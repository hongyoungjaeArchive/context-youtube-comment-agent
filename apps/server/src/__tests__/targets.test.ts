import { describe, expect, it } from 'vitest';
import type { YouTubeClient } from '../clients/youtube.ts';
import { createSandbox } from '../eval/sandbox.ts';
import { AppError } from '../lib/errors.ts';
import { registerTarget } from '../execution/targets.ts';

const OWN_CHANNEL = 'UCownTestChannel0000000a';
const ALLOWLISTED_CHANNEL = 'UCxlc0Ky0aWoD8uI09ad44Tg';

/** 영상 ID → 채널 ID만 돌려주는 LIVE 스텁 (실제 YouTube 호출 없음). */
function liveYouTube(channelByVideo: Record<string, string>): YouTubeClient {
  return {
    mode: 'LIVE',
    getVideos: async (ids: readonly string[]) =>
      ids.filter((id) => channelByVideo[id]).map((id) => ({ videoId: id, channelId: channelByVideo[id]!, channelName: '내 채널', title: `테스트 ${id}`, description: '', thumbnailUrl: null, publishedAt: '2026-10-21T00:00:00Z', viewCount: 0, commentCount: 0 })),
  } as unknown as YouTubeClient;
}

function sandboxWith(channelByVideo: Record<string, string>) {
  const sbx = createSandbox();
  return { sbx, ctx: { ...sbx.ctx, getYouTube: async () => liveYouTube(channelByVideo) } };
}

const codeOf = async (p: Promise<unknown>) => p.then(() => 'OK', (e: unknown) => (e instanceof AppError ? e.code : String(e)));

describe('registerTarget — 첫 등록으로 본인 채널 확정 (사용성)', () => {
  it('sets the owner channel from the first attested own video and verifies it', async () => {
    const { sbx, ctx } = sandboxWith({ ownVideo001: OWN_CHANNEL });
    const t = await registerTarget(ctx, { url: 'https://youtu.be/ownVideo001', attestOwnership: true });
    expect(t.ownershipState).toBe('VERIFIED');
    expect(sbx.ctx.settings.get().ownerChannelId).toBe(OWN_CHANNEL);
  });

  it('never adopts a designated (third-party) channel as the owner channel', async () => {
    const { sbx, ctx } = sandboxWith({ 'akn-AvCeHBI': ALLOWLISTED_CHANNEL });
    expect(await codeOf(registerTarget(ctx, { url: 'https://youtu.be/akn-AvCeHBI', attestOwnership: true }))).toBe('NOT_OWN_VIDEO');
    expect(sbx.ctx.settings.get().ownerChannelId ?? null).toBeNull();
  });

  it('requires the ownership attestation before adopting an owner channel', async () => {
    const { sbx, ctx } = sandboxWith({ ownVideo001: OWN_CHANNEL });
    expect(await codeOf(registerTarget(ctx, { url: 'https://youtu.be/ownVideo001', attestOwnership: false }))).toBe('ATTESTATION_REQUIRED');
    expect(sbx.ctx.settings.get().ownerChannelId ?? null).toBeNull();
  });

  it('rejects a video from another channel once the owner channel is set', async () => {
    const { ctx } = sandboxWith({ ownVideo001: OWN_CHANNEL, otherVid001: 'UCsomeoneElse00000000000' });
    await registerTarget(ctx, { url: 'https://youtu.be/ownVideo001', attestOwnership: true });
    expect(await codeOf(registerTarget(ctx, { url: 'https://youtu.be/otherVid001', attestOwnership: true }))).toBe('NOT_OWN_VIDEO');
  });
});
