# 08. SQLite 데이터 모델·보존·무결성

## 1. 설계 원칙

하나의 사용자별 SQLite DB, 로컬 파일 저장소 분리. 대량 스크린샷·trace는 DB에 바이너리로 저장하지 않고 경로·해시·보관 정책만 기록. WAL과 foreign keys, unique 제약, schema migration 사용. **데이터베이스는 현재 macOS 사용자 전용**, 비밀 키·쿠키는 포함하지 않음.

## 2. 핵심 테이블

| 테이블 | 키 | 핵심 칼럼(설계 계약) |
|---|---|---|
| `channels` | channel_id PK | name, allowed_for_listing |
| `videos` | video_id PK | channel_id FK, title, published_at, last_seen_at |
| `video_snapshots` | snapshot_id PK | video_id FK, meta_hash, source_json_ref, created_at |
| `evidence` | evidence_id PK | snapshot_id FK, source_type, original_excerpt, timestamp, verified_by, trust_grade |
| `video_analyses` | analysis_id PK | snapshot_id FK, core_problem, ratings_json, score_state, model_id, prompt_version |
| `comment_candidates` | candidate_id PK | analysis_id FK, strategy, content, content_hash |
| `comment_revisions` | revision_id PK | candidate_id FK, version_no, content, content_hash, edited_at |
| `quality_reviews` | review_id PK | revision_id FK, evidence_snapshot_hash, ratings_json, hard_gate_state, model_id |
| `approvals` | approval_id PK | revision_id FK, review_id FK, content_hash, test_target_id, profile_id, approved_at, invalidated_at |
| `ai_jobs` | job_id PK | job_type, status, priority, idempotency_key UNIQUE, dependency_json, lease_until |
| `ai_job_attempts` | attempt_id PK | job_id FK, attempt_index, model_id, error_code, started_at, finished_at |
| `ai_usage` | usage_id PK | attempt_id FK, input_tokens, output_tokens, cache_tokens, estimated_cost |
| `analysis_cache` | cache_key PK | result_ref, data_hash, prompt_version, expires_at |
| `browser_profiles` | profile_id PK | alias UNIQUE, user_data_dir, status, last_auth_check |
| `execution_jobs` | execution_id PK | video_id, approval_id, profile_id, status, submitted_at, verified_at |
| `posting_claims` | claim_id PK | video_id UNIQUE, attempt_id, status, claimed_at, resolved_at |
| `execution_events` | event_id PK | execution_id FK, step, result, timestamp, diagnostic_ref |
| `audit_events` | event_id PK | entity_type, entity_id, action, actor, created_at, metadata_redacted |
| `artifacts` | artifact_id PK | execution_id FK nullable, path, sha256, retention_deadline |
| `budget_policies` | policy_id PK | daily_limit_usd, monthly_limit_usd, warning_ratio |
| `daily_usage` | local_date PK | submit_attempts_reserved, confirmed_count |

정규화 수준과 테이블 통합은 기능을 보존하는 조건 아래 개발 시 조정 가능. SQLite에는 멀티 프로필 게시가 허용돼도 **영상별 UNIQUE 예약**이 앱 전체로 적용되어야 한다.

## 3. 필수 고유/참조 조건

- 모든 `video_id`는 실제 YouTube 형식·Channel ID 검사 후 저장.
- 동일 후보 내 `version_no` UNIQUE.
- QualityReview와 Approval은 특정 revision·근거 버전에만 유효.
- `posting_claims.video_id`는 전체 테스트 게시 영역에서 UNIQUE. 완료되거나 UNKNOWN인 claim은 자동 삭제·재시도에 사용하지 않음.
- `execution_jobs`의 실행 시작은 claim 생성, 하루 한도 예약, 승인 버전 확인을 하나의 트랜잭션으로 수행.

## 4. 게시 상태와 `UNKNOWN`

`NOT_STARTED`, `PRE_SUBMIT_FAILED`, `SUBMIT_ATTEMPTED`, `VERIFYING`, `SUCCESS`, `UNKNOWN`, `FAILED_VERIFIED_NOT_POSTED`(근거가 충분할 때만 사용).

- 제출 이후 `UNKNOWN`은 claim 유지 + 자동 재전송 불허.
- 사람이 영상·댓글을 직접 확인한 뒤 결과 기록. 확인되지 않은 주장으로 `SUCCESS` 설정 금지.
- 일일 한도는 안전하게 계산하기 위해 제출을 시도하거나 결과가 불확실한 작업까지 포함.

## 5. 시간 및 보관

- 감사 이벤트에는 UTC timestamp와 UI 현지 날짜(KST)를 구분.
- 하루 상한의 기준 시간대는 **Asia/Seoul**로 설정하고 UI·DB 계산 일치.
- AI 사용량 및 일반 실행 로그 90일, 오류 스크린샷 30일, 임시 debug 파일 7일(초기 제안). 개발·제출 검증에 필요한 파일은 기한 만료 전에 사용자 확인.
- 백업은 SQLite의 일관성 있는 backup 절차를 사용; WAL 파일의 데이터 누락을 방지. Chrome 프로필, Keychain, 인증 세션은 일반 백업에 미포함.

## 6. 개인정보·접근 제어

- DB/폴더는 사용자 전용 권한(파일 `0600`, 디렉터리 `0700` 기준).
- UI 수정/삭제·백업·데이터 초기화는 사용자 확인 필요. API 키 Keychain 삭제와 SQLite 데이터 삭제는 별도 작동.
- 파일 경로 탐색/로그 확인 기능에는 허용 디렉터리 내부 제한 적용.
