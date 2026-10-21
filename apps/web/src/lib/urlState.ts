/** 선택 상태를 URL 해시(#v=<videoId>&c=<candidateId>)에 보존해 새로고침 후에도 같은 영상·후보를 다시 연다. */
export interface SelectionState {
  readonly videoId: string | null;
  readonly candidateId: string | null;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const ENTITY_ID = /^[A-Za-z0-9_-]{3,64}$/;

export function readSelection(): SelectionState {
  try {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const v = params.get('v');
    const c = params.get('c');
    return { videoId: v && VIDEO_ID.test(v) ? v : null, candidateId: c && ENTITY_ID.test(c) ? c : null };
  } catch {
    return { videoId: null, candidateId: null };
  }
}

export function writeSelection({ videoId, candidateId }: SelectionState): void {
  try {
    const params = new URLSearchParams();
    if (videoId) params.set('v', videoId);
    if (videoId && candidateId) params.set('c', candidateId);
    const hash = params.toString();
    const url = `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ''}`;
    window.history.replaceState(null, '', url);
  } catch {
    // 히스토리 API를 쓸 수 없는 환경 — 보존 없이 계속 동작한다.
  }
}
