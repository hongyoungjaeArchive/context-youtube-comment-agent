import { useState, type FormEvent, type ReactNode } from 'react';
import { Activity, History, MonitorPlay, Search, Settings, Users } from 'lucide-react';
import type { HealthDTO } from '@context/shared';
import { Badge } from '../ui/primitives.tsx';
import { cx } from '../../lib/format.ts';

export type ModalKey = 'settings' | 'profiles' | 'targets' | 'eval' | 'history';

interface Props {
  readonly health: HealthDTO | undefined;
  readonly healthError: boolean;
  readonly onOpen: (key: ModalKey) => void;
  readonly onAskSage: (question: string) => void;
}

function HeaderButton({ icon, label, onClick, testId }: { icon: ReactNode; label: string; onClick: () => void; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid={testId}
      className="group relative grid size-9 place-items-center rounded-full bg-surface text-muted shadow-card transition-colors hover:bg-fg hover:text-surface"
    >
      {icon}
      <span
        aria-hidden
        className="pointer-events-none absolute top-[calc(100%+6px)] right-0 z-40 whitespace-nowrap rounded-full bg-fg px-2.5 py-1 text-[11.5px] font-medium text-surface opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {label}
      </span>
    </button>
  );
}

function SageSearch({ onAsk }: { onAsk: (question: string) => void }) {
  const [text, setText] = useState('');
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const question = text.trim();
    if (!question) return;
    onAsk(question);
    setText('');
  };
  return (
    <form role="search" onSubmit={handleSubmit} className="ml-auto flex h-10 w-full max-w-[300px] items-center rounded-full bg-surface pr-1 pl-4 shadow-card">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
        placeholder="검색하거나 Sage에게 묻기…"
        aria-label="Sage에게 묻기"
        data-testid="sage-search"
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted"
      />
      <button type="submit" aria-label="Sage에게 보내기" className="grid size-8 shrink-0 place-items-center rounded-full bg-fg text-surface">
        <Search size={14} aria-hidden />
      </button>
    </form>
  );
}

function ServerBadge({ health, healthError }: { health: HealthDTO | undefined; healthError: boolean }) {
  if (healthError) return <Badge tone="danger" icon>API DISCONNECTED</Badge>;
  if (!health) return <Badge tone="neutral">연결 확인 중</Badge>;
  return health.status === 'LOCAL_READY' ? (
    <Badge tone="success" icon title={`DB ${health.db} · v${health.version}`}>LOCAL READY</Badge>
  ) : (
    <Badge tone="danger" icon title={`DB ${health.db}`}>DEGRADED</Badge>
  );
}

export function GlobalHeader({ health, healthError, onOpen, onAskSage }: Props) {
  const busy = health ? health.queue.running + health.queue.waiting : 0;
  const atLimit = health ? health.daily.reserved >= health.daily.limit : false;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,var(--color-orb-to),var(--color-orb-from))] text-[12px] font-black text-surface">C</span>
          <span className="text-[15px] font-bold tracking-[0.18em]">CONTEXT</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" aria-label="시스템 상태">
          <ServerBadge health={health} healthError={healthError} />
          {health ? (
            <>
              {health.aiProvider === 'CLAUDE_CLI' ? (
                <Badge tone="success" icon title="Claude Code CLI — 구독 사용량">Claude Code (구독 · 추가 비용 없음)</Badge>
              ) : health.aiProvider === 'ANTHROPIC_API' ? (
                <Badge tone="danger" icon title="Anthropic API 키 — 호출마다 비용 청구">Anthropic API · 종량 과금</Badge>
              ) : (
                <Badge tone="warning" icon title="모의 분석 — 실제 Claude가 아님">AI MOCK · 모의 분석</Badge>
              )}
              {/* 정상(LIVE)일 때는 표시하지 않는다 — 처음 보는 사람에게 필요한 상태만 남긴다. */}
              {health.youtubeMode === 'LIVE' ? null : (
                <Badge tone="warning" icon title="합성 데이터 — 실제 YouTube 영상이 아님">YouTube SYNTHETIC · 합성 데이터</Badge>
              )}
              {health.fixtureMode ? (
                <Badge tone="warning" className="tracking-wide">TEST MODE</Badge>
              ) : null}
              <Badge tone={atLimit ? 'danger' : 'neutral'} icon={atLimit} title={`${health.daily.localDate} (KST) 게시 예약 / 일일 상한`}>
                오늘 게시 <span className="font-semibold text-fg">{health.daily.reserved}/{health.daily.limit}</span>
              </Badge>
              {busy > 0 ? (
                <Badge tone="accent" icon={<Activity size={12} aria-hidden />} title="실행 중 + 대기 작업">
                  AI 작업 중 · {health.queue.running} 진행 / {health.queue.waiting} 대기
                </Badge>
              ) : null}
            </>
          ) : null}
        </div>

        <SageSearch onAsk={onAskSage} />

        <nav aria-label="보조 화면" className={cx('flex items-center gap-1.5')}>
          <HeaderButton icon={<MonitorPlay size={15} aria-hidden />} label="테스트 영상" onClick={() => onOpen('targets')} testId="open-targets" />
          <HeaderButton icon={<Users size={15} aria-hidden />} label="프로필" onClick={() => onOpen('profiles')} testId="open-profiles" />
          <HeaderButton icon={<History size={15} aria-hidden />} label="실행 기록" onClick={() => onOpen('history')} testId="open-history" />
          <HeaderButton icon={<Settings size={15} aria-hidden />} label="설정" onClick={() => onOpen('settings')} testId="open-settings" />
        </nav>
      </div>
    </header>
  );
}
