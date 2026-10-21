import type { Ref } from 'react';
import { SageOrb } from './SageOrb.tsx';

interface SageLauncherProps {
  readonly onOpen: () => void;
  readonly ref?: Ref<HTMLButtonElement>;
}

/** 오른쪽 아래 고정 "Sage에게 묻기" 알약 버튼. 패널이 열리면 App이 렌더링하지 않는다. */
export function SageLauncher({ onOpen, ref }: SageLauncherProps) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      data-testid="sage-launcher"
      className="blur-in fixed right-5 bottom-5 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-fg pr-4 pl-2 text-[13px] font-semibold text-surface shadow-card-hover transition-transform hover:-translate-y-0.5"
    >
      <SageOrb size={26} />
      Sage에게 묻기
    </button>
  );
}
