import { useState } from 'react';
import { ChevronUp } from 'lucide-react';
import { cx } from '../../lib/format.ts';
import { AuditTab, ExecutionLogTab, JobsTab, UsageTab } from './tabs.tsx';

type TabKey = 'jobs' | 'usage' | 'executions' | 'errors' | 'audit';

const TABS: readonly { key: TabKey; label: string }[] = [
  { key: 'jobs', label: '작업 큐' },
  { key: 'usage', label: 'AI 사용량' },
  { key: 'executions', label: '실행 로그' },
  { key: 'errors', label: '오류 기록' },
  { key: 'audit', label: '전체 감사 로그' },
];

export function ActivityCenter() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>('jobs');
  return (
    <section data-testid="activity-center" aria-label="Activity Center" className="rounded-card border border-line bg-surface">
      <div className="flex items-center gap-1 px-3 py-1.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="activity-body"
          onClick={() => setOpen((v) => !v)}
          className="mr-2 inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold hover:bg-fg/[0.04]"
        >
          <ChevronUp size={14} aria-hidden className={cx('transition-transform', !open && 'rotate-180')} />
          Activity Center
        </button>
        <div role="tablist" aria-label="Activity 탭" className="flex flex-wrap gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              data-testid={`activity-tab-${t.key}`}
              onClick={() => {
                setTab(t.key);
                setOpen(true);
              }}
              className={cx('h-8 rounded-md px-2.5 text-[12.5px]', tab === t.key && open ? 'bg-elevated text-fg' : 'text-muted hover:text-fg')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <span className="ml-auto hidden text-[11.5px] text-muted md:inline">키·세션 비밀값은 표시하지 않습니다</span>
      </div>
      {open ? (
        <div id="activity-body" role="tabpanel" className="max-h-[340px] overflow-y-auto border-t border-line px-3 py-3">
          {tab === 'jobs' ? <JobsTab /> : null}
          {tab === 'usage' ? <UsageTab /> : null}
          {tab === 'executions' ? <ExecutionLogTab /> : null}
          {tab === 'errors' ? <AuditTab errorsOnly /> : null}
          {tab === 'audit' ? <AuditTab errorsOnly={false} /> : null}
        </div>
      ) : null}
    </section>
  );
}
