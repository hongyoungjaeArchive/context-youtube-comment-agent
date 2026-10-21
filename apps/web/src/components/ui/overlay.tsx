import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ShieldAlert, X } from 'lucide-react';
import type { ApiError } from '../../api/client.ts';
import { cx } from '../../lib/format.ts';

interface ModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly subtitle?: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly width?: 'md' | 'lg' | 'xl';
  readonly footer?: ReactNode;
  readonly testId?: string;
}

const WIDTH = { md: 'max-w-[560px]', lg: 'max-w-[820px]', xl: 'max-w-[1120px]' } as const;

/** 접근 가능한 모달: Esc 닫기, 포커스 이동/복원, aria-modal. */
export function Modal({ open, title, subtitle, onClose, children, width = 'lg', footer, testId }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-fg/25 px-4 py-10 backdrop-blur-[2px]">
      <div className="fixed inset-0" aria-hidden onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        className={cx('fade-in relative w-full rounded-[14px] border border-line-strong bg-surface shadow-2xl shadow-black/10 outline-none', WIDTH[width])}
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
          <div>
            <h2 id={titleId} className="text-[16px] font-semibold tracking-tight">
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 text-[12.5px] text-muted">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-fg/[0.06] hover:text-fg">
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className="max-h-[calc(100vh-220px)] overflow-y-auto px-6 py-5">{children}</div>
        {footer ? <footer className="flex justify-end gap-2 border-t border-line px-6 py-3.5">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

/** 서버가 막은 이유(code+message)를 그대로 보여 준다. */
export function ServerError({ error, className }: { error: ApiError | null | undefined; className?: string }) {
  if (!error) return null;
  return (
    <div role="alert" data-testid="server-error" className={cx('flex gap-2 rounded-lg border border-danger/35 bg-danger/[0.09] px-3 py-2 text-[12.5px] leading-5', className)}>
      <ShieldAlert size={14} className="mt-[3px] shrink-0 text-danger" aria-hidden />
      <div className="min-w-0">
        <span className="mr-1.5 rounded bg-danger/20 px-1 py-px font-mono text-[11px] font-semibold text-danger">{error.code}</span>
        <span className="text-danger">{error.message}</span>
      </div>
    </div>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-muted">
        {label}
      </label>
      {children}
      {hint ? <p className="text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  'h-10 w-full rounded-lg border border-line-strong bg-bg/70 px-3 text-[13.5px] text-fg placeholder:text-muted focus:border-accent/60 focus:outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50';
