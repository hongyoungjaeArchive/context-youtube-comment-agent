import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Quote, Trash2 } from 'lucide-react';
import { TRUST_GRADE_LABEL, type AnalysisDTO, type EvidenceDTO, type TrustGrade } from '@context/shared';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { qk } from '../../api/queries.ts';
import { EVIDENCE_STATE } from '../../lib/status.ts';
import { stripEvidenceIds } from '../../lib/evidenceText.ts';
import { TIMESTAMP_PATTERN, cx } from '../../lib/format.ts';
import { Badge, Button, Notice, SectionLabel, type Tone } from '../ui/primitives.tsx';
import { ServerError, inputClass } from '../ui/overlay.tsx';

interface Props {
  readonly videoId: string;
  readonly analysis: AnalysisDTO | undefined;
}

const GRADE_TONE: Record<TrustGrade, Tone> = { A: 'success', B: 'accent', C: 'neutral', D: 'warning' };
const SOURCE_LABEL: Record<EvidenceDTO['sourceType'], string> = {
  TITLE: '제목',
  DESCRIPTION: '설명',
  COMMENT: '시청자 댓글',
  OPERATOR_QUOTE: '운영자 직접 확인',
  TRANSCRIPT: '자막',
};

function EvidenceRow({ ev, onRemove, removing }: { ev: EvidenceDTO; onRemove: (id: string) => void; removing: boolean }) {
  return (
    <li className="flex gap-2.5 rounded-lg border border-line bg-bg/40 px-3 py-2">
      <Badge tone={GRADE_TONE[ev.trustGrade]} className="mt-0.5 h-fit">
        {TRUST_GRADE_LABEL[ev.trustGrade]}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 break-words">{ev.text}</p>
        <p className="mt-0.5 text-[11.5px] text-muted tnum">
          {SOURCE_LABEL[ev.sourceType]}
          {ev.timestamp ? ` · ${ev.timestamp}` : ''}
          {ev.verifiedBy ? ` · ${ev.verifiedBy}` : ''}
        </p>
      </div>
      {ev.sourceType === 'OPERATOR_QUOTE' ? (
        <button
          type="button"
          onClick={() => onRemove(ev.id)}
          disabled={removing}
          aria-label="이 근거 삭제"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-danger/15 hover:text-danger disabled:opacity-40"
        >
          <Trash2 size={13} aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

function QuoteForm({ videoId }: { videoId: string }) {
  const [text, setText] = useState('');
  const [timestamp, setTimestamp] = useState('');
  const tsTrim = timestamp.trim();
  const tsInvalid = tsTrim.length > 0 && !TIMESTAMP_PATTERN.test(tsTrim);
  const add = useApiMutation(
    (body: { text: string; timestamp: string | null }) => api.post<EvidenceDTO>(`/api/videos/${videoId}/evidence`, body),
    {
      invalidate: [['evidence', videoId], ['analysis'], ['videos']],
      onSuccess: () => {
        setText('');
        setTimestamp('');
      },
    },
  );
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 4 || tsInvalid) return;
    add.mutate({ text: text.trim(), timestamp: tsTrim || null });
  };
  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-lg border border-success/20 bg-success/[0.04] p-3">
      <p className="flex items-center gap-1.5 text-[12.5px] font-semibold">
        <Quote size={13} aria-hidden className="text-success" />
        영상에서 직접 확인한 발언 추가 <Badge tone="success">A 직접확인</Badge>
      </p>
      <div className="grid grid-cols-[minmax(0,1fr)_84px_auto] gap-1.5">
        <label className="sr-only" htmlFor="evidence-quote-text">
          확인한 발언
        </label>
        <input
          id="evidence-quote-text"
          data-testid="evidence-quote-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={300}
          placeholder="영상에서 실제로 들은 발언 (4~300자)"
          className={inputClass}
        />
        <label className="sr-only" htmlFor="evidence-quote-timestamp">
          타임스탬프 (mm:ss)
        </label>
        <input
          id="evidence-quote-timestamp"
          data-testid="evidence-quote-timestamp"
          value={timestamp}
          onChange={(e) => setTimestamp(e.target.value)}
          maxLength={8}
          placeholder="mm:ss"
          aria-invalid={tsInvalid}
          className={cx(inputClass, 'px-1 text-center tnum', tsInvalid && 'border-danger/60')}
        />
        <Button type="submit" data-testid="evidence-quote-add" loading={add.isPending} disabled={text.trim().length < 4 || tsInvalid}>
          추가
        </Button>
      </div>
      {tsInvalid ? <p className="text-[12px] text-danger">타임스탬프는 mm:ss 또는 h:mm:ss 형식입니다.</p> : null}
      <p className="text-[12px] text-muted">근거를 추가·삭제하면 기존 품질 평가가 무효(stale)가 되고 해당 영상의 승인도 무효화됩니다. 다시 분석 또는 재검증이 필요합니다.</p>
      <ServerError error={add.error} />
    </form>
  );
}

export function EvidencePanel({ videoId, analysis }: Props) {
  const evidence = useQuery({
    queryKey: ['evidence', videoId],
    queryFn: () => api.get<{ evidence: readonly EvidenceDTO[] }>(`/api/videos/${videoId}/evidence`),
  });
  const remove = useApiMutation((id: string) => api.del<{ ok: true }>(`/api/evidence/${id}`), {
    invalidate: [['evidence', videoId], ['analysis'], qk.targets],
  });
  const list = evidence.data?.evidence ?? analysis?.evidence ?? [];
  const state = analysis ? EVIDENCE_STATE[analysis.evidenceState] : null;

  return (
    <section aria-label="근거" className="space-y-2.5">
      <SectionLabel right={state ? <Badge tone={state.tone} icon testId="evidence-state">{analysis?.evidenceState} · {state.label}</Badge> : null}>
        근거 <span className="tnum">{list.length}</span>
      </SectionLabel>
      {list.length === 0 ? (
        <Notice tone="warning">아직 수집된 근거가 없습니다. 분석을 시작하면 제목·설명·댓글이 근거로 수집됩니다.</Notice>
      ) : (
        <ul className="space-y-1.5">
          {list.map((ev) => (
            <EvidenceRow key={ev.id} ev={ev} onRemove={(id) => remove.mutate(id)} removing={remove.isPending} />
          ))}
        </ul>
      )}
      <ServerError error={remove.error} />
      {analysis && analysis.audienceInsights.length > 0 ? (
        <Notice tone="neutral">
          <p className="font-semibold">시청자 반응 요약</p>
          <ul className="list-disc pl-4">
            {analysis.audienceInsights.map((i) => (
              <li key={i}>{stripEvidenceIds(i)}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {analysis && analysis.limitations.length > 0 ? (
        <Notice tone="warning">
          <p className="font-semibold">분석 한계</p>
          <ul className="list-disc pl-4">
            {analysis.limitations.map((l) => (
              <li key={l}>{stripEvidenceIds(l)}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {analysis && analysis.requestedChecks.length > 0 ? (
        <Notice tone="accent">
          <p className="font-semibold">운영자 확인 요청</p>
          <ul className="list-disc pl-4">
            {analysis.requestedChecks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <QuoteForm videoId={videoId} />
    </section>
  );
}

