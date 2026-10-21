import { useEffect, useState } from 'react';
import { SageOrb } from './SageOrb.tsx';
import { hasSeenGreeting, markGreetingSeen } from './greetingFlag.ts';

const GREETING_MS = 4000;

/** 첫 방문에 한 번만 화면 위쪽 가운데에 뜨는 Sage 인사. 클릭을 가로막지 않는다. */
export function SageGreeting() {
  const [visible, setVisible] = useState(() => !hasSeenGreeting());

  useEffect(() => {
    if (!visible) return undefined;
    const timer = setTimeout(() => {
      setVisible(false);
      markGreetingSeen();
    }, GREETING_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;
  return (
    <div role="status" data-testid="sage-greeting" className="sage-greeting pointer-events-none fixed top-[88px] left-1/2 z-30 flex flex-col items-center gap-2">
      <SageOrb size={52} />
      <span className="rounded-full bg-surface px-3 py-1.5 text-[12.5px] font-medium shadow-card">
        안녕하세요, 콘솔 비서 <span className="text-[var(--color-orb-from)]">Sage</span>예요
      </span>
    </div>
  );
}
