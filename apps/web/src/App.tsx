import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { VideoDTO } from '@context/shared';
import { api } from './api/client.ts';
import { useHealth, useVideos } from './api/queries.ts';
import { ActivityCenter } from './components/activity/ActivityCenter.tsx';
import { AnalysisPanel } from './components/analysis/AnalysisPanel.tsx';
import { VideoPanel } from './components/discovery/VideoPanel.tsx';
import { EvalLabModal } from './components/eval/EvalLabModal.tsx';
import { ExecutionPanel } from './components/execution/ExecutionPanel.tsx';
import { GlobalHeader, type ModalKey } from './components/header/GlobalHeader.tsx';
import { HistoryModal } from './components/modals/HistoryModal.tsx';
import { ProfilesModal } from './components/modals/ProfilesModal.tsx';
import { SettingsModal } from './components/modals/SettingsModal.tsx';
import { TargetsModal } from './components/modals/TargetsModal.tsx';
import { SageGreeting } from './components/sage/SageGreeting.tsx';
import { SageLauncher } from './components/sage/SageLauncher.tsx';
import { SagePanel, type SageRequest } from './components/sage/SagePanel.tsx';
import { cx } from './lib/format.ts';
import { readSelection, writeSelection } from './lib/urlState.ts';

type Column = 'discover' | 'analyze' | 'execute';
const COLUMNS: readonly { key: Column; label: string }[] = [
  { key: 'discover', label: '1 영상 탐색' },
  { key: 'analyze', label: '2 AI 분석·댓글' },
  { key: 'execute', label: '3 승인·실행' },
];

export function App() {
  const health = useHealth();
  const [modal, setModal] = useState<ModalKey | null>(null);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(() => readSelection().videoId);
  const [analysisOverride, setAnalysisOverride] = useState<Readonly<Record<string, string>>>({});
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(() => readSelection().candidateId);
  const [column, setColumn] = useState<Column>(() => (readSelection().videoId ? 'analyze' : 'discover'));

  useEffect(() => {
    writeSelection({ videoId: selectedVideoId, candidateId: selectedCandidateId });
  }, [selectedVideoId, selectedCandidateId]);

  // 영상 목록 캐시를 공유한다 (같은 queryKey). 선택 영상은 목록에서 찾는다.
  const videos = useVideos('recommended', false);
  const listed = videos.data?.videos.find((v) => v.videoId === selectedVideoId) ?? null;
  // 목록에 없는 영상(새로고침 직후 등)은 단건으로 다시 조회한다.
  const single = useQuery({
    queryKey: ['video', selectedVideoId ?? 'none'],
    queryFn: () => api.get<VideoDTO>(`/api/videos/${encodeURIComponent(selectedVideoId ?? '')}`),
    enabled: selectedVideoId !== null && videos.isSuccess && listed === null,
    retry: false,
  });
  const video = listed ?? single.data ?? null;
  const analysisId = selectedVideoId ? (analysisOverride[selectedVideoId] ?? video?.latestAnalysisId ?? null) : null;

  const handleSelectVideo = useCallback((id: string) => {
    setSelectedVideoId(id);
    setSelectedCandidateId(null);
    setColumn('analyze');
  }, []);
  const handleAnalysisId = useCallback((videoId: string, id: string) => {
    setAnalysisOverride((prev) => ({ ...prev, [videoId]: id }));
    setSelectedCandidateId(null);
  }, []);
  const handleSelectCandidate = useCallback((id: string) => setSelectedCandidateId(id), []);
  const closeModal = useCallback(() => setModal(null), []);
  const openEvalLab = useCallback(() => setModal('eval'), []);

  const [sageOpen, setSageOpen] = useState(false);
  const [sageQuestion, setSageQuestion] = useState<SageRequest | null>(null);
  const sageRequestSeq = useRef(0);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const openSage = useCallback(() => setSageOpen(true), []);
  const askSage = useCallback((question: string) => {
    sageRequestSeq.current += 1;
    setSageQuestion({ id: sageRequestSeq.current, text: question });
    setSageOpen(true);
  }, []);
  const closeSage = useCallback(() => {
    setSageOpen(false);
    setSageQuestion(null);
    // 닫은 뒤 다시 그려지는 런처로 포커스를 돌려준다.
    requestAnimationFrame(() => launcherRef.current?.focus());
  }, []);

  const colClass = (key: Column) => cx('min-h-[560px] lg:min-h-0', column === key ? 'flex' : 'hidden', 'lg:flex');

  return (
    <div className={cx('flex min-h-screen flex-col lg:h-screen lg:min-h-[720px]', sageOpen && 'lg:pr-[380px]')}>
      <GlobalHeader health={health.data} healthError={health.isError} onOpen={setModal} onAskSage={askSage} />

      <nav aria-label="열 전환" className="flex gap-1 px-4 pt-3 lg:hidden">
        {COLUMNS.map((c) => (
          <button
            key={c.key}
            type="button"
            aria-pressed={column === c.key}
            onClick={() => setColumn(c.key)}
            className={cx('h-9 flex-1 rounded-lg border text-[12.5px]', column === c.key ? 'border-accent/60 bg-accent/10 text-fg' : 'border-line text-muted')}
          >
            {c.label}
          </button>
        ))}
      </nav>

      <main className="grid flex-1 gap-4 p-4 lg:min-h-0 lg:grid-cols-[29fr_43fr_28fr] lg:p-5">
        <VideoPanel selectedVideoId={selectedVideoId} onSelect={handleSelectVideo} className={colClass('discover')} />
        <AnalysisPanel
          key={selectedVideoId ?? 'none'}
          video={video}
          analysisId={analysisId}
          onAnalysisId={handleAnalysisId}
          selectedCandidateId={selectedCandidateId}
          onSelectCandidate={handleSelectCandidate}
          className={colClass('analyze')}
        />
        <ExecutionPanel analysisId={analysisId} candidateId={selectedCandidateId} className={colClass('execute')} />
      </main>

      {/* 런처가 Activity Center 오른쪽 글자를 가리지 않도록 자리를 비워 둔다. lg:px-5가 오른쪽 여백을 덮어쓰므로 lg:pr도 필요하다. */}
      <div className={cx('shrink-0 px-4 pb-4 lg:px-5 lg:pb-5', !sageOpen && 'pr-[168px] lg:pr-[168px]')}>
        <ActivityCenter />
      </div>

      <SettingsModal open={modal === 'settings'} onClose={closeModal} onOpenEvalLab={openEvalLab} />
      <ProfilesModal open={modal === 'profiles'} onClose={closeModal} />
      <TargetsModal open={modal === 'targets'} onClose={closeModal} />
      <HistoryModal open={modal === 'history'} onClose={closeModal} />
      <EvalLabModal open={modal === 'eval'} onClose={closeModal} />

      <SageGreeting />
      {sageOpen ? null : <SageLauncher ref={launcherRef} onOpen={openSage} />}
      <SagePanel open={sageOpen} onClose={closeSage} selectedVideoId={selectedVideoId} initialQuestion={sageQuestion} />
    </div>
  );
}
