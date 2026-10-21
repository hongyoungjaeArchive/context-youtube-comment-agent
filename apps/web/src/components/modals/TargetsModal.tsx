import { useState, type FormEvent } from 'react';
import { FlaskConical } from 'lucide-react';
import type { TestTargetDTO } from '@context/shared';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { qk, useHealth, useTargets } from '../../api/queries.ts';
import type { FixtureMode } from '../../api/types.ts';
import { cx } from '../../lib/format.ts';
import { Badge, Button, Notice, SectionLabel } from '../ui/primitives.tsx';
import { Modal, ServerError, inputClass } from '../ui/overlay.tsx';
import { OwnVideoForm } from '../execution/OwnVideoForm.tsx';

const FIXTURE_MODES: readonly { value: FixtureMode; label: string }[] = [
  { value: 'ok', label: 'ok — 정상 게시' },
  { value: 'signedout', label: 'signedout — 로그인 만료' },
  { value: 'nocomments', label: 'nocomments — 입력창 없음' },
  { value: 'hang', label: 'hang — 제출 후 무응답' },
  { value: 'slow', label: 'slow — 느린 응답' },
  { value: 'captcha', label: 'captcha — 보안 확인' },
];

function TargetRow({ t }: { t: TestTargetDTO }) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-elevated/40 px-3 py-2">
      <span className="font-mono text-[12px]">{t.videoId}</span>
      <span className="min-w-0 flex-1 truncate text-[13px]">{t.title ?? t.url}</span>
      {t.isFixture ? <Badge tone="warning">로컬 픽스처</Badge> : null}
      <Badge tone={t.ownershipState === 'VERIFIED' ? 'success' : 'danger'} icon>
        {t.ownershipState}
      </Badge>
      {t.claimStatus ? (
        <Badge tone="danger" icon>
          이미 게시 기록 있음 · {t.claimStatus}
        </Badge>
      ) : null}
    </li>
  );
}

function FixtureForm() {
  const [videoId, setVideoId] = useState('FIXTURE0001');
  const [mode, setMode] = useState<FixtureMode>('ok');
  const register = useApiMutation((body: { videoId: string; mode: FixtureMode }) => api.post<TestTargetDTO>('/api/targets', { fixture: body }), {
    invalidate: [qk.targets],
  });
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    register.mutate({ videoId: videoId.trim(), mode });
  };
  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border border-warning/25 bg-warning/[0.04] p-3">
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-warning">
        <FlaskConical size={13} aria-hidden /> TEST MODE — 로컬 픽스처 등록 (실제 YouTube 아님)
      </p>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <label className="sr-only" htmlFor="fixture-video-id">
          픽스처 ID
        </label>
        <input id="fixture-video-id" data-testid="fixture-video-id" value={videoId} onChange={(e) => setVideoId(e.target.value)} maxLength={11} className={cx(inputClass, 'font-mono')} />
        <label className="sr-only" htmlFor="fixture-mode">
          픽스처 동작
        </label>
        <select id="fixture-mode" data-testid="fixture-mode" value={mode} onChange={(e) => setMode(e.target.value as FixtureMode)} className={inputClass}>
          {FIXTURE_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        <Button type="submit" data-testid="fixture-register" loading={register.isPending}>
          픽스처 등록
        </Button>
      </div>
      <p className="text-[12px] text-muted">ID 형식: FIXTURE + 대문자/숫자 4자리. 동작별로 다른 ID를 쓰세요 (영상당 1개 게시 제한).</p>
      {register.isSuccess ? <Badge tone="success" icon>등록됨 · {register.data.videoId}</Badge> : null}
      <ServerError error={register.error} />
    </form>
  );
}

export function TargetsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const targets = useTargets().data?.targets ?? [];
  const fixtureMode = useHealth().data?.fixtureMode ?? false;
  return (
    <Modal open={open} onClose={onClose} title="테스트 영상" subtitle="실제 브라우저 게시는 본인 소유 테스트 영상에만 허용됩니다." testId="targets-modal">
      <div className="space-y-5">
        <section>
          <SectionLabel>등록된 테스트 영상</SectionLabel>
          {targets.length === 0 ? (
            <p className="text-[12.5px] text-muted">없음</p>
          ) : (
            <ul className="space-y-1.5">
              {targets.map((t) => (
                <TargetRow key={t.id} t={t} />
              ))}
            </ul>
          )}
        </section>
        <section>
          <SectionLabel>본인 영상 등록</SectionLabel>
          <OwnVideoForm idPrefix="modal-target" />
        </section>
        {fixtureMode ? <FixtureForm /> : <Notice tone="neutral">픽스처 등록은 TEST MODE(CONTEXT_FIXTURE_MODE=1)에서만 가능합니다.</Notice>}
      </div>
    </Modal>
  );
}
