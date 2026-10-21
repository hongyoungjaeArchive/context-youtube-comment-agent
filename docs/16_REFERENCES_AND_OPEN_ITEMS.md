# 16. 출처·검증 사실·미확정 항목

## A. 기준 출처

1. **원본 과제 (사용자 제공 PDF, 7p):** `references/track-2-marketing-agent.pdf` — 지정 채널, 필수/가점, 운영 상한, 시연·평가·제출. 공식 요구사항의 정본.
2. **Claude 모델 목록:** https://platform.claude.com/docs/en/models/overview — 2026-10-20 문서 확인 기준, `claude-sonnet-5-5`, `claude-haiku-5-5` 가용성 안내. 실제 계정 접근권 확인 필요.
3. **Claude Structured Outputs:** https://platform.claude.com/docs/en/build-with-claude/structured-outputs — `output_config.format` 기반 JSON Schema 사용. 스키마 검증과 사실 검증을 구분.
4. **Claude Rate Limits:** https://platform.claude.com/docs/en/api/rate-limits — RPM·입력/출력 토큰 제한 및 Retry-After 고려.
5. **Claude Prompt Caching:** https://platform.claude.com/docs/en/build-with-claude/prompt-caching — 5분·1시간 옵션, 사용 조건과 실제 요금 재검증 필요.
6. **YouTube uploads playlist:** https://developers.google.com/youtube/v3/docs/playlistItems/list — 게시목록 조회 API.
7. **YouTube comments:** https://developers.google.com/youtube/v3/docs/commentThreads/list — `order=relevance`는 인기 댓글에 대한 근사치.
8. **YouTube captions permission:** https://developers.google.com/youtube/v3/docs/captions/download — 다운로드 시 영상 수정 권한 요구.
9. **YouTube 스팸 정책:** https://support.google.com/youtube/answer/2801973?hl=ko — 반복/기만적 댓글 스팸 제한.
10. **Playwright Chrome persistent context:** https://playwright.dev/docs/api/class-browsertype — 독립 userDataDir, 기본 Chrome 프로필 자동화 제한.
11. **Apple Keychain Services:** https://developer.apple.com/documentation/security/keychain-services — 소량 비밀 데이터의 OS 보안 저장.

## B. 확정 / 외부 검증 필요 구분

| 항목 | 상태 | 의미 |
|---|---|---|
| 17차 개발 방향 | CONFIRMED | 사용자 결정 |
| 채널 5개·점수표·가점 | SOURCE CONFIRMED | 사용자 제공 과제 원본 |
| 제출 날짜 2026-10-20 | USER CONFIRMED | 제출 시각 미확인 |
| 모델 ID·가격 | DOCUMENTED / REVERIFY | 실제 계정·SDK·가격 변경 가능 |
| 특정 영상 자막 본문 | NOT VERIFIED | 권한·접근 자료 확보 전 가정 금지 |
| 운명원의 광고 표현 근거 | NOT VERIFIED | 검증된 브랜드 소개 자료 확보 필요 |
| 본인 테스트 영상·프로필 | OPEN | 실제 계정/영상 준비 필요 |
| API 키·예산·쿼터 | OPEN | 실비·사용 가능 크레딧 확인 필요 |
| Git 저장소·시연 링크 | NOT CREATED | 본 패키지는 앱·영상 생성 요청이 아님 |
| 공식 제출 성공 | NOT CONFIRMED | 접수 확인 필요 |

## C. 과제의 요구와 안전 제한 사이의 차이

과제 PDF는 지정 채널 영상에 시청자처럼 자연스러운 브랜드 댓글과 3개 프로필 가점을 요구한다. CONTEXT 명세는 **브랜드 제휴를 숨긴 가짜 시청자 표현, 다계정 순환 광고, 대량 반복 자동 댓글**의 실제 실행을 제외한다. 실제 브라우저 게시·확인은 본인 테스트 영상으로 한정한다. 공식 평가자에게 이 범위 차이를 숨기거나, 실행하지 않은 외부 댓글을 실행한 것으로 주장하지 않는다.

## D. 2026-10-20 마감 관련 열린 항목

- 정확한 제출 시각과 현재 양식 접근 가능 여부
- 본인 테스트 영상의 공개 범위, 로그인 상태, 소유권 확인 자료
- 해당 계정의 Claude API 키·유효한 결제/쿼터 및 YouTube Data API 키
- 영상 15개 평가용 실제 발언/검증 가능한 출처 확보
- 광고/제휴 및 운명원 서비스에 관한 입증 가능한 공식 정보
- 애플리케이션 구현·실측 테스트·2~3분 영상·Git 주소·제출 완료 여부

## E. 작성 메모

본 패키지는 **개발 착수용 명세**이며 앱·계정·브라우저·API의 실제 실행을 수행하지 않았다. 최신 외부 정보를 근거로 기술 방향을 정했지만, 특정 사용자의 API 가용성과 브라우저 환경을 시험했다고 말하지 않는다.
