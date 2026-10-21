import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, RotateCcw, X } from 'lucide-react';
import { useAskSage } from '../../api/mutations.ts';
import { cx } from '../../lib/format.ts';
import { SageOrb } from './SageOrb.tsx';

const MAX_QUESTION_CHARS = 500;
const SUGGESTIONS = ['오늘 게시 몇 개 남았어?', '지금 선택한 영상 요약해 줘', '승인 대기 중인 댓글 있어?'] as const;

interface Message {
  readonly id: number;
  readonly role: 'user' | 'sage';
  readonly text: string;
}

/** 헤더에서 넘어온 질문. 같은 문장을 다시 보내도 구분되도록 매번 새 id를 붙인다. */
export interface SageRequest {
  readonly id: number;
  readonly text: string;
}

interface SagePanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly selectedVideoId: string | null;
  /** 헤더 질문창에서 넘어온 질문 — 패널이 열리며 한 번 보낸다. */
  readonly initialQuestion: SageRequest | null;
}

/** 오른쪽 Sage 채팅 패널. 대화는 메모리에만 두고, 답변은 서버가 콘솔 상황 요약만 근거로 만든다. */
export function SagePanel({ open, onClose, selectedVideoId, initialQuestion }: SagePanelProps) {
  const ask = useAskSage();
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentRequestId = useRef<number | null>(null);
  const nextId = useRef(0);

  const send = (raw: string) => {
    const question = raw.trim().slice(0, MAX_QUESTION_CHARS);
    if (!question || ask.isPending) return;
    setLastQuestion(question);
    setMessages((prev) => [...prev, { id: nextId.current++, role: 'user', text: question }]);
    setDraft('');
    ask.mutate(
      { question, selectedVideoId },
      { onSuccess: (res) => setMessages((prev) => [...prev, { id: nextId.current++, role: 'sage', text: res.answer }]) },
    );
  };

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('[aria-modal="true"]')) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 답변을 기다리는 동안 입력창이 잠기며 포커스가 빠지므로, 답이 오면 입력창으로 돌려준다.
  useEffect(() => {
    if (open && !ask.isPending) inputRef.current?.focus();
  }, [open, ask.isPending]);

  // 답변 대기 중에 들어온 질문은 버리지 않고, 대기가 끝나면 보낸다.
  useEffect(() => {
    if (!open || !initialQuestion || ask.isPending || sentRequestId.current === initialQuestion.id) return;
    sentRequestId.current = initialQuestion.id;
    send(initialQuestion.text);
  }, [open, initialQuestion, ask.isPending]);

  if (!open) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  return (
    <aside
      role="dialog"
      aria-label="Sage 비서"
      data-testid="sage-panel"
      className="sage-panel-enter fixed top-0 right-0 bottom-0 z-40 flex w-full max-w-[380px] flex-col border-l border-line bg-surface shadow-card-hover"
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <SageOrb size={24} state={ask.isPending ? 'thinking' : 'idle'} />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold">Sage</p>
          <p className="text-[11.5px] text-muted">콘솔 숫자로만 답해요 · 게시·승인은 하지 않아요</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Sage 닫기" className="grid size-8 place-items-center rounded-full text-muted hover:bg-fg/[0.06] hover:text-fg">
          <X size={16} aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5" aria-live="polite">
        <div className="mb-5 flex flex-col items-center text-center">
          <SageOrb size={72} state={ask.isPending ? 'thinking' : 'idle'} />
          <p className="mt-3 text-[16px] font-semibold">
            안녕하세요, 콘솔 비서 <span className="text-[var(--color-orb-from)]">Sage</span>예요
          </p>
          <p className="mt-1 max-w-[30ch] text-[12.5px] text-muted">지금 콘솔에 있는 숫자로만 답해요. 게시나 승인은 하지 않아요.</p>
        </div>

        {messages.length === 0 ? (
          <div className="flex flex-wrap justify-center gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                data-testid="sage-chip"
                onClick={() => send(s)}
                className="lift rounded-full border border-line bg-elevated px-3 py-1.5 text-[12px] text-fg hover:border-line-strong"
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          <ol className="space-y-2.5">
            {messages.map((m) => (
              <li
                key={m.id}
                data-testid={m.role === 'sage' ? 'sage-answer' : 'sage-question'}
                className={cx(
                  'blur-in w-fit max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap',
                  m.role === 'user' ? 'ml-auto bg-fg text-surface' : 'bg-elevated text-fg',
                )}
              >
                {m.text}
              </li>
            ))}
            {ask.isPending ? <li className="text-[12px] text-muted">Sage가 생각하는 중…</li> : null}
          </ol>
        )}

        {ask.isError ? (
          <div role="alert" className="mt-3 flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/[0.06] px-3 py-2 text-[12.5px] text-danger">
            <span className="flex-1">{ask.error.message}</span>
            {lastQuestion ? (
              <button type="button" onClick={() => send(lastQuestion)} className="inline-flex items-center gap-1 font-semibold hover:underline">
                <RotateCcw size={12} aria-hidden />
                다시 시도
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-line p-3">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_QUESTION_CHARS}
          disabled={ask.isPending}
          placeholder="게시 현황, 선택한 영상, 승인 상태를 물어보세요"
          aria-label="Sage에게 질문"
          data-testid="sage-input"
          className="h-10 min-w-0 flex-1 rounded-full border border-line bg-elevated px-4 text-[13px] outline-none placeholder:text-muted focus:border-accent"
        />
        <button
          type="submit"
          disabled={ask.isPending || draft.trim().length === 0}
          aria-label="질문 보내기"
          data-testid="sage-send"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-fg text-surface disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ArrowUp size={16} aria-hidden />
        </button>
      </form>
    </aside>
  );
}
