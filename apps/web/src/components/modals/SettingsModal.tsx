import { useState, type FormEvent } from 'react';
import { DatabaseBackup, FlaskConical, KeyRound } from 'lucide-react';
import { PROMPT_VERSIONS, type KeyState, type SettingsDTO } from '@context/shared';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { qk, useSettings } from '../../api/queries.ts';
import { cx } from '../../lib/format.ts';
import { Badge, Button, Notice, SectionLabel, Spinner } from '../ui/primitives.tsx';
import { Field, Modal, ServerError, inputClass } from '../ui/overlay.tsx';
import { ProviderSection } from './ProviderSection.tsx';

type Provider = 'anthropic' | 'youtube';
const PROVIDER_LABEL: Record<Provider, string> = { anthropic: 'Claude (Anthropic) API 키', youtube: 'YouTube Data API 키' };
const KEY_TONE: Record<KeyState, 'success' | 'warning' | 'danger'> = { REGISTERED: 'success', MISSING: 'warning', UNAVAILABLE: 'danger' };
const SETTINGS_KEYS = [qk.settings, qk.health] as const;

function KeyRow({ provider, state, testNote }: { provider: Provider; state: KeyState; testNote?: string }) {
  const [secret, setSecret] = useState('');
  const save = useApiMutation((s: string) => api.post<{ state: KeyState }>('/api/settings/api-key', { provider, secret: s }), {
    invalidate: SETTINGS_KEYS,
    onSuccess: () => setSecret(''),
  });
  const remove = useApiMutation(() => api.del<{ state: KeyState }>(`/api/settings/api-key/${provider}`), { invalidate: SETTINGS_KEYS });
  const test = useApiMutation(() => api.post<{ ok: boolean; message: string }>(`/api/settings/api-key/${provider}/test`));
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const value = secret;
    setSecret('');
    if (value.trim().length >= 10) save.mutate(value);
  };
  return (
    <div className="space-y-2 rounded-lg border border-line bg-elevated/40 p-3">
      <div className="flex items-center gap-2">
        <KeyRound size={14} aria-hidden className="text-muted" />
        <span className="text-[13px] font-medium">{PROVIDER_LABEL[provider]}</span>
        <Badge tone={KEY_TONE[state]} icon className="ml-auto">
          {state}
        </Badge>
      </div>
      <form onSubmit={handleSubmit} className="flex gap-1.5" autoComplete="off">
        <label htmlFor={`key-${provider}`} className="sr-only">
          {PROVIDER_LABEL[provider]} 입력
        </label>
        <input
          id={`key-${provider}`}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={state === 'REGISTERED' ? '새 키로 교체하려면 입력' : '키 입력 (Keychain에 저장)'}
          className={cx(inputClass, 'flex-1')}
        />
        <Button type="submit" loading={save.isPending} disabled={secret.trim().length < 10}>
          저장
        </Button>
      </form>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => test.mutate()} loading={test.isPending} disabled={state !== 'REGISTERED'}>
          연결 확인
        </Button>
        <Button size="sm" variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending} disabled={state !== 'REGISTERED'}>
          삭제
        </Button>
        {testNote ? <span className="text-[11.5px] text-warning">{testNote}</span> : null}
        {test.data ? <Badge tone={test.data.ok ? 'success' : 'danger'} icon>{test.data.message}</Badge> : null}
      </div>
      <ServerError error={save.error ?? remove.error ?? test.error} />
    </div>
  );
}

function selectRow<T extends string>(label: string, id: string, value: T, options: readonly T[], onChange: (v: T) => void) {
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={inputClass}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o === '' ? '(변경 안 함)' : o}
          </option>
        ))}
      </select>
    </Field>
  );
}

function GeneralForm({ settings }: { settings: SettingsDTO }) {
  const [ytPref, setYtPref] = useState<'' | 'AUTO' | 'LIVE' | 'SYNTHETIC'>('');
  const [light, setLight] = useState(settings.models.light);
  const [heavy, setHeavy] = useState(settings.models.heavy);
  const [promptVersion, setPromptVersion] = useState(settings.promptVersion);
  const [owner, setOwner] = useState(settings.ownerChannelId ?? '');
  const [daily, setDaily] = useState(settings.dailyMaxComments);
  const [autoPrescore, setAutoPrescore] = useState(settings.autoPrescore);
  const patch = useApiMutation((body: Record<string, unknown>) => api.patch<SettingsDTO>('/api/settings', body), { invalidate: SETTINGS_KEYS });
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    patch.mutate({
      ...(ytPref ? { youtubeModePreference: ytPref } : {}),
      lightModel: light.trim(),
      heavyModel: heavy.trim(),
      promptVersion,
      ownerChannelId: owner.trim() || null,
      dailyMaxComments: daily,
      autoPrescore,
    });
  };
  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <p className="text-[12px] text-muted">
        현재 적용: YouTube <span className="text-fg">{settings.youtubeMode}</span> (환경 강제 플래그가 있으면 선호값보다 우선)
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {selectRow('YouTube 모드 선호', 'yt-pref', ytPref, ['', 'AUTO', 'LIVE', 'SYNTHETIC'] as const, setYtPref)}
        <Field label="경량 모델 (light)" htmlFor="light-model">
          <input id="light-model" value={light} onChange={(e) => setLight(e.target.value)} className={inputClass} />
        </Field>
        <Field label="고성능 모델 (heavy)" htmlFor="heavy-model">
          <input id="heavy-model" value={heavy} onChange={(e) => setHeavy(e.target.value)} className={inputClass} />
        </Field>
        {selectRow('프롬프트 버전', 'prompt-version', promptVersion as (typeof PROMPT_VERSIONS)[number], PROMPT_VERSIONS, setPromptVersion)}
        <Field label="일일 게시 상한 (1~10)" htmlFor="daily-max">
          <input id="daily-max" type="number" min={1} max={10} value={daily} onChange={(e) => setDaily(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} className={inputClass} />
        </Field>
      </div>
      <Field label="본인 YouTube Channel ID" htmlFor="owner-channel" hint="테스트 영상 소유권 확인에 사용합니다 (UC로 시작하는 24자).">
        <input id="owner-channel" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="UC…" className={cx(inputClass, 'font-mono')} />
      </Field>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={autoPrescore} onChange={(e) => setAutoPrescore(e.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" />
        영상 불러오기 후 상위 15개 자동 예비평가 (AI 호출 발생)
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" loading={patch.isPending}>
          설정 저장
        </Button>
        {patch.isSuccess ? <Badge tone="success" icon>저장됨</Badge> : null}
      </div>
      <ServerError error={patch.error} />
    </form>
  );
}

function BudgetForm({ settings }: { settings: SettingsDTO }) {
  const [daily, setDaily] = useState(String(settings.budget.dailyLimitUsd));
  const [monthly, setMonthly] = useState(String(settings.budget.monthlyLimitUsd));
  const [ratio, setRatio] = useState(String(settings.budget.warningRatio));
  const put = useApiMutation((b: { dailyLimitUsd: number; monthlyLimitUsd: number; warningRatio: number }) => api.put<SettingsDTO>('/api/settings/budget', b), {
    invalidate: [...SETTINGS_KEYS, qk.usage],
  });
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    put.mutate({ dailyLimitUsd: Number(daily), monthlyLimitUsd: Number(monthly), warningRatio: Number(ratio) });
  };
  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="일간 한도 (USD, 0~100)" htmlFor="budget-daily">
          <input id="budget-daily" type="number" step="0.01" min={0} max={100} value={daily} onChange={(e) => setDaily(e.target.value)} className={inputClass} />
        </Field>
        <Field label="월간 한도 (USD, 0~1000)" htmlFor="budget-monthly">
          <input id="budget-monthly" type="number" step="0.01" min={0} max={1000} value={monthly} onChange={(e) => setMonthly(e.target.value)} className={inputClass} />
        </Field>
        <Field label="경고 비율 (0.1~1)" htmlFor="budget-ratio">
          <input id="budget-ratio" type="number" step="0.05" min={0.1} max={1} value={ratio} onChange={(e) => setRatio(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" loading={put.isPending}>
          예산 저장
        </Button>
        {put.isSuccess ? <Badge tone="success" icon>저장됨</Badge> : null}
      </div>
      <ServerError error={put.error} />
    </form>
  );
}

function BackupRow() {
  const backup = useApiMutation(() => api.post<{ ok: boolean; file: string }>('/api/data/backup'), { invalidate: [qk.activity] });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button icon={<DatabaseBackup size={14} aria-hidden />} onClick={() => backup.mutate()} loading={backup.isPending}>
        DB 백업 만들기
      </Button>
      {backup.data ? <Badge tone="success" icon>백업 완료 · {backup.data.file}</Badge> : null}
      <ServerError error={backup.error} />
    </div>
  );
}

export function SettingsModal({ open, onClose, onOpenEvalLab }: { open: boolean; onClose: () => void; onOpenEvalLab: () => void }) {
  const q = useSettings();
  const s = q.data;
  return (
    <Modal open={open} onClose={onClose} title="설정" subtitle="API 키는 macOS Keychain에만 저장되며 화면에는 등록 상태만 표시합니다." testId="settings-modal">
      {!s ? (
        q.isError ? <Notice tone="danger">설정을 불러오지 못했습니다.</Notice> : <Spinner label="불러오는 중" />
      ) : (
        <div className="space-y-6">
          <section>
            <SectionLabel>AI Provider</SectionLabel>
            <ProviderSection key={s.llmProvider} settings={s} />
          </section>
          <section className="space-y-2">
            <SectionLabel>API 키</SectionLabel>
            <KeyRow
              provider="anthropic"
              state={s.keys.anthropic}
              testNote={s.llmProvider === 'ANTHROPIC_API' ? undefined : '종량 과금 Provider를 켜야 실제 확인합니다 (지금은 API를 호출하지 않음)'}
            />
            <KeyRow provider="youtube" state={s.keys.youtube} />
          </section>
          <section>
            <SectionLabel>모드 · 모델 · 운영 한도</SectionLabel>
            <GeneralForm key={JSON.stringify(s.models) + s.promptVersion} settings={s} />
          </section>
          <section>
            <SectionLabel>AI 예산 (종량 과금 Provider에만 적용)</SectionLabel>
            <BudgetForm settings={s} />
          </section>
          <section>
            <SectionLabel>데이터</SectionLabel>
            <BackupRow />
          </section>
          <section className="space-y-2">
            <SectionLabel>고급 · 품질 평가</SectionLabel>
            <p className="text-[12.5px] text-muted">프롬프트 A/B, 장애 주입 10종, 골든 데이터셋 평가는 Evaluation Lab에서 실행합니다.</p>
            <Button variant="secondary" data-testid="open-eval-lab" icon={<FlaskConical size={14} aria-hidden />} onClick={onOpenEvalLab}>
              Evaluation Lab 열기
            </Button>
          </section>
        </div>
      )}
    </Modal>
  );
}
