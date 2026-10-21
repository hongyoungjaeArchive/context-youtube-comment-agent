# 03. 사용자 흐름과 상태 전이

## 1. 최초 실행 / 설정

1. 사용자는 Setup에서 Node·Chrome·빌드·쓰기 권한 확인.
2. 로컬 앱을 `.command`에서 시작, 단일 로컬 서버/대시보드 오픈.
3. Claude/YouTube API 키를 설정에서 입력, **백엔드 Keychain 저장**, 확인 결과만 UI 노출.
4. 테스트 프로필 유튜브1 디렉터리 등록, 사용자가 직접 로그인, 자신이 소유한 테스트 영상 등록·확인.
5. 초기 허용 채널, 10개/일 상한, 예산, 로그 보관 기간을 확인.
6. 테스트용 준비물이 없다면 분석 기능은 사용 가능하지만 테스트 게시 버튼은 비활성.

## 2. 기본 3열 워크플로

**좌측: Discover**  
`EMPTY → LOADING → LIST_READY / PARTIAL / ERROR`
- [영상 불러오기] → allowlist uploads playlist 최근 최대 10개씩 → 메타데이터 표시.
- URI 입력 시 정규화 후 Video ID 조회, Channel ID 검사. 허용되지 않은 채널은 게시 금지, 분석은 출처 정책에 맞는 범위에서만.
- 앱은 최대 50개 메타데이터를 수집하고 15개 예비 평가, 상위 5개 우선 추천한다(초기값; 적합 대상이 적으면 감소).

**중앙: Analyze & Compose**  
`VIDEO_SELECTED → EVIDENCE_LOADING → CONTEXT_READY/PARTIAL → CANDIDATES_READY → EDITING → VALIDATING → REVIEW_READY/REJECTED`
- 선택 영상의 실제 출처와 자료 부족 여부를 먼저 표시.
- `core_problem` 1줄 및 근거 링크/원문·종류·타임스탬프.
- 전략별 댓글 A 공감형, B 질문형, C 정보형 3개 생성; 후보별 점수/이유/규칙 위반.
- 사용자가 후보 선택·직접 편집; 입력 즉시 글자 수·URL·해시태그 정적 검사.
- `재검증` 실행 시 **편집된 댓글 버전**만 평가. 수정 발생 즉시 검증/승인 무효화.

**우측: Approve & Execute**  
`READY_FOR_APPROVAL → APPROVED → PREFLIGHT → LAUNCHING → AUTH_CHECK → NAVIGATING → EDITOR_READY → TYPING → SUBMITTING → VERIFYING → SUCCESS / UNKNOWN / FAILED`
- 승인 조건: 최신 근거 스냅샷·댓글 해시·품질·공개 사실·권한·운영 정책.
- 최종 승인과 별도의 `[테스트 실행]` 사용자 행동 필요.
- 본인 테스트 영상일 때만 브라우저 게시 흐름 실행. 제3자 채널에서 승인한 문구는 복사/검토까지만.
- 성공은 Chrome 클릭 여부가 아니라 대상 영상에서 해당 계정·댓글 확인 기준.

## 3. 예외 및 안전 전이

| 상황 | 상태 변화 | 사용자에게 보이는 행동 |
|---|---|---|
| 자막 접근 없음 | CONTEXT_PARTIAL | 제목·설명·댓글 기반 예비 분석, 실제 발언 검증 요청 |
| 영상 원문 없음 | NEEDS_EVIDENCE | 구체적 장면 인용 불가, 실행 보류 |
| 허위 인용 검출 | REJECTED | 원문 불일치 위치와 삭제·수정 요청 |
| 입력 편집 | APPROVED → NEEDS_VALIDATION | 승인 회수, 재검증 버튼 |
| 인증 만료 | AUTH_REQUIRED | 사용자가 직접 로그인하도록 안내 |
| 댓글 입력창 없음 | FAILED_PRE_SUBMIT | 화면 캡처·상태 재조회 1회, 안전 중단 |
| 제출 이후 브라우저 응답 없음 | UNKNOWN | 자동 재게시 금지, 사람 확인 요청 |
| 앱 종료/크래시 | INTERRUPTED | 마지막 DB 상태 복원, 게시 여부 추측 금지 |
| 예산 상한 초과 | BUDGET_BLOCKED | 신규 AI 호출 중단, 캐시·이전 결과 보존 |
| 정책 위반/외부 계정 자동 순환 | BLOCKED | 실행 차단·감사 이벤트 기록 |

## 4. 원칙: 댓글 원문 및 승인 결속

각 후보·수정 버전은 불변 `revision_id`와 `content_hash`를 가진다. `quality_review`는 동일한 revision, evidence snapshot, prompt/model version에 결속된다. `approval`은 그 review를 참조한다. 편집·근거 변경·테스트 영상 변경 시 승인 재요청.

## 5. 접근성 및 사용자 기대

- 키보드로 카드 선택·입력·승인할 수 있어야 한다.
- 실패/성공은 색상 이외 텍스트·아이콘으로 표현.
- 로딩 중에도 이전 분석 결과는 `STALE` 표시로 읽을 수 있으나 `APPROVED`로 오인시키지 않는다.
- 대시보드 새로고침이 큐 작업을 중복 시작하지 않는다.
