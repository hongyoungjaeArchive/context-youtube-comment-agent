import { CheckCircle2, Circle, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react';
import { STRATEGY_LABEL, type CandidateDTO, type HardCheckDTO, type ReviewDTO } from '@context/shared';
import { QUALITY_ITEMS, REVIEW_STATUS } from '../../lib/status.ts';
import { cx } from '../../lib/format.ts';
import { Badge } from '../ui/primitives.tsx';

interface Props {
  readonly candidate: CandidateDTO;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
}

const HARD_ICON = {
  PASS: <ShieldCheck size={12} className="text-success" aria-label="PASS" />,
  WARN: <TriangleAlert size={12} className="text-warning" aria-label="WARN" />,
  BLOCK: <ShieldAlert size={12} className="text-danger" aria-label="BLOCK" />,
} as const;

function HardChecks({ checks }: { checks: readonly HardCheckDTO[] }) {
  if (checks.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-[12px]">
      {checks.map((c) => (
        <li key={c.code} className="flex items-start gap-1.5">
          <span className="mt-[3px]">{HARD_ICON[c.state]}</span>
          <span className={cx(c.state === 'BLOCK' ? 'text-danger' : c.state === 'WARN' ? 'text-warning' : 'text-muted')}>
            <span className="font-mono text-[10.5px] opacity-80">{c.state}</span> {c.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Ratings({ review }: { review: ReviewDTO }) {
  return (
    <dl className="grid grid-cols-1 gap-1">
      {QUALITY_ITEMS.map((item) => {
        const r = review.ratings[item.key];
        const rating = r?.rating ?? null;
        return (
          <div key={item.key} className="grid grid-cols-[88px_56px_1fr] items-start gap-2 text-[12px]">
            <dt className="text-muted">
              {item.label} <span className="text-[10.5px] opacity-70 tnum">{item.weight}</span>
            </dt>
            <dd className="flex items-center gap-1 tnum" aria-label={`${item.label} ${rating === null ? '평가 불가' : `${rating}/5`}`}>
              {rating === null ? (
                <span className="text-warning">불가</span>
              ) : (
                <>
                  <span className="flex gap-px" aria-hidden>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span key={n} className={cx('h-2.5 w-1.5 rounded-sm', n <= rating ? 'bg-accent' : 'bg-fg/10')} />
                    ))}
                  </span>
                  <span className="text-[11px] text-muted">{rating}</span>
                </>
              )}
            </dd>
            <dd className="text-muted leading-[1.45]">{r?.reason ?? '—'}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** 평가표 "영상 속 구체적인 장면·말"에 해당하는 근거 한 줄을 바로 보여준다. */
function SceneLine({ checks }: { checks: readonly HardCheckDTO[] }) {
  const scene = checks.find((c) => c.code === 'SCENE_REFERENCE');
  if (!scene) return null;
  return (
    <p data-testid="scene-line" className={cx('flex items-center gap-1.5 text-[12.5px]', scene.state === 'PASS' ? 'text-success' : 'text-warning')}>
      {HARD_ICON[scene.state]} {scene.message}
    </p>
  );
}

function ReviewBlock({ review }: { review: ReviewDTO | null }) {
  if (!review) {
    return (
      <div data-testid="review-status" className="flex items-center gap-1.5 rounded-lg border border-dashed border-warning/40 px-2.5 py-1.5 text-[12.5px] text-warning">
        <TriangleAlert size={13} aria-hidden /> 평가 없음 — 재검증 필요
      </div>
    );
  }
  const meta = REVIEW_STATUS[review.status];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span data-testid="candidate-score" className={cx('text-[20px] font-bold leading-none tnum', review.stale && 'line-through opacity-50')}>
          {review.score === null ? '—' : review.score}
          <span className="text-[12px] font-medium text-muted">/100</span>
        </span>
        <Badge tone={review.stale ? 'neutral' : meta.tone} icon testId="review-status" className={review.stale ? 'line-through' : undefined}>
          {review.status} · {meta.label}
        </Badge>
        {review.mode === 'MOCK' ? <Badge tone="warning">모의 평가</Badge> : null}
        {review.stale ? (
          <Badge tone="warning" icon>
            근거 변경으로 무효
          </Badge>
        ) : null}
      </div>
      <SceneLine checks={review.hardChecks} />
      <details className="group" onClick={(e) => e.stopPropagation()}>
        <summary className="cursor-pointer list-none text-[12px] text-muted hover:text-fg">점수 근거 보기 ▾</summary>
        <div className="mt-2 space-y-2">
          <Ratings review={review} />
          <HardChecks checks={review.hardChecks} />
        </div>
      </details>
      {review.riskFlags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {review.riskFlags.map((f) => (
            <Badge key={f} tone="danger">
              위험: {f}
            </Badge>
          ))}
        </div>
      ) : null}
      {review.improvement ? <p className="rounded-md bg-bg/50 px-2 py-1.5 text-[12px] text-muted">개선 제안: {review.improvement}</p> : null}
    </div>
  );
}

export function CandidateCard({ candidate, selected, onSelect }: Props) {
  const rev = candidate.latestRevision;
  const isOperatorVersion = rev.editedBy === 'OPERATOR';
  return (
    <article
      data-testid={`candidate-card-${candidate.strategy}`}
      data-selected={selected}
      onClick={() => onSelect(candidate.id)}
      className={cx(
        'lift cursor-pointer rounded-card border p-3.5',
        selected ? 'border-accent/70 bg-accent/[0.07] shadow-[0_0_0_1px_var(--color-accent)]' : 'border-line bg-elevated/50 hover:border-line-strong',
      )}
    >
      <header className="mb-2 flex items-center gap-1.5">
        <button
          type="button"
          aria-pressed={selected}
          onClick={(e) => {
            e.stopPropagation();
            onSelect(candidate.id);
          }}
          className="inline-flex items-center gap-1.5 rounded-md text-[13.5px] font-semibold"
        >
          {selected ? <CheckCircle2 size={15} className="text-accent" aria-hidden /> : <Circle size={15} className="text-muted" aria-hidden />}
          {STRATEGY_LABEL[candidate.strategy]}
          <span className="sr-only">{selected ? '(선택됨)' : '(선택 안 됨)'}</span>
        </button>
        <span className="ml-auto flex items-center gap-1">
          <Badge tone={isOperatorVersion ? 'accent' : 'neutral'}>
            v{rev.versionNo} {isOperatorVersion ? '운영자' : 'AI'}
          </Badge>
          <Badge tone={rev.staticCheck.ok ? 'neutral' : 'danger'} icon={!rev.staticCheck.ok}>
            {rev.staticCheck.charCount}자
          </Badge>
        </span>
      </header>
      {candidate.noFit ? (
        <p className="mb-2 rounded-md bg-warning/10 px-2 py-1 text-[12px] text-warning">영상 맥락과 브랜드 연결이 약함 (no-fit) — 사용 전 검토 필요</p>
      ) : null}
      <p className="mb-2.5 whitespace-pre-wrap rounded-lg bg-bg/60 px-3 py-2 text-[13.5px] leading-[1.6]">{rev.content}</p>
      {candidate.rationale ? <p className="mb-2.5 text-[12px] text-muted">추천 이유: {candidate.rationale}</p> : null}
      <ReviewBlock review={candidate.review} />
    </article>
  );
}
