# 10. Chrome 테스트 실행 정책·실패 복구

## 1. 실행 범위와 조건

- 과제는 지정 채널 영상에 직접 댓글을 쓰는 시연을 요구하지만, CONTEXT의 자동 제출 엔진은 **본인 소유·통제 테스트 영상**으로 한정한다.
- 지정 채널 5개 목록은 조사·분석·투명성 있는 콘텐츠 초안 범위. 제3자 시청자로 가장한 광고 댓글 반복 게시는 실행 범위 밖.
- 실행의 모든 부작용은 운영자 승인·명확한 `테스트 실행` 클릭 후에만.

## 2. Chrome 프로필

- `유튜브1` 연결·게시 검증 먼저 완성. `유튜브2, 유튜브3`은 각각 독립된 테스트 프로필 디렉터리로 선택적 추가.
- 계정 자동 순환·잠금 우회·재게시 분산 없음. 운영자가 수동으로 프로필 선택.
- Playwright `launchPersistentContext`와 `channel=chrome` 등 사용 가능 여부 확인. 평소 쓰는 기본 Chrome User Data 폴더 사용 금지, 동일 디렉터리 병렬 실행 금지.
- 사용자가 직접 Google 로그인. 비밀번호·OTP·쿠키를 앱 DB나 원격 로그로 보내지 않음.

## 3. 실행 상태 머신

`QUEUED → PREFLIGHT → LAUNCHING → AUTH_CHECK → NAVIGATING → EDITOR_READY → TYPING → SUBMITTING → VERIFYING → SUCCESS`

예외: `AUTH_REQUIRED`, `FAILED_PRE_SUBMIT`, `UNKNOWN`, `CANCELLED`, `POLICY_BLOCKED`, `PROFILE_LOCKED`.

## 4. Preflight Gate (서버·DB에서 강제)

1. 선택 테스트 영상의 본인 소유·통제 확인 기록 존재.
2. 승인된 최신 댓글 revision의 `content_hash`·Quality PASS·근거 스냅샷 일치.
3. 40~120자, 링크/해시태그 없음, 허위 후기/광고 위장 없음.
4. 동일 영상의 `posting_claim` 없음, 전체 하루 10개 예약 제한.
5. 프로필 등록/인증/잠금/현재 실행 확인.
6. 사용자 별도의 실행 동의 확인 및 데이터베이스 트랜잭션 선점.

## 5. 브라우저 시연 순서

- 전용 visible Chrome 창 오픈 → 테스트 영상 로드 → 한국어 UI에서 댓글 편집창 식별 → 정확히 승인된 문장을 사람이 볼 수 있도록 한 글자씩 입력 → 제출 액션 → 본인 계정·영상 ID·최종 원문에 해당하는 댓글 **실제 존재** 확인.
- 댓글을 입력했거나 버튼 클릭에 성공했다는 사실만으로 `SUCCESS` 표시 불가. 증거(확인 시각·표시 원문·가능한 링크/스크린샷)를 저장.

## 6. 실패 유형·복구 행위

| 분류 | 안전 처리 |
|---|---|
| 브라우저 실행 전 오류 | 설정 확인, 실패 증거, 제한적 재시도 |
| 로그인 만료/Google 추가 인증 | 중단 후 사람 직접 해결 |
| 영상 탐색/댓글 입력창 오류 | 제출 전 한정 안전 재탐색 최대 1회 |
| 입력 중 충돌 | 제출 발생 전임을 확인한 경우에만 복원 |
| SUBMITTING 중 종료/시간 초과 | 즉시 UNKNOWN, 재전송 금지 |
| VERIFYING에서 댓글 미확인 | UNKNOWN, 사용자 수동 검증 |
| CAPTCHA/플랫폼 보호 | 자동 우회 금지, 중단 |
| 프로필 변경 시도 | 실행 중 변경 차단 |

## 7. 로그·증거

`execution_id`, video_id, profile_alias, revision_hash, step, started_at, submitted_at, verified_at, outcome, error_code, screenshot_ref. 세션·키·민감 화면은 마스킹 또는 저장 생략. 실제/모의 테스트의 구분을 로그와 UI 모두에 표시.

## 8. 테스트 격리

일반 UI/통합 테스트에는 모의 게시 실행기 사용. 실제 게시 통합 테스트는 본인 소유 영상, 전용 계정, 소수의 수동 승인 실행만 허용. 반복 자동 E2E가 YouTube에 실댓글을 계속 생성해서는 안 된다.
