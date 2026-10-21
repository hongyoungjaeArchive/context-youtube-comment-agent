# 구현 상태 · 요구사항 대응 (feat/full-build, 2026-10-21 KST)

> 2026-10-21 최신 실측: typecheck 0 · 단위 151개 통과 · E2E 13개 통과 · secret-scan 0건. 추가: 공개 자막 수집(REQ-CTX), 프롬프트 B-2.0·통과선 70, ② 자동 분석·추천 초안, 뜨기 직전 찾기(REQ-TREND-001 → 검색·초안 전용·승인 차단). **실제 YouTube 게시 1회 성공**(본인 테스트 영상 -FmXpsRA-BM, SUCCESS, 로그아웃 브라우저로 독립 확인 — LOCAL_VERIFICATION 8-4).

> 이 문서는 **실제로 실행해 확인한 것**만 "통과"로 적는다. 사람이 확인해야 하는 항목은 `docs/LOCAL_VERIFICATION.md`.
> 자동 테스트 결과는 아래 명령의 실측 출력 기준이며, 모든 자동 테스트는 모의 Provider·합성 데이터·로컬 픽스처만 사용한다(실제 YouTube 게시·Claude 과금 없음).

## 1. 자동 검증 결과 (실측)

| 명령 | 결과 |
|---|---|
| `npm run typecheck` (shared·server·web) | 오류 0 |
| `npm run build` | shared·server·web 빌드 성공 (web 번들 461 KB, gzip 138 KB) |
| `npm test` (Vitest) | 12개 파일, **99개 테스트 통과** (약 70초 — 실제 Chromium 픽스처 테스트 포함) |
| `npx vitest run --coverage` (server+shared) | Lines 86.91% · Statements 83.06% · Functions 86.44% · Branches 64.89% |
| `npm run test:e2e` (Playwright UI) | **9개 통과** (1440px, 모의 AI·합성 영상·픽스처 게시) |
| `npm run secret-scan` | 검사 파일 209개, 키 형태 문자열 0건 |
| 런처 실행 (`scripts/setup.sh` → `start.sh` → `stop.sh`, 셸에서 실행) | Setup 전 단계 ✔, health `LOCAL_READY`, 재실행 시 중복 서버 없음, 대시보드 HTTP 200, 종료 후 포트 해제, 데이터 폴더 700·DB 600, 서버 로그 키 문자열 0건 |

Finder 더블클릭(`.command`)과 Gatekeeper 동작은 사람이 확인해야 한다 (LOCAL_VERIFICATION 1).

## 2. 실제 외부 서비스 호출 이력 (정직 기록)

| 대상 | 횟수·결과 | 비용 |
|---|---|---|
| YouTube Data API | 5개 채널 최신 영상 조회 1회(영상 50개, LIST_READY) + 키 확인 2회 + URL 확인 1회 + 댓글 조회 2회 | 무료 쿼터 (약 20 unit) |
| **Anthropic API (종량 과금)** | **`messages` 3회** (Sonnet 5.5, 1회 분석: Context·Marketing·Quality) + `models.retrieve` 1회 (토큰 비용 없는 키 확인). 모두 비용 0원 원칙 적용 **이전**. 이후 0회 | 앱 추정 USD 0.066 (실제 청구액은 Console에서 확인 필요) |
| Claude Code CLI (`claude -p`, 구독) | 형식 확인 1회(Haiku) + 1회 분석(Sonnet 3회 호출) | 추가 청구 없음 (Claude Code 보고 API 환산 참고값 USD 0.115) |

두 번의 실제 분석 모두 A 등급(직접 확인 발언) 근거가 없어 Quality가 3개 후보 전부를 **FAIL(SCENE_REFERENCE WARN)** 로 보류했다 — 설계대로이며, 실제 PASS 후보·실제 게시는 아직 관찰하지 않았다.

## 3. 요구사항 ↔ 구현 ↔ 검증

| REQ | 구현 위치 | 자동 검증 | 상태 |
|---|---|---|---|
| REQ-VID-001 지정 5채널 최신 영상 | `agents/research.ts` refreshVideos, `clients/youtube.ts`(키는 X-Goog-Api-Key 헤더) | orchestrator.test(키 URL 미노출·채널 불변), api.test, E2E | 통과 + 실제 API 1회 확인 |
| REQ-VID-002 URL 직접 입력·채널 검사 | `inspectUrl`, `shared/videoUrl.ts` | commentRules.test, api.test | 통과 + 실제 1회 |
| REQ-CTX-001 고민 한 줄·근거 | `agents/context.ts` | orchestrator.test, E2E | 통과 (실제 Claude 2회 생성 확인) |
| REQ-CTX-002 근거 등급·환각 방지 | `services/evidence.ts`(A~D), `validateContext`, Quality QUOTE_MATCH/SCENE_REFERENCE | quality.test, F03, evalLab S01/S02 | 통과 |
| REQ-CMT-001/002 40~120자·장면 언급·링크/해시태그/후기 금지 | `shared/commentRules.ts`, `agents/quality.ts` hardChecks | commentRules.test, quality.test | 통과 |
| REQ-CMT-003 전략 3개+평가 | `agents/marketing.ts`, `agents/quality.ts`(가중 100점) | orchestrator.test, E2E | 통과 |
| REQ-CMT-004 편집 시 재검증·재승인 | `createRevision`(불변 revision·승인 무효화), 승인 해시·근거 스냅샷 결속 | api.test, F04/F05, E2E | 통과 |
| REQ-EXE-001 Chrome 프로필·한 글자 입력·게시·확인 | `execution/playwrightDriver.ts`(persistent context, channel=chrome) | browser.e2e(실제 Chromium·픽스처), E2E | **픽스처에서만 통과 — 실제 YouTube 미검증** |
| REQ-EXE-002 단계 상태·실패 이유·스크린샷 | `executor.ts` events·artifacts | browser.e2e, F09 | 통과 (픽스처) |
| REQ-EXE-003 허용 범위·본인 테스트 영상 서버 강제 | `targets.ts`(API 채널 일치+서약), Preflight `isPostableUrl` | api.test | 통과 (실영상 소유 확인은 미검증) |
| REQ-EXE-004 영상당 1개·하루 10개·시간순 기록 | `posting_claims` UNIQUE, `daily_usage` 조건부 증가(Asia/Seoul) | F06, F07, api.test | 통과 |
| REQ-EXE-005 UNKNOWN 재게시 금지 | 제출 직전 SUBMIT_ATTEMPTED 기록, 재시작 복구, 수동 확인만 | F08, browser.e2e(hang), E2E | 통과 |
| REQ-PRO-001 프로필 최대 3·수동 선택 | `profiles.ts`, `profileSession.ts`(직접 로그인 창·쿠키 이름만 확인) | api.test(기본 유튜브1) | 부분 — 로그인 창·인증 확인은 미검증 |
| REQ-TREND-001 뜨기 직전 영상(초안까지) | `computeTrend` | quality.test | 통과 |
| REQ-OPS-001 큐·모델 분담·예산·캐시·복구 | `orchestrator/*` (P0~P5, lease, 429/5xx 재시도는 큐에서만, 모델 대체, 결과 캐시, 종량 과금만 예산) | orchestrator.test, F01/F02, provider.test | 통과 |
| REQ-DATA-001 SQLite 버전·승인·이력·감사 | `db/migrations.ts`(WAL, FK, UNIQUE), `lib/audit.ts`, 보관 정책 | F10(백업·복원), retention.test | 통과 |
| REQ-SEC-001 Keychain·마스킹·로컬 접근 통제 | `security/*`, `localGuard`(Host/Origin/Sec-Fetch-Site/CSRF), CLI 자식 env에서 API 키 제거 | security.test(실제 Keychain 왕복, 별도 서비스명), api.test, claudeCli.test | 통과 |
| REQ-EVAL-001 15개 데이터셋·A/B·회귀·장애 주입·사람 비교 | `eval/*`, `evaluation/golden/dataset.json` | evalLab.test, scenarios.test(10/10) | 구조·엔진 통과 / **골든 15개 실데이터·실측 품질 NOT MEASURED** |
| REQ-UX-001 3열 동선 | `apps/web` | E2E 9개 | 자동 통과 / 처음 보는 사용자 테스트 미실시 |
| REQ-UX-002 밝은 테마·움직임 | `apps/web/src/index.css` 토큰·`.blur-in`/`.stagger`/`.lift` | E2E 11개(TEST-UX-02), greetingFlag.test 3개, 대비 계산(전 토큰 ≥4.9:1) | 통과 / 실제 Safari·Firefox 미확인 |
| REQ-UX-003 Sage 비서 | `services/sage.ts`, `POST /api/sage/ask`, `components/sage/*` | sage.test 8개(TEST-SAGE-01), E2E 2개 | 모의 모드 통과 / **실제 `claude -p` 답변 품질 미검증** |
| REQ-BUILD-001 Setup·.command·Git | `scripts/*`, `*.command` | 셸 실행 확인 | 부분 — 더블클릭 미확인 |
| REQ-DOC-001 시연 영상·제작 의도 | — | — | 미착수 (앱 외부 작업) |

## 4. 독립 보안 리뷰 (읽기 전용 리뷰 에이전트, 2026-10-20)

- HIGH 1건 **수정 완료**: `/%61pi/...` 퍼센트 인코딩 경로로 Origin·CSRF 검사를 건너뛸 수 있었음 → 경로와 무관하게 모든 변경 요청에 Origin+CSRF 적용 (api.test에 회귀 테스트 추가).
- 함께 수정: 모델 ID 형식 검증(CLI 플래그 주입 방지), 게시 전 대상 영상 URL 리디렉션 검사.
- 남은 MEDIUM/LOW (미수정, 로컬 확인 필요): Keychain 항목 ACL — 같은 사용자 프로세스가 `security`로 프롬프트 없이 읽을 수 있는지 미확인 / 게시 확인이 원문 일치 기준이라 동일 문장이 이미 있으면 오탐 가능 / `security -i` 인용 처리 가정은 실제 Keychain 왕복 테스트로만 확인.
- 영상당 1개·일일 한도·UNKNOWN 재게시 금지·승인 해시 결속: 우회 경로 없음으로 보고됨.

## 5. 알려진 한계

- 실제 YouTube 게시 확인은 "댓글 목록에 같은 원문이 보임" 기준. 작성자는 표시 이름만 기록하고 채널 ID까지 대조하지 않는다.
- 자막 원문은 권한 문제로 자동 수집하지 않는다. A 등급 근거는 운영자가 영상을 보고 직접 입력해야 하며, 입력 내용의 진위는 앱이 검증할 수 없다(입력자 책임 — UI에 안내).
- 모의 Provider는 프롬프트 버전 차이를 반영하지 않으므로 MOCK A/B는 파이프라인 동작 확인용이다.
- Claude Code CLI Provider의 구독 사용량 한도는 앱이 알 수 없다. 429는 RETRY_SCHEDULED로 처리한다.
- web 번들에 zod가 포함되어 크다(gzip 138 KB). 로컬 앱이라 영향은 작다.
