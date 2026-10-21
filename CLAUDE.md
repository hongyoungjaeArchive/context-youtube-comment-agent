# CONTEXT — Claude Code 개발 계약

> VERSION: PLAN-1.0 / 2026-10-20 KST  
> STATUS: SPECIFICATION ONLY. 이 파일은 애플리케이션 코드를 만들지 않는다.

## 핵심 목표

제이지그룹 AI PM TRACK 2 과제: 지정 5개 채널의 최신 영상 조회, 실제 근거 기반 맥락 분석, 운명원 연애 사주 관련 마케팅 댓글 초안 검증, 사람 승인, 본인 테스트 영상 Chrome 입력·게시·확인, 이력/한도/중복 관리. **기능 시연의 사실성과 영상 고유성이 최우선이다.**

## 변경 금지사항

1. 1~10차 B, 11차 D, 12차 B, 13차 B, 14차 D, 15차 A, 16차 C, 17차 C 결정을 임의 축소·변경하지 말 것.
2. 전체 기능을 하나의 최종 통합 제품으로 구현하는 **Full Build** 원칙 유지. 계획 문서에서 누락된 기능을 마치 완료된 것처럼 표시하지 말 것.
3. 메인 UI 3열: **영상 탐색 → AI 분석(고민 한 줄 + 추천 초안, 나머지 2개 초안·편집·재검증·근거는 접어서 제공) → 승인·프로필·실행 상태** (CHG-2026-10-21-09).
4. Claude API 5개 논리적 역할: Research, Context, Marketing, Quality, Execution. 실행 권한은 모델에 직접 위임하지 않고 결정적 코드와 사람의 승인을 거쳐야 함.
5. 확인하지 않은 영상 장면·발언·이용 후기·평판을 만들지 말 것. 구조화된 JSON이 사실 검증을 대체하지 못함.
6. 광고 관계를 숨기는 시청자 위장(단, 과제 기준의 시청자 페르소나 말투는 허용 — 운명원 이용 후기·효과 주장만 금지, CHG-2026-10-21-05), 반복 홍보 스팸, 계정 자동 순환, 제한 우회 금지. 실제 브라우저 게시 시연은 본인 소유 테스트 영상만.
7. 댓글 변경 시 기존 점수·승인을 무효화. 정확한 버전 해시와 근거 스냅샷으로 승인 결속.
8. 게시 시도 뒤 결과가 불확실하면 `UNKNOWN`으로 보류하고 **자동 재게시 금지**.
9. 영상당 1개, 앱 전체 하루 기본 10개 한도, 채널 allowlist와 테스트 영상 소유권 검증. UI 아닌 백엔드/DB에서 강제.
10. API 키는 macOS Keychain, 브라우저 세션은 독립 폴더, 앱 데이터는 사용자별 SQLite. Git/로그/프론트 번들 비밀 정보 금지.
11. 14차 D안 Full Evaluation Suite(15개 영상 데이터셋, 프롬프트 A/B·회귀, 장애 주입, AI-사람 평가 비교)를 최종 범위에서 제외하지 말 것. 진입점은 설정 > 고급(CHG-2026-10-21-09).
12. 16차 C안: macOS 1회 Setup + 이후 `.command` 원클릭 실행, 로컬 서버/대시보드, Git 소스 공개 가능 구조.

## 정본 및 읽는 순서

1. `README_START_HERE.md`
2. `docs/00_DECISION_LOG.md`
3. `docs/01_MASTER_PRD.md` + `docs/02_REQUIREMENTS_MATRIX.md`
4. `docs/03_USER_FLOWS.md` + `docs/04_UI_DESIGN.md`
5. `docs/05_AGENT_DESIGN.md` + `docs/06_AI_CONTRACTS.md` + `docs/07_ORCHESTRATION.md`
6. `docs/08_DATA_MODEL.md` + `docs/09_API_ARCHITECTURE.md` + `docs/10_BROWSER_EXECUTION.md`
7. `docs/11_DEPLOYMENT.md` + `docs/12_SECURITY_POLICY.md`
8. `docs/13_EVALUATION_PLAN.md` + `docs/14_RELEASE_DEMO.md`
9. `docs/15_DELIVERY_TRACEABILITY.md` + `docs/16_REFERENCES_AND_OPEN_ITEMS.md`

## 개발 전 선행 조건

- 마감일은 2026-10-20. 마감 '시각'과 실제 제출 여부는 **미확인**.
- 출처가 불완전하면 `TO VERIFY`와 실패 상태를 유지할 것.
- API 사용 가능 크레딧, 권한 있는 자막 자료, 본인 테스트 영상 및 Chrome 로그인 프로필을 확인할 것.
- 코드 생성 전에 요구사항 ID별 수용 기준/테스트/안전 범위를 대조할 것.

## 구현·검증 계약

- TypeScript monorepo, React/Vite, Node backend, SQLite, Playwright, Keychain adapter, 테스트/평가 모듈.
- 작업은 `QUEUED → RUNNING → COMPLETED/FAILED/NEEDS_REVIEW`로 보존. 모델 호출 재시도와 실제 게시 재시도 정책 분리.
- 모든 기능은 `REQ-*`와 `TEST-*`를 연결하고 실제 통과 증거가 없으면 완료 표시 금지.
- 비밀 키/인증 자료는 예제 파일·테스트 픽스처에 넣지 말 것.
- 소스 변경 시 같은 요구사항·검증·릴리스 문서를 동기화한 뒤 정본 Markdown에서 PDF 재생성.

## 절대 금지하는 완료 주장

이 패키지만으로는 **앱 구현, 실시간 YouTube 게시 성공, 품질 목표 달성, 제출 완료**를 주장할 수 없다. 모든 데모 숫자는 실제 측정 또는 명백한 예시 구분이 필요하다.

## 작업 환경 분담 (클라우드 개발 → 로컬 시연)

전체 진행 순서: **클라우드 세션에서 전체 프로젝트 완성 → 사용자 맥에 clone → 로컬 Claude Code가 실제 기능을 실행하며 시연 영상 촬영.**

### 클라우드 세션 (Linux, macOS 전용 기능 없음)

- M1~M2, M4 범위(앱·DB·5개 에이전트·오케스트레이터·UI·Eval Lab·자동 테스트)를 구현한다.
- macOS Keychain은 `SecretStore` 어댑터 인터페이스 뒤에 두고, 클라우드/테스트에서는 메모리 구현으로 검증한다. 실제 Keychain 구현은 macOS에서만 활성화되도록 플랫폼 분기한다.
- Playwright 게시 흐름은 headless Chromium + 로컬 픽스처 페이지(가짜 YouTube 댓글 UI)로 검증한다. 실제 YouTube 게시·로그인은 시도하지 않는다.
- Claude/YouTube API 실호출이 불가하면 녹화된 픽스처·모의 클라이언트로 테스트하고, 실호출 검증은 `TO VERIFY (local)`로 남긴다.
- `.command` 원클릭 스크립트와 Setup은 작성하되 실행 검증은 로컬 몫으로 표시한다.
- 작업 단위마다 브랜치 → 테스트 통과 → PR. 통과 증거 없는 기능은 완료로 표시하지 않는다.

### 로컬 맥 (M3, M5)

- 실제 Keychain에 API 키 저장, 본인 테스트 영상 + Chrome 테스트 프로필로 게시·확인.
- `docs/14_RELEASE_DEMO.md`의 150초 스토리보드대로 시연 영상 촬영.

### 로컬 검증 인계

클라우드에서 검증하지 못한 항목은 `docs/LOCAL_VERIFICATION.md`에 체크리스트로 누적한다(항목, 관련 REQ/TEST, 실행 방법, 기대 결과).
