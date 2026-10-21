import { useState } from 'react';
import { RefreshCcw, Save } from 'lucide-react';
import { COMMENT_RULES, STRATEGY_LABEL, checkCommentStatic, type CandidateDTO, type RevisionDTO } from '@context/shared';
import { api } from '../../api/client.ts';
import { useApiMutation } from '../../api/mutations.ts';
import { qk } from '../../api/queries.ts';
import { cx } from '../../lib/format.ts';
import { Badge, Button, Notice, SectionLabel, type Tone } from '../ui/primitives.tsx';
import { ServerError } from '../ui/overlay.tsx';

export type EditorState = 'CLEAN' | 'DIRTY' | 'STATIC_ERROR' | 'REVALIDATING' | 'READY';

interface Props {
  readonly candidate: CandidateDTO;
  readonly analysisId: string;
  readonly revalidating: boolean;
  readonly onRevalidateStarted: (jobId: string) => void;
}

const STATE_META: Record<EditorState, { tone: Tone; label: string }> = {
  CLEAN: { tone: 'neutral', label: '저장됨 · 평가 필요' },
  DIRTY: { tone: 'warning', label: '수정됨 · 저장 전' },
  STATIC_ERROR: { tone: 'danger', label: '규칙 위반' },
  REVALIDATING: { tone: 'accent', label: 'AI 재검증 중' },
  READY: { tone: 'success', label: '평가 완료' },
};

function deriveState(dirty: boolean, staticOk: boolean, revalidating: boolean, candidate: CandidateDTO): EditorState {
  if (!staticOk) return 'STATIC_ERROR';
  if (dirty) return 'DIRTY';
  if (revalidating) return 'REVALIDATING';
  if (candidate.review && !candidate.review.stale) return 'READY';
  return 'CLEAN';
}

/** 선택 후보 편집창. 저장하면 새 불변 revision이 생기고 이전 평가·승인은 무효가 된다. 자동 AI 호출은 하지 않는다. */
export function CommentEditor({ candidate, analysisId, revalidating, onRevalidateStarted }: Props) {
  const saved = candidate.latestRevision;
  const [draft, setDraft] = useState(saved.content);
  const check = checkCommentStatic(draft);
  const dirty = draft.trim() !== saved.content.trim();
  const state = deriveState(dirty, check.ok, revalidating, candidate);
  const meta = STATE_META[state];
  const countTone = check.charCount < COMMENT_RULES.minChars || check.charCount > COMMENT_RULES.maxChars ? 'text-danger' : 'text-success';

  const save = useApiMutation((content: string) => api.post<RevisionDTO>('/api/comments/revisions', { candidateId: candidate.id, content }), {
    invalidate: [qk.analysis(analysisId), qk.health],
  });
  const revalidate = useApiMutation(() => api.post<{ jobId: string; created: boolean }>('/api/comments/revalidate', { revisionId: saved.id }), {
    invalidate: [qk.jobs],
    onSuccess: (res) => onRevalidateStarted(res.jobId),
  });

  const needsReview = !candidate.review || candidate.review.stale;

  return (
    <section aria-label="댓글 편집" className="space-y-2.5 rounded-card border border-line-strong bg-bg/50 p-3.5">
      <SectionLabel
        right={
          <Badge tone={meta.tone} icon testId="editor-state">
            {state} · {meta.label}
          </Badge>
        }
      >
        편집 — {STRATEGY_LABEL[candidate.strategy]} v{saved.versionNo}
      </SectionLabel>
      <label htmlFor="comment-editor" className="sr-only">
        댓글 편집
      </label>
      <textarea
        id="comment-editor"
        data-testid="comment-editor"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        maxLength={500}
        aria-invalid={!check.ok}
        aria-describedby="comment-editor-help"
        className={cx(
          'w-full resize-y rounded-lg border bg-bg/80 px-3 py-2.5 text-[14px] leading-[1.6] text-fg focus:outline-none focus-visible:outline-2 focus-visible:outline-accent',
          check.ok ? 'border-line-strong focus:border-accent/60' : 'border-danger/50',
        )}
      />
      <div id="comment-editor-help" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
        <span data-testid="char-count" className={cx('font-semibold tnum', countTone)}>
          {check.charCount}자 / {COMMENT_RULES.minChars}~{COMMENT_RULES.maxChars}자
        </span>
        <span className={check.mentionsBrand ? 'text-muted' : 'text-warning'}>{check.mentionsBrand ? '브랜드 언급 있음' : '브랜드(운명원) 언급 없음'}</span>
        {check.ok ? <span className="text-success">정적 규칙 통과</span> : null}
      </div>
      {check.violations.length > 0 ? (
        <ul className="space-y-0.5" data-testid="static-violations">
          {check.violations.map((v) => (
            <li key={v.code} className="text-[12px] text-danger">
              <span className="font-mono text-[10.5px]">{v.code}</span> {v.message}
            </li>
          ))}
        </ul>
      ) : null}
      {dirty ? <Notice tone="warning">저장하면 새 버전(v{saved.versionNo + 1})이 만들어지고 이전 점수·승인은 즉시 무효가 됩니다. AI 평가는 자동으로 다시 실행되지 않습니다.</Notice> : null}
      {!dirty && needsReview && !revalidating ? <Notice tone="accent">이 버전에 유효한 품질 평가가 없습니다. [AI 재검증]을 실행해야 승인할 수 있습니다.</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button data-testid="save-revision" icon={<Save size={14} aria-hidden />} onClick={() => save.mutate(draft)} loading={save.isPending} disabled={!dirty || !check.ok}>
          수정 저장
        </Button>
        <Button
          data-testid="revalidate"
          variant={needsReview ? 'primary' : 'secondary'}
          icon={<RefreshCcw size={14} aria-hidden />}
          onClick={() => revalidate.mutate()}
          loading={revalidate.isPending || revalidating}
          disabled={dirty || !check.ok}
        >
          AI 재검증
        </Button>
        {dirty ? (
          <Button variant="ghost" onClick={() => setDraft(saved.content)}>
            되돌리기
          </Button>
        ) : null}
      </div>
      <ServerError error={save.error ?? revalidate.error} />
    </section>
  );
}
