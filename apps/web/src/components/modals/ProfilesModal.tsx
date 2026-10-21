import { useState, type FormEvent } from 'react';
import { LogIn, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { OPERATION_LIMITS, type ProfileDTO, type ProfileStatus } from '@context/shared';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { qk, useProfiles } from '../../api/queries.ts';
import { PROFILE_STATUS } from '../../lib/status.ts';
import { cx, fmtDateTime } from '../../lib/format.ts';
import { Badge, Button, Notice } from '../ui/primitives.tsx';
import { Modal, ServerError, inputClass } from '../ui/overlay.tsx';

function ProfileRow({ p }: { p: ProfileDTO }) {
  const keys = [qk.profiles];
  const openLogin = useApiMutation(() => api.post<{ ok: boolean; message: string }>(`/api/profiles/${p.id}/open-login`), { invalidate: keys });
  const check = useApiMutation(() => api.post<{ status: ProfileStatus }>(`/api/profiles/${p.id}/check-auth`), { invalidate: keys });
  const remove = useApiMutation(() => api.del<{ ok: boolean }>(`/api/profiles/${p.id}`), { invalidate: keys });
  const meta = PROFILE_STATUS[p.status];
  return (
    <li className="space-y-2 rounded-lg border border-line bg-elevated/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold">{p.alias}</span>
        <Badge tone={meta.tone} icon>
          {p.status} · {meta.label}
        </Badge>
        {p.accountLabel ? <span className="text-[12px] text-muted">{p.accountLabel}</span> : null}
        <span className="ml-auto text-[11.5px] text-muted tnum">마지막 확인 {fmtDateTime(p.lastAuthCheck)}</span>
      </div>
      {p.lastError ? <p className="text-[12px] text-danger">{p.lastError}</p> : null}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" icon={<LogIn size={13} aria-hidden />} onClick={() => openLogin.mutate()} loading={openLogin.isPending} disabled={p.status === 'LOCKED'}>
          로그인 창 열기
        </Button>
        <Button size="sm" icon={<ShieldCheck size={13} aria-hidden />} onClick={() => check.mutate()} loading={check.isPending} disabled={p.status === 'LOCKED'}>
          로그인 확인
        </Button>
        <Button size="sm" variant="ghost" icon={<Trash2 size={13} aria-hidden />} onClick={() => remove.mutate()} loading={remove.isPending} disabled={p.status === 'LOCKED'}>
          삭제
        </Button>
      </div>
      {openLogin.data ? <Notice tone="accent">{openLogin.data.message}</Notice> : null}
      {check.data ? <Notice tone={check.data.status === 'READY' ? 'success' : 'warning'}>로그인 확인 결과: {check.data.status}</Notice> : null}
      <ServerError error={openLogin.error ?? check.error ?? remove.error} />
    </li>
  );
}

export function ProfilesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useProfiles();
  const profiles = q.data?.profiles ?? [];
  const [alias, setAlias] = useState('');
  const create = useApiMutation((a: string) => api.post<ProfileDTO>('/api/profiles', { alias: a }), {
    invalidate: [qk.profiles],
    onSuccess: () => setAlias(''),
  });
  const full = profiles.length >= OPERATION_LIMITS.maxProfiles;
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (alias.trim()) create.mutate(alias.trim());
  };
  return (
    <Modal open={open} onClose={onClose} width="md" title="프로필 관리" subtitle={`전용 테스트 Chrome 프로필 최대 ${OPERATION_LIMITS.maxProfiles}개`} testId="profiles-modal">
      <div className="space-y-4">
        <Notice tone="accent">평소 쓰는 Chrome 프로필이 아닌 앱 전용 폴더에 세션을 보관합니다. 로그인은 사용자가 직접 하며, 앱은 비밀번호를 저장하지 않습니다. 계정 자동 순환은 금지됩니다.</Notice>
        <ul className="space-y-2">
          {profiles.map((p) => (
            <ProfileRow key={p.id} p={p} />
          ))}
        </ul>
        {profiles.length === 0 && !q.isLoading ? <p className="text-[12.5px] text-muted">등록된 프로필이 없습니다.</p> : null}
        <form onSubmit={handleSubmit} className="flex gap-1.5">
          <label htmlFor="profile-alias" className="sr-only">
            새 프로필 이름
          </label>
          <input
            id="profile-alias"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            maxLength={20}
            placeholder={full ? '최대 개수에 도달했습니다' : '예: 유튜브2'}
            disabled={full}
            className={cx(inputClass, 'flex-1')}
          />
          <Button type="submit" icon={<UserPlus size={14} aria-hidden />} loading={create.isPending} disabled={full || !alias.trim()}>
            추가
          </Button>
        </form>
        <ServerError error={create.error} />
      </div>
    </Modal>
  );
}
