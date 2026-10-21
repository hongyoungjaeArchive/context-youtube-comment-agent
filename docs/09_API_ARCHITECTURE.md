# 09. API 계약·시스템 아키텍처

## 1. 통합 기술 스택

| 범위 | 확정 선택 |
|---|---|
| 개발 | Claude Code 기반 바이브코딩, TypeScript monorepo |
| UI | React + Vite + Tailwind + shadcn/ui |
| 로컬 서버 | Node.js / localhost 전용 |
| 외부 영상 | YouTube Data API v3 |
| 생성·판단 | Provider 어댑터: 기본 로컬 Claude Code CLI(`claude -p`, 구독 사용량·추가 비용 없음) / Anthropic API(종량 과금, 명시적 동의 시만) / 모의 — Haiku/Sonnet 설정 가능 |
| 실행·시연 | Playwright persistent Chrome test context |
| 영속 상태 | SQLite + filesystem artifacts |
| 비밀 정보 | macOS Keychain |
| 테스트 | Vitest + Playwright Test + Evaluation Harness |

## 2. 권장 앱 인터페이스 (요구 명세, 구현 코드 아님)

| 메서드/경로 | 입력 | 출력/정책 |
|---|---|---|
| `GET /api/health` | 없음 | 서버/DB 준비 상태 (비밀정보 제외) |
| `POST /api/videos/refresh` | channel scope | 업데이트 작업 ID |
| `GET /api/videos` | pagination/sort/filter | VideoRecord·추천 상태 |
| `POST /api/videos/inspect-url` | url | canonical video_id/channel_id, scope_result |
| `POST /api/analyses` | video_id | job ID, evidence state |
| `GET /api/analyses/:id` | analysis_id | core_problem, evidence_refs, scores |
| `POST /api/comments/generate` | analysis_id | generation job ID |
| `POST /api/comments/revisions` | candidate_id, content | revision_id, statically valid flags |
| `POST /api/comments/revalidate` | revision_id | Quality job ID |
| `POST /api/approvals` | revision_id, review_id, test target | approval ID; 서버 승인 게이트 |
| `POST /api/executions/test` | approval_id, profile_id, explicit confirmation | 테스트 실행 ID; 대상 본인 소유 제한 |
| `GET /api/executions/:id` | execution_id | 단계·SUCCESS/UNKNOWN/FAILED, redacted artifacts |
| `GET /api/activity` | filters | 감사·작업 이력 |
| `GET /api/ai/usage` | date range | 추정 토큰/비용/예산 |
| `POST /api/settings/api-key` | provider, secret | Keychain 저장 결과, 키 원문 비반환 |
| `PATCH /api/settings` | llmProvider, confirmMetered | `ANTHROPIC_API`는 `confirmMetered=true` 없으면 409 `METERED_CONFIRMATION_REQUIRED` |
| `POST /api/settings/llm/check` | 없음 | Claude Code CLI 존재·버전만 확인(모델 호출 없음) |
| `POST /api/settings/api-key/anthropic/test` | 없음 | 종량 과금 Provider가 꺼져 있으면 API를 호출하지 않고 등록 여부만 응답 |
| `POST /api/sage/ask` | question(1~500자), selectedVideoId? | `{ answer, aiMode }`. 읽기 전용, RESEARCH 역할, 60초 제한, 동시 1건(409 `SAGE_BUSY`), 504 `SAGE_TIMEOUT`, 502 `SAGE_UNAVAILABLE`, 409 `SAGE_BUDGET`. Mock Provider는 템플릿 답변 |

위는 설계용 경로 이름이다. 실제 구현은 동일한 데이터 계약과 보안 요구를 보존하는 한 API 형태를 조정할 수 있다.

## 3. 영상 조회 파이프라인

- 고정 Channel ID 목록 → `channels.list`에서 uploads playlist ID 확인 → `playlistItems.list`로 최신 업로드 → `videos.list`로 상세 데이터 → `commentThreads.list(order=relevance)`로 접근 가능한 댓글.
- 할당량 오류, 삭제/비공개 영상, 댓글 비활성화는 정상적인 오류 상태로 처리.
- 자막 API `captions.download`는 영상 편집 권한 필요; 타인 영상의 원문 자막이 항상 접근 가능하다고 가정 금지.

## 4. 로컬 네트워크 정책

- 백엔드는 `127.0.0.1`에만 바인딩하고 임의 외부 호스트 접근 차단.
- 프런트/백엔드는 동일 Origin 운영, 허가된 Host·Origin 및 CSRF/로컬 세션 방어.
- 실행·승인·키 설정 엔드포인트는 인증·내용·고유 요청 ID 검증; 잘못된 Origin/CORS로는 보호 충분하지 않음.
- 비밀 키는 런타임의 백엔드에서만 일시적으로 로드. 프런트 번들·URL query·로그 출력 금지.

## 5. 비동기 진행 표시

작업 생성 API는 `job_id`를 반환하고, UI는 상태 조회/이벤트 스트림(구현 단계 선택)으로 현재 상태를 표시. UI 페이지 새로고침은 같은 `job_id`를 재조회하며 같은 작업을 재시작하지 않음.

## 6. 외부 사용 가능성의 한계

API 오류, 로그인 만료, 플랫폼 UI 변경, 정책 차단을 자동 우회하지 않는다. 네트워크 장애 중에도 앱은 로컬 데이터 조회를 지원하되 AI/원격 조회는 별도 오류로 표시.
