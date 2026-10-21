# 12. macOS Keychain·로컬 보안·플랫폼 정책

## 1. 자격 증명 분리

| 대상 | 저장 위치 | 금지 사항 |
|---|---|---|
| Claude API Key (종량 과금, 기본 미사용) | macOS Keychain | SQLite / 브라우저 로컬스토리지 / Git / 일반 로그 / CLI 자식 프로세스 환경 |
| Claude Code CLI 인증 | Claude Code 자체 로그인(구독) | 앱은 토큰을 읽거나 저장하지 않음 — `claude` 실행 파일만 호출 |
| YouTube API Key | macOS Keychain | 프런트 번들 / URL query / Git |
| Chrome 로그인 상태 | 별도 테스트 Profile 디렉터리 | 일반 개인 Profile 혼용 / Git / 자동 백업 |
| SQLite 데이터 | 사용자별 Application Support | 공개 공유 폴더·서버 외부 노출 |
| 스크린샷·추적 | 전용 Local Files | 보안 인증 화면·개인정보의 무차별 수집 |

Keychain 등록·조회·삭제는 백엔드만 수행, UI에는 등록/연결 상태만 표시. 실제 키 원문을 반환하는 API 금지. Keychain 보호는 DB/프로필 전체 암호화를 의미하지 않는다.

## 2. 로컬 서버 보안

- `127.0.0.1` bind, Host·Origin allowlist, 로컬 세션/CSRF 차단 및 요청마다 서버 측 승인 검사.
- `localhost`라는 이유로 임의 페이지의 로컬 POST가 허용되지 않도록 해야 한다.
- 브라우저의 최종 승인 값은 서버에서 revision hash, test target, profile, claim, 사용량과 다시 대조.
- 경로 입력은 sandbox 범위 검사, 업로드/파일 접근의 경로 이동(path traversal) 방지.

## 3. 파일 및 로그

- 로컬 데이터 폴더 권장 `0700`, 중요한 파일 `0600`.
- API 요청 원문, OAuth 쿠키, 인증 토큰, 비밀번호, Keychain secret, 개인 식별 정보 기록 최소화.
- 오류 로그는 식별자·에러 코드·시간·요청 지연·토큰 수 등 진단 가능한 최소 메타데이터 중심.
- 보관 기본값: 분석/댓글은 프로젝트 기간, AI·실행 로그 90일, 오류 캡처 30일, debug 7일. 사용자 삭제 기능 및 민감 파일 복원 정책 제공.
- 백업은 SQLite 온라인 백업/일관성 확보, Keychain·Chrome 세션 제외.

## 4. 프롬프트 인젝션

- 외부 영상 제목·설명·시청자 댓글·자막은 신뢰하지 않는 **데이터**. 정책 지시나 키 조회 명령으로 승격 금지.
- Claude는 DB write/Keychain/browser post 권한 없음. 모든 부작용은 백엔드가 사전 승인·대상 검사 후 수행.
- 외부 근거의 URL·인용·시간 기록, 실제 원문 대조, 거짓 이용 후기·브랜드 평판 주장 금지.

## 5. YouTube 댓글·브랜드 투명성

원본 과제에는 시청자 페르소나로 브랜드 관심을 자연스럽게 유도하라는 요구가 있다. 다만 실제 제3자 게시를 허위 시청자처럼 꾸미거나 여러 계정에 반복 분산시키면 기만적 댓글 스팸에 해당할 수 있다. 따라서 **제3자 영상은 분석·초안**, **게시 자동화 시연은 본인 테스트 영상**으로 제한한다. 실제 광고·제휴 활동은 그 관계를 정확히 공개하고 플랫폼 정책을 준수한다. 광고 관계·서비스 성과·이용 후기를 지어내지 않는다.

## 6. 기능별 최소 보안 검사

`TEST-SEC-01` Keychain 저장/삭제, `TEST-SEC-02` 빌드·Git·로그 secret leak 검사, `TEST-SEC-03` 비인가 로컬 요청/Origin/CSRF 차단, `TEST-SEC-04` 외부 URL의 게시 차단, `TEST-SEC-05` 승인 버전 바꿔치기 차단, `TEST-SEC-06` 실행 후 UNKNOWN 중복 방지, `TEST-SEC-07` 브라우저 프로필 독립성.
