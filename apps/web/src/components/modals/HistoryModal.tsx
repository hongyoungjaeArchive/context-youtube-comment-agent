import { useState } from 'react';
import { useExecutions } from '../../api/queries.ts';
import { EXECUTION_STATUS } from '../../lib/status.ts';
import { cx, fmtDateTime } from '../../lib/format.ts';
import { ExecutionTimeline } from '../execution/ExecutionTimeline.tsx';
import { Badge } from '../ui/primitives.tsx';
import { Modal } from '../ui/overlay.tsx';

export function HistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const list = useExecutions().data?.executions ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = list.find((e) => e.id === selectedId) ?? null;
  return (
    <Modal open={open} onClose={onClose} width="xl" title="실행 기록" subtitle="시간순 성공·실패·UNKNOWN. 승인 해시와 스크린샷 참조를 함께 확인합니다." testId="history-modal">
      {list.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted">아직 실행 기록이 없습니다.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ul className="space-y-1.5" aria-label="실행 목록">
            {list.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  data-testid="history-row"
                  aria-pressed={e.id === selectedId}
                  onClick={() => setSelectedId(e.id)}
                  className={cx(
                    'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                    e.id === selectedId ? 'border-accent/60 bg-accent/[0.07]' : 'border-line bg-elevated/40 hover:border-line-strong',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
                    <Badge tone={EXECUTION_STATUS[e.status].tone} icon>
                      {e.status}
                    </Badge>
                    <span className="text-muted tnum">{fmtDateTime(e.createdAt)}</span>
                    <span className="text-muted">· {e.profileAlias}</span>
                    <span className="text-muted">· {e.mode}</span>
                    <span className="ml-auto font-mono text-[11px] text-muted">{e.revisionHash.slice(0, 12)}</span>
                  </div>
                  <p className="mt-1 truncate text-[12px] text-muted">
                    게시 영상 <span className="text-fg">{e.targetTitle ?? '(제목 없음)'}</span> <span className="font-mono text-[11px]">{e.targetVideoId}</span>
                  </p>
                  <p className="truncate text-[12px] text-muted">초안 원본 {e.sourceTitle ?? e.sourceVideoId}</p>
                  <p className="mt-1 line-clamp-2 text-[12.5px]">{e.content}</p>
                </button>
              </li>
            ))}
          </ul>
          <div className="rounded-lg border border-line p-3">
            {selected ? (
              <div className="space-y-2">
                <p className="text-[12px] text-muted">
                  대상 <span className="font-mono text-fg">{selected.targetVideoId}</span> · 원본 <span className="font-mono text-fg">{selected.sourceVideoId}</span> · 승인 <span className="font-mono">{selected.approvalId}</span>
                </p>
                <ExecutionTimeline execution={selected} />
              </div>
            ) : (
              <p className="py-8 text-center text-[12.5px] text-muted">왼쪽에서 실행을 선택하면 단계·이벤트가 표시됩니다.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
