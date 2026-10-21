const EVIDENCE_IDS = /\s*[(（]?\bev_[0-9a-f]{6,}\b(?:,\s*ev_[0-9a-f]{6,})*[)）]?/g;

/** AI 설명에 섞여 나오는 내부 근거 ID(ev_…)는 사람에게 의미가 없어 지운다. */
export function stripEvidenceIds(text: string): string {
  return text.replace(EVIDENCE_IDS, '').trim();
}
