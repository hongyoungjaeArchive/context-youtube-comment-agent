import { useState, type FormEvent } from 'react';
import { Terminal } from 'lucide-react';
import type { AiProvider, SettingsDTO } from '@context/shared';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { qk } from '../../api/queries.ts';
import { cx } from '../../lib/format.ts';
import { Badge, Button, Notice } from '../ui/primitives.tsx';
import { ServerError } from '../ui/overlay.tsx';

export const PROVIDER_META: Record<AiProvider, { label: string; hint: string }> = {
  CLAUDE_CLI: { label: 'Claude Code CLI', hint: '기본 · 구독 사용량 · 추가 비용 없음' },
  ANTHROPIC_API: { label: 'Anthropic API 키', hint: '호출마다 종량 과금' },
  MOCK: { label: '모의 (MOCK)', hint: 'AI 호출 없음 · 결과는 성능 수치 아님' },
};
const ORDER: readonly AiProvider[] = ['CLAUDE_CLI', 'ANTHROPIC_API', 'MOCK'];

interface CliCheck {
  readonly available: boolean;
  readonly version: string | null;
  readonly message: string;
}

/** AI Provider 선택. 종량 과금(ANTHROPIC_API)은 비용 동의 체크가 있어야 저장된다. */
export function ProviderSection({ settings }: { settings: SettingsDTO }) {
  const [provider, setProvider] = useState<AiProvider>(settings.llmProvider);
  const [confirmMetered, setConfirmMetered] = useState(false);
  const metered = provider === 'ANTHROPIC_API';
  const save = useApiMutation(
    (body: { llmProvider: AiProvider; confirmMetered?: boolean }) => api.patch<SettingsDTO>('/api/settings', body),
    { invalidate: [qk.settings, qk.health, qk.usage], onSuccess: () => setConfirmMetered(false) },
  );
  const check = useApiMutation(() => api.post<CliCheck>('/api/settings/llm/check'));
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (metered && !confirmMetered) return;
    save.mutate(metered ? { llmProvider: provider, confirmMetered: true } : { llmProvider: provider });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3" data-testid="provider-form">
      <p className="text-[12px] text-muted">
        현재 적용 <Badge tone={settings.aiProvider === 'ANTHROPIC_API' ? 'danger' : settings.aiProvider === 'MOCK' ? 'warning' : 'success'}>{settings.aiProvider}</Badge> · 저장된 선호{' '}
        <span className="text-fg">{settings.llmProvider}</span> (환경 강제 플래그가 있으면 선호값보다 우선)
      </p>
      <fieldset className="grid gap-1.5">
        <legend className="sr-only">AI Provider</legend>
        {ORDER.map((p) => (
          <label
            key={p}
            className={cx(
              'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 text-[13px]',
              provider === p ? (p === 'ANTHROPIC_API' ? 'border-danger/50 bg-danger/[0.06]' : 'border-accent/50 bg-accent/[0.06]') : 'border-line hover:border-line-strong',
            )}
          >
            <input type="radio" name="llm-provider" value={p} checked={provider === p} onChange={() => setProvider(p)} className="h-4 w-4 accent-[var(--color-accent)]" data-testid={`provider-${p}`} />
            <span className="font-medium">{PROVIDER_META[p].label}</span>
            <span className={cx('text-[12px]', p === 'ANTHROPIC_API' ? 'text-danger' : 'text-muted')}>{PROVIDER_META[p].hint}</span>
          </label>
        ))}
      </fieldset>
      {metered ? (
        <Notice tone="danger">
          <p className="font-semibold">종량 과금 — Anthropic API 키로 호출할 때마다 비용이 청구됩니다.</p>
          <p>구독(Claude Code CLI)과 달리 분석·재검증·평가마다 실제 청구가 발생합니다. AI 예산 한도는 이 Provider에만 적용됩니다.</p>
          <label className="mt-1.5 flex items-center gap-2 font-medium">
            <input type="checkbox" checked={confirmMetered} onChange={(e) => setConfirmMetered(e.target.checked)} className="h-4 w-4 accent-[var(--color-danger)]" data-testid="confirm-metered" />
            호출마다 비용이 청구됨에 동의합니다
          </label>
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant={metered ? 'danger' : 'primary'} loading={save.isPending} disabled={(metered && !confirmMetered) || provider === settings.llmProvider}>
          Provider 저장
        </Button>
        {save.isSuccess ? <Badge tone="success" icon>저장됨</Badge> : null}
      </div>
      <ServerError error={save.error} />

      <div className="space-y-1.5 rounded-lg border border-line bg-elevated/40 p-3">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <Terminal size={14} aria-hidden className="text-muted" />
          <span className="font-medium">Claude Code CLI</span>
          <span className="min-w-0 truncate font-mono text-[12px] text-muted">{settings.claudeCli.path ?? '경로를 찾지 못함'}</span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => check.mutate()} loading={check.isPending} data-testid="cli-check">
            CLI 확인
          </Button>
        </div>
        <p className="text-[12px] text-muted">설치·버전만 확인합니다 (모델 호출 없음).</p>
        {check.data ? (
          <Badge tone={check.data.available ? 'success' : 'danger'} icon>
            {check.data.version ? `${check.data.version} · ` : ''}
            {check.data.message}
          </Badge>
        ) : null}
        <ServerError error={check.error} />
      </div>
    </form>
  );
}
