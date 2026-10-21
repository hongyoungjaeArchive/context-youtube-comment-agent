const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

export function isValidVideoId(id: string): boolean {
  return VIDEO_ID_PATTERN.test(id);
}

export function isValidChannelId(id: string): boolean {
  return CHANNEL_ID_PATTERN.test(id);
}

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);

/** YouTube URL 또는 11자리 ID를 정규화된 Video ID로 변환. 실패하면 null. */
export function parseVideoId(input: string): string | null {
  const raw = input.trim();
  if (isValidVideoId(raw)) return raw;
  let url: URL;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase();
  let candidate: string | null = null;
  if (host === 'youtu.be') {
    candidate = url.pathname.split('/')[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (url.pathname === '/watch') candidate = url.searchParams.get('v');
    else {
      const m = url.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
      candidate = m?.[2] ?? null;
    }
  }
  return candidate && isValidVideoId(candidate) ? candidate : null;
}

export function canonicalWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
