import { useEffect, useRef, useState } from 'react';

const BLINK_MIN_MS = 3000;
const BLINK_SPREAD_MS = 3000;
const BLINK_DURATION_MS = 120;
const EYE_TRAVEL_PX = 2;

interface SageOrbProps {
  readonly size: number;
  readonly state?: 'idle' | 'thinking';
  readonly className?: string;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** Sage 구슬: 숨쉬기·랜덤 깜빡임·마우스 쪽으로 눈동자 이동. 장식이므로 보조기기에는 숨긴다. */
export function SageOrb({ size, state = 'idle', className }: SageOrbProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setBlinking(true);
        timer = setTimeout(() => {
          setBlinking(false);
          schedule();
        }, BLINK_DURATION_MS);
      }, BLINK_MIN_MS + Math.random() * BLINK_SPREAD_MS);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion()) return undefined;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy) || 1;
        el.style.setProperty('--eye-x', `${((dx / dist) * EYE_TRAVEL_PX).toFixed(2)}px`);
        el.style.setProperty('--eye-y', `${((dy / dist) * EYE_TRAVEL_PX).toFixed(2)}px`);
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return (
    <span
      ref={ref}
      aria-hidden
      data-state={state}
      data-blink={blinking}
      className={['sage-orb', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size }}
    >
      <span className="sage-orb-eyes">
        <span className="sage-orb-eye" />
        <span className="sage-orb-eye" />
      </span>
    </span>
  );
}
