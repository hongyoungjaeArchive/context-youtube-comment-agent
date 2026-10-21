# CONTEXT — 마케팅 AI 에이전트 (로컬 macOS 앱)

제이지그룹 AI PM TRACK 2 과제 구현. **[영상 불러오기] → 영상 클릭 → [댓글 달기]** 세 번으로 끝나는 로컬 대시보드.

1. 지정 5개 채널 최신 영상 조회 (링크 직접 입력·'연애' 뜨기 직전 영상 찾기 포함)
2. 영상을 고르면 공개 자막(없으면 제목·설명)과 인기 댓글을 읽고 → 영상 속 고민 한 줄 → 시청자 말투 댓글 초안 3개(추천 1개 표시) → 규칙·품질 심사
3. 사람 승인 → **본인 소유 테스트 영상**에 전용 Chrome 프로필로 한 글자씩 입력·게시·내 댓글 확인 → 시간순 기록·영상당 1개·하루 10개

제작 의도: `deliverables/INTENT.md` · 시연 계획: `docs/14_RELEASE_DEMO.md`

기획 정본은 `CLAUDE.md`, `docs/00`~`docs/16`. 구현 상태와 요구사항 대응은 `docs/IMPLEMENTATION_STATUS.md`, 아직 사람이 확인하지 않은 항목은 `docs/LOCAL_VERIFICATION.md`.

## 실행 (macOS)

1. `Setup CONTEXT.command` 더블클릭 (1회) — Node 22.12+ / Chrome 확인, `npm ci`, 빌드, `~/Library/Application Support/context-marketing-agent` 생성(0700), SQLite 초기화, Keychain 키 등록 여부 확인.
2. `Start CONTEXT.command` 더블클릭 — `127.0.0.1:4317` 서버 시작(중복 실행 감지) → 대시보드 열림.
3. `Stop CONTEXT.command` — 안전 종료.

자막은 `yt-dlp`(`brew install yt-dlp`)로 공개 자막 파일만 받는다(영상 미다운로드). 없으면 제목·설명으로 분석한다.

AI 분석은 기본적으로 **로컬 Claude Code CLI(`claude -p`)** 로 실행된다 — 사용자의 Claude 구독 사용량으로 처리되어 추가 비용이 없다(`claude`가 설치·로그인되어 있어야 함). Anthropic API 키 Provider는 **종량 과금**이라 기본 비활성이며 설정에서 비용 동의 후에만 켤 수 있다. YouTube Data API 키는 대시보드 **설정**에서 등록(macOS Keychain, 서비스 `context-marketing-agent`, 계정 `youtube`/`anthropic`). CLI·키가 없으면 모의 AI(MOCK)·합성 영상(SYNTHETIC) 모드로 동작하며 화면에 그렇게 표시된다.

## 구조

```
apps/server     Node(Fastify) 로컬 API — 127.0.0.1 전용, Host/Origin/CSRF 검사
  src/agents        Research · Context · Marketing · Quality (+ 프롬프트 A/B 버전)
  src/orchestrator  SQLite 작업 큐(우선순위·의존성·lease·재시도) · 예산 · 결과 캐시 · 모델 대체
  src/execution     Execution: 승인 게이트 · Preflight · Playwright 게시 드라이버 · 프로필 · 테스트 영상
  src/eval          Evaluation Lab: 데이터셋 · A/B · 회귀 · 장애 주입 10종 · 사람-AI 비교 · 릴리스 게이트
  src/security      Keychain SecretStore · 로그 마스킹 · 로컬 가드
apps/web        React + Vite + Tailwind 3열 대시보드
packages/shared 타입 · zod 스키마 · 댓글 규칙(40~120자, 링크/해시태그/지어낸 후기 금지)
evaluation/     골든 데이터셋(15개 계획 슬롯 + 합성 적대 사례 5개)
scripts/        setup / start / stop / secret-scan
```

## 개발·테스트

```bash
npm ci
npm run build        # shared → server → web
npm run typecheck
npm test             # Vitest: 단위·통합·장애 주입·실브라우저(로컬 픽스처) — 실제 YouTube/Claude 호출 없음
npm run test:e2e     # Playwright UI E2E (빌드 필요, 모의 AI·합성 데이터·픽스처 모드)
npm run secret-scan  # Git 추적 파일·빌드 산출물의 키 형태 문자열 검사
```

개발 서버(크레딧·쿼터 0): `CONTEXT_DATA_DIR=/tmp/ctx CONTEXT_FIXTURE_MODE=1 CONTEXT_FORCE_MOCK_AI=1 CONTEXT_FORCE_SYNTHETIC_YT=1 CONTEXT_DEV=1 node apps/server/src/index.ts` + `npm run dev:web`.

## 안전 범위 (숨기지 않는 제한)

- 자동 게시는 **본인 소유가 확인된 테스트 영상**(또는 픽스처 모드의 로컬 가짜 페이지)에만. 지정 5개 채널 영상은 분석·투명한 초안까지.
- 영상당 1개, 하루 10개(Asia/Seoul), 승인 해시·근거 스냅샷 결속, 게시 결과 불확실 시 `UNKNOWN` + 자동 재게시 금지 — 모두 서버·DB에서 강제.
- 근거(자막·제목·설명·댓글)에 없는 장면·발언은 쓰지 않는다. 따옴표 인용은 근거 원문과 일치해야 하고, 장면 근거가 없으면 `NEEDS_EVIDENCE`로 보류. 지어낸 운명원 후기·평판 주장·링크·해시태그는 하드 차단. CAPTCHA·로그인 우회, 계정 자동 순환 없음.
- 뜨기 직전 찾기로 들어온 지정 채널 밖 영상은 **초안까지만** — 서버가 승인을 막는다(`TREND_DRAFT_ONLY`).
- 측정하지 않은 품질 수치는 `NOT MEASURED`, 모의 결과는 성능 수치로 쓰지 않는다.

## 오픈소스

| 이름 | 용도 | 라이선스 |
|---|---|---|
| [Fastify](https://fastify.dev) | 로컬 API 서버 | MIT |
| [React](https://react.dev) · [Vite](https://vite.dev) · [Tailwind CSS](https://tailwindcss.com) | 대시보드 | MIT |
| [TanStack Query](https://tanstack.com/query) | 서버 상태 | MIT |
| [Zod](https://zod.dev) | 입력·AI 출력 검증 | MIT |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | 로컬 DB | MIT |
| [Playwright](https://playwright.dev) | 전용 Chrome 프로필 제어 (`launchPersistentContext`) | Apache-2.0 |
| [lucide](https://lucide.dev) | 아이콘 | ISC |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | 공개 자막 파일 수집 (별도 설치) | Unlicense |
| [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) · Claude Code CLI | AI 분석 | MIT / Anthropic 약관 |

AI 코딩 도구(Claude Code)를 사용해 개발했다.
