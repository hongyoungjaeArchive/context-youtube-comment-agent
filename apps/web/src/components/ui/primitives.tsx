import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Info, Loader2, XCircle } from 'lucide-react';
import { cx } from '../../lib/format.ts';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-fg/[0.06] text-muted border-line',
  accent: 'bg-accent/15 text-accent-strong border-accent/30',
  success: 'bg-success/12 text-success border-success/30',
  warning: 'bg-warning/12 text-warning border-warning/30',
  danger: 'bg-danger/12 text-danger border-danger/30',
};

export function toneIcon(tone: Tone, size = 13): ReactNode {
  const p = { size, 'aria-hidden': true, className: 'shrink-0' } as const;
  switch (tone) {
    case 'success':
      return <CheckCircle2 {...p} />;
    case 'warning':
      return <AlertTriangle {...p} />;
    case 'danger':
      return <XCircle {...p} />;
    case 'accent':
      return <Info {...p} />;
    default:
      return <CircleDashed {...p} />;
  }
}

interface BadgeProps {
  readonly tone?: Tone;
  readonly icon?: boolean | ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly title?: string;
  readonly testId?: string;
}

/** 상태 배지 — 색만으로 상태를 알리지 않도록 아이콘+텍스트를 함께 쓴다. */
export function Badge({ tone = 'neutral', icon = false, children, className, title, testId }: BadgeProps) {
  const iconNode = icon === true ? toneIcon(tone, 12) : icon || null;
  return (
    <span
      title={title}
      data-testid={testId}
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] font-medium leading-4 whitespace-nowrap tnum',
        TONE_BADGE[tone],
        className,
      )}
    >
      {iconNode}
      {children}
    </span>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-fg text-surface hover:bg-fg/85 border-transparent font-semibold',
  secondary: 'bg-elevated text-fg hover:bg-fg/[0.06] border-line-strong',
  ghost: 'bg-transparent text-muted hover:text-fg hover:bg-fg/[0.05] border-transparent',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 border-danger/30 font-semibold',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: Variant;
  readonly size?: 'md' | 'sm';
  readonly loading?: boolean;
  readonly icon?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', loading = false, icon, children, className, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 border transition-colors duration-100 select-none',
        variant === 'primary' ? 'rounded-full' : 'rounded-lg',
        'disabled:cursor-not-allowed disabled:opacity-45',
        size === 'md' ? 'h-10 px-3.5 text-[13.5px]' : 'h-8 px-2.5 text-[12.5px]',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

interface PanelProps {
  readonly title: string;
  readonly step: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly labelledBy: string;
}

export function Panel({ title, step, actions, children, className, labelledBy }: PanelProps) {
  return (
    <section aria-labelledby={labelledBy} className={cx('flex min-h-0 min-w-0 flex-col blur-in rounded-card border border-line bg-surface shadow-card', className)}>
      <header className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
        <h2 id={labelledBy} className="flex items-center gap-2 text-[14px] font-semibold tracking-tight">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-accent/15 text-[11px] font-bold text-accent-strong tnum">{step}</span>
          {title}
        </h2>
        {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
    </section>
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-card border border-line bg-elevated/60', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-muted">{children}</h3>
      {right}
    </div>
  );
}

export function Notice({ tone = 'accent', children, className, testId }: { tone?: Tone; children: ReactNode; className?: string; testId?: string }) {
  const color: Record<Tone, string> = {
    neutral: 'border-line bg-fg/[0.03] text-muted',
    accent: 'border-accent/25 bg-accent/[0.07] text-accent-strong',
    success: 'border-success/25 bg-success/[0.07] text-success',
    warning: 'border-warning/30 bg-warning/[0.08] text-warning',
    danger: 'border-danger/30 bg-danger/[0.08] text-danger',
  };
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} data-testid={testId} className={cx('flex gap-2 rounded-lg border px-3 py-2 text-[12.5px] leading-5', color[tone], className)}>
      <span className="mt-[3px]">{toneIcon(tone, 13)}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line px-4 py-10 text-center">
      <div className="text-muted">{icon}</div>
      <p className="text-[13.5px] font-medium">{title}</p>
      {hint ? <p className="max-w-[34ch] text-[12.5px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted" role="status">
      <Loader2 size={13} className="animate-spin" aria-hidden />
      {label}
    </span>
  );
}
