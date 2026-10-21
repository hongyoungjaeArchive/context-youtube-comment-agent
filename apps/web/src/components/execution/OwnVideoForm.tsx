import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import type { TestTargetDTO } from '@context/shared';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { qk } from '../../api/queries.ts';
import { Button } from '../ui/primitives.tsx';
import { Field, ServerError, inputClass } from '../ui/overlay.tsx';

interface Props {
  /** 등록에 성공하면 새 테스트 영상 ID를 알려 준다 (③에서 바로 선택). */
  readonly onRegistered?: (target: TestTargetDTO) => void;
  readonly idPrefix?: string;
}

/** 본인 채널 테스트 영상 등록 — 첫 등록 영상의 채널이 본인 채널로 확정된다 (서버가 지정 채널은 거부). */
export function OwnVideoForm({ onRegistered, idPrefix = 'target' }: Props) {
  const [url, setUrl] = useState('');
  const [attest, setAttest] = useState(false);
  const register = useApiMutation((body: { url: string; attestOwnership: boolean }) => api.post<TestTargetDTO>('/api/targets', body), {
    invalidate: [qk.targets, qk.settings],
    onSuccess: (target) => {
      setUrl('');
      setAttest(false);
      onRegistered?.(target);
    },
  });
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && attest) register.mutate({ url: url.trim(), attestOwnership: true });
  };
  return (
    <form onSubmit={handleSubmit} className="space-y-2.5" data-testid={`${idPrefix}-form`}>
      <Field label="내 테스트 영상 URL" htmlFor={`${idPrefix}-url`} hint="본인 채널에 올린 영상(일부 공개 가능). 처음 등록한 영상의 채널이 본인 채널로 저장됩니다.">
        <input id={`${idPrefix}-url`} data-testid={`${idPrefix}-url`} value={url} onChange={(e) => setUrl(e.target.value)} maxLength={300} placeholder="https://www.youtube.com/watch?v=…" className={inputClass} />
      </Field>
      <label className="flex items-start gap-2 text-[13px]">
        <input type="checkbox" data-testid={`${idPrefix}-attest`} checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />이 영상은 내 채널 소유이며 테스트 목적입니다
      </label>
      <Button type="submit" data-testid={`${idPrefix}-register`} icon={<Plus size={14} aria-hidden />} loading={register.isPending} disabled={!url.trim() || !attest}>
        등록
      </Button>
      <ServerError error={register.error} />
    </form>
  );
}
