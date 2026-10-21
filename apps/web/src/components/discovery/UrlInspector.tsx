import { useState, type FormEvent } from 'react';
import { Link2 } from 'lucide-react';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import type { InspectResult } from '../../api/types.ts';
import { Button, Notice } from '../ui/primitives.tsx';
import { ServerError, inputClass } from '../ui/overlay.tsx';

interface Props {
  readonly onFound: (videoId: string) => void;
}

const SCOPE_TONE = {
  ALLOWED_CHANNEL: 'success',
  OWN_TEST_CHANNEL: 'accent',
  NOT_ALLOWED: 'danger',
  INVALID_URL: 'danger',
  NOT_FOUND: 'warning',
} as const;

export function UrlInspector({ onFound }: Props) {
  const [url, setUrl] = useState('');
  const inspect = useApiMutation((u: string) => api.post<InspectResult>('/api/videos/inspect-url', { url: u }), {
    invalidate: [['videos']],
    onSuccess: (res) => {
      if (res.video) onFound(res.video.videoId);
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (trimmed.length < 5) return;
    inspect.mutate(trimmed);
  };

  const result = inspect.data;
  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="flex gap-1.5">
        <label htmlFor="url-input" className="sr-only">
          YouTube 영상 URL 직접 입력
        </label>
        <div className="relative flex-1">
          <Link2 size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            id="url-input"
            data-testid="url-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="YouTube URL 또는 Video ID"
            maxLength={300}
            className={`${inputClass} pl-8`}
          />
        </div>
        <Button type="submit" data-testid="url-inspect" loading={inspect.isPending} disabled={url.trim().length < 5}>
          확인
        </Button>
      </form>
      <ServerError error={inspect.error} />
      {result ? (
        <Notice tone={SCOPE_TONE[result.scope]} testId="url-inspect-result">
          <span className="mr-1 font-mono text-[11px] font-semibold">{result.scope}</span>
          {result.message}
          {result.scope === 'NOT_ALLOWED' ? <span className="block font-semibold">이 영상은 분석·게시가 차단됩니다.</span> : null}
        </Notice>
      ) : null}
    </div>
  );
}
