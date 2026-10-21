# 15. 문서 정본·버전·출시 검증 계약

## 1. 단일 정본

Markdown만 편집. PDF는 Markdown을 합쳐 만든 파생 문서. `CLAUDE.md`는 규칙/참조 목록이므로 상세 문서와 모순을 만들지 않는다.

우선순위: 플랫폼/법령 안전 정책 → 공식 과제 필수 요구 → 1~17차 확정 결정 → 최신 승인 Markdown 명세 → 파생 PDF. 서로 충돌할 때는 추측 금지, 명세 변경 기록/승인.

## 2. 릴리스 메타데이터

| 항목 | 값 |
|---|---|
| spec_version | `PLAN-1.0` |
| spec_date | `2026-10-20` |
| timezone | Asia/Seoul |
| primary_artifact | `docs/*.md` |
| summary_artifact | `deliverables/CONTEXT_MASTER_PLAN.pdf` |
| entry_contract | `CLAUDE.md` |
| dev_status | `NOT STARTED` |
| eval_status | `NOT RUN` |
| official_deadline | 2026-10-20, 시각 미확인 |

## 3. 문서 검증

1. `00_DECISION_LOG`의 17개 결정이 01~14 문서와 충돌하지 않는지 검토.
2. PDF 요구사항(`02_REQUIREMENTS_MATRIX`)에 ID·수용 기준·테스트·시연 근거가 있는지 확인.
3. 영상·댓글의 실제 근거 검증 및 외부 홍보 제한을 전 문서에서 일관적으로 표현.
4. 모델/요금/외부 API 제약은 참조 링크·재검증 날짜·상태를 표기.
5. PDF 표·링크·한글 렌더링·목차를 시각 검사.
6. Git 제출 전 secret scan, 모의 데이터와 실제 데이터 분리.

## 4. 개발 마일스톤 (15차 A안 Full Build)

- **M0 Spec Freeze:** 전체 요구사항·DB·API·UI·테스트 계약 동결.
- **M1 Foundation:** 앱·DB·보안·UI 기반을 하나의 프로젝트로 구성.
- **M2 Full Integration:** 5개 에이전트·오케스트레이터·브라우저·Eval Lab 전부 기능 구현.
- **M3 Live Verification:** 실제 데이터를 이용한 분석과 본인 테스트 영상 게시 검증.
- **M4 Full Validation:** A/B·회귀·보안·장애 주입 및 보고서.
- **M5 Release:** 원클릭 실행, Git, 시연 영상, 제작 의도, 마지막 평가표 대조.

모든 기능이 최종 범위에 포함되고, 중간 구현 순서는 일괄 개발 목표의 안전한 내부 관리 수단이다.

## 5. 지금 전달 가능한 것 / 없는 것

| 구분 | 상태 |
|---|---|
| 전체 사양 Markdown | 생성 완료(문서 패키지 생성 후) |
| PDF 통합본 | 생성 완료(렌더 검증 후) |
| CLAUDE.md | 개발 규칙 문서 |
| 실제 앱 코드 | **없음** |
| 밝은 테마·Sage 비서 (REQ-UX-002/003) | 구현·자동 테스트 통과(2026-10-21), 실제 Claude 답변 품질 미검증 |
| 실제 게시 성공 증거 | **없음** |
| AI 품질 실측 보고서 | **없음** |
| 제출 완료 증빙 | **없음** |

## 6. 위험 등록부

| 위험 | 영향 | 통제 |
|---|---|---|
| 당일 마감 vs Full Build | 시간상 미구현·검증 부족 | 정직한 진행 상태·실제 영상 우선 |
| 제3자 자막 접근 불가 | 구체적 발언 검증 실패 | 소유 권한 있는 자료/사람 확인, 미확인 차단 |
| 자동 댓글 스팸 정책 | 계정 제재·과제 구현과 충돌 | 테스트 영상만 자동 게시, 실제 외부는 투명한 초안 |
| Claude 응답 환각 | 평가 항목 위반 | Evidence IDs·원문 대조·사람 승인 |
| 브라우저 게시 모호성 | 중복 게시 | UNKNOWN, 원자적 posting claim |
| API 크레딧/모델 변경 | 실행·비용 실패 | 연결 점검·예산 제한·버전 관리 |
| 로컬 API 오용 | 원치 않는 실행 | Origin/CSRF/session/서버 재검증 |
| 데이터·키 유출 | 정보 노출 | Keychain·권한·로그 마스킹·Git 검사 |
