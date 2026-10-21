const GREETED_KEY = 'context.sage.greeted';

type ReadStorage = Pick<Storage, 'getItem'>;
type WriteStorage = Pick<Storage, 'setItem'>;

/** 비밀이 아닌 UI 플래그만 저장한다. 저장소가 막힌 환경(사생활 보호 모드 등)에서도 예외를 밖으로 내지 않는다. */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function hasSeenGreeting(storage: ReadStorage | null = browserStorage()): boolean {
  try {
    return storage?.getItem(GREETED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markGreetingSeen(storage: WriteStorage | null = browserStorage()): void {
  try {
    storage?.setItem(GREETED_KEY, '1');
  } catch {
    // 저장에 실패하면 다음 방문에 인사가 한 번 더 보일 뿐이다.
  }
}
