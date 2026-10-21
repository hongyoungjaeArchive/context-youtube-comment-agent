# 로컬 검증 체크리스트 (TO VERIFY — local)

> 기준: `feat/full-build` 브랜치, 2026-10-20 KST. 아래 항목은 **아직 사람이 직접 확인하지 않았거나 자동 테스트로 대체할 수 없는 것**이다.
> 체크하기 전에는 완료로 주장하지 않는다. 확인하면 날짜·확인자·증거(스크린샷/로그 경로)를 옆에 적는다.

## 0. 이미 개발 세션에서 실측한 것 (참고)

| 항목 | 결과 | 근거 |
|---|---|---|
| YouTube Data API 실제 조회 (5개 채널 최신 영상) | 5/5 채널 성공, 영상 50개 수집 (LIST_READY) | 격리 데이터 폴더로 실서버 기동 후 `POST /api/videos/refresh` 1회 (쿼터 약 16 unit) |
| **Anthropic API(종량 과금) 실호출 이력 — 비용 0원 원칙 적용 전** | `messages` 3회(Sonnet, Context·Marketing·Quality 1회 분석, 추정 USD 0.066, 입력 6,988/출력 3,946 토큰) + `models.retrieve` 1회(토큰 비용 없음 키 확인) | 규칙 변경(2026-10-20) 이후 Anthropic API 호출 **0회**. 기본 Provider는 Claude Code CLI로 전환 |
| Claude Code CLI(`claude -p`) 실동작 | 형식 확인 1회(Haiku) + 분석 1회(영상 `k_0c0m0Hk5k`, Sonnet 3회 호출) 모두 COMPLETED. 종량 청구 USD 0, Claude Code 보고 API 환산 참고값 USD 0.115 | 격리 데이터 폴더 실서버 `/api/ai/usage` |
| 프롬프트 B-1.1 효과(표본 1개, 통계 아님) | API 1회(B-1.0)에서 브랜드명 언급 1/3 → CLI 1회(B-1.1)에서 3/3. 두 경우 모두 A등급 근거가 없어 Quality가 3개 후보를 FAIL(SCENE_REFERENCE WARN)로 보류 — 설계대로 | 같은 영상, 모델 동일(Sonnet 5.5), Provider만 다름 |

## 1. 설치·실행 (REQ-BUILD-001, TEST-BUILD-01)

- [ ] `Setup CONTEXT.command` 더블클릭 → 모든 단계 ✔, `~/Library/Application Support/context-marketing-agent` 생성(권한 `drwx------`).
  - 확인: `ls -ld ~/Library/Application\ Support/context-marketing-agent` → `drwx------`, `stat -f %Lp .../context.db` → `600`.
- [ ] `Start CONTEXT.command` 더블클릭 → 브라우저에 `http://127.0.0.1:4317` 3열 대시보드, 헤더 `LOCAL READY`.
- [ ] 이미 실행 중일 때 `Start CONTEXT.command` 재실행 → 서버를 하나 더 띄우지 않고 기존 대시보드만 연다.
- [ ] `Stop CONTEXT.command` → "CONTEXT 종료됨", 포트 4317 해제 (`lsof -iTCP:4317`).
- [ ] Gatekeeper가 `.command` 실행을 막으면: Finder에서 우클릭 → 열기 (서명되지 않은 스크립트, docs/11 §5).

## 2. AI·데이터 (REQ-CTX-001/002, REQ-CMT-001~003, TEST-AI-01~05)

- [x] 2-1. (2026-10-21: YouTube LIVE, 50개) 대시보드 [영상 불러오기] → 헤더 YouTube `LIVE`, 5개 채널 최신 영상(썸네일·제목·채널·날짜).
- [ ] 2-2. 영상 하나를 **직접 시청**하고 실제 발언 1개 + 타임스탬프를 "직접 확인한 발언 추가"로 입력 (A 등급). **듣지 않은 문장을 입력하지 말 것.**
- [ ] 2-0. 헤더 AI 배지가 "Claude Code (구독 · 추가 비용 없음)"인지 확인. 설정 [CLI 확인] → 버전 표시. `.command`로 띄운 서버가 `claude`를 못 찾으면 `CONTEXT_CLAUDE_BIN=~/.local/bin/claude`를 지정.
- [ ] 2-3. 다시 분석 → A등급 근거가 있는 상태에서 PASS 후보가 나오는지 확인 (CLI Provider, 종량 청구 없음 — 구독 사용량만 소모).
- [ ] 2-5. 설정에서 Anthropic API Provider를 고르면 '종량 과금' 경고와 동의 체크 없이 저장되지 않는지 (실제로 켜지 말 것).
- [x] 2-4. (2026-10-21: 5개 채널 각 1개, B-2.0·claude -p, 초안 15개 모두 서로 다름·자막 발언 인용) 다른 영상 2개 이상에서 댓글이 서로 다르게 나오는지 (영상 고유성) 확인.

## 3. 실제 게시 (REQ-EXE-001/002, TEST-EXE-01 라이브) — **본인 소유 테스트 영상만**

준비: 본인 채널에 테스트 영상 업로드(일부 공개 가능, 댓글 허용), 설정에 본인 Channel ID(`UC...`) 입력.

- [x] 3-1. (2026-10-21 확인: check-auth `READY`, 앱과 같은 실행 옵션으로 연 YouTube 화면에서 로그인 상태 확인) [프로필] 유튜브1 → [로그인 창 열기] → 전용 Chrome 창에서 테스트용 Google 계정 직접 로그인 → 창 닫기 → [로그인 확인] = READY.
- [ ] 3-2. [테스트 영상] 본인 영상 URL + 소유 확인 체크 → `VERIFIED` (YouTube API로 채널 일치 확인).
- [ ] 3-3. 타인 채널 영상 URL을 테스트 영상으로 등록 시도 → `NOT_OWN_VIDEO`로 거부되는지.
- [ ] 3-4. PASS 후보 승인 → [테스트 실행] → 실제 Chrome이 열리고 한국어 YouTube에서 댓글창 → **한 글자씩 입력** → 게시 → 대시보드 `SUCCESS`(VERIFYING OK + 스크린샷).
- [ ] 3-5. 실제 YouTube 페이지를 새로고침해 댓글이 보이는지 사람이 확인 (작성자 = 테스트 계정).
- [ ] 3-6. 같은 영상에 다시 실행 → `VIDEO_ALREADY_CLAIMED` 차단.
- [ ] 3-7. YouTube UI 변경으로 셀렉터가 맞지 않으면 `apps/server/src/execution/playwrightDriver.ts`의 `YT_SELECTORS`만 수정. 실패 시 UNKNOWN/FAILED_PRE_SUBMIT 스크린샷 확인.
- 알려진 한계: 게시 확인은 "댓글 목록에 같은 원문이 보임" 기준이며 작성자 표시는 기록만 하고 채널 ID까지 대조하지 않는다 (YouTube가 @handle만 노출). 3-5의 사람 확인으로 보완.

## 4. 안전·정책 (REQ-EXE-003~005, TEST-POL-01/02, TEST-SEC-01~07)

- [ ] 4-1. 설정 화면에서 키 등록 → `security find-generic-password -s context-marketing-agent -a youtube` 로 항목 존재 확인 (값 출력 `-w` 사용 금지).
- [ ] 4-2. `~/Library/Application Support/context-marketing-agent/logs/server.log` 에 키 문자열이 없는지: `grep -cE 'sk-ant-|AIza' server.log` → 0.
- [ ] 4-3. 다른 사이트(예: 임의 HTML 파일)에서 `fetch('http://127.0.0.1:4317/api/videos/refresh', {method:'POST'})` → 403 (Origin/CSRF).
- [ ] 4-4. 게시 중(SUBMITTING~VERIFYING) Stop 또는 강제 종료 → 재시작 후 해당 실행 `UNKNOWN`, 자동 재게시 없음, [직접 확인] 버튼으로만 해소.
- [ ] 4-6. Keychain ACL: 다른 터미널에서 `security find-generic-password -s context-marketing-agent -a youtube` 실행 시 접근 허용 프롬프트가 뜨는지 확인 (값 출력 `-w`는 쓰지 말 것). 프롬프트 없이 접근되면 Keychain Access 앱에서 해당 항목의 접근 제어를 조정.
- [ ] 4-7. 실제 게시 테스트 전 테스트 영상에 **같은 문장의 댓글이 없는지** 확인 (원문 일치 기준 확인이라 오탐 방지).
- [ ] 4-5. 프로필 2개(유튜브1·2)로 같은 영상 동시 실행 → 하나만 claim (자동 테스트 F06은 통과, 실브라우저는 미확인).

## 5. Evaluation Lab (REQ-EVAL-001, TEST-EVAL-01)

- [ ] 5-1. Eval Lab → [장애 주입 10종 실행] → 10/10 PASS 표시 (자동 테스트에서는 통과; UI 실행은 로컬에서 확인).
- [ ] 5-2. 골든 15개: `evaluation/golden/dataset.json` 의 GOLDEN 사례에 실제 영상 ID·제목·**직접 확인한 발언**·사람 라벨(coreProblem 등)을 채우고 `status: "COLLECTED"`로 변경. 현재 15개 모두 미수집(1개 채널당 1개는 과제 PDF 예시 영상 ID만 기입, 내용 TO VERIFY).
- [ ] 5-3. 실제 Claude A/B (`live: true`, 비용 확인 체크) — 골든 수집 전에는 합성 적대 사례 5개만 실행됨. 표본이 작으므로 통계적 결론 금지.
- [ ] 5-4. 사람 라벨 입력 후 AI-사람 일치율이 MEASURED로 바뀌는지.
- 현재 상태: G1(데이터) NOT_RUN, G2(실제 AI 품질) NOT_RUN, G4(실제 게시) NOT_RUN, G6(제출) NOT_RUN.

## 6. 제출 (REQ-DOC-001, TEST-SUB-01)

- [ ] `docs/14_RELEASE_DEMO.md` 150초 스토리보드로 실제 화면 녹화 (성공하지 않은 장면을 성공처럼 편집 금지).
- [ ] 영상 링크 비로그인 재생 확인, 제작 의도 제출, (선택) Git 주소.
- [ ] 정확한 마감 시각 확인.

## 7. 밝은 테마·Sage 비서 (REQ-UX-002, REQ-UX-003, REQ-BUILD-001)

- [ ] 7-1. 실제 `claude -p` Provider로 Sage에 "오늘 게시 몇 개 남았어?", "지금 선택한 영상 요약해 줘"를 물어 답이 상황 요약 숫자와 일치하고 지어낸 수치가 없는지 확인 (TEST-SAGE-01 LIVE 판).
- [ ] 7-2. Safari·Firefox에서 밝은 테마·구슬 애니메이션·reduced-motion(시스템 설정 "동작 줄이기") 확인 (TEST-UX-02).
- [ ] 7-3. **PDF 재생성 — TO VERIFY**: `deliverables/CONTEXT_MASTER_PLAN.pdf` 생성 도구를 저장소에서 확인하지 못함(메타데이터 없음, pandoc·weasyprint 등 미설치). 2026-10-21 문서 변경(02·00·04·05·09·15·IMPLEMENTATION_STATUS)이 PDF에 반영되지 않았다. 원래 생성 방법으로 정본 Markdown에서 다시 만들 것.

## 8. 2026-10-21 추가 (자막·뜨기 직전·실게시 리허설)

- [x] 8-1. 공개 자막 수집: akn-AvCeHBI 외 5개 영상 자막 12~40구간 확보 (`yt-dlp` 2026.08.19).
- [x] 8-2. 뜨기 직전 찾기 실호출: 최근 '연애' 영상 50개 → 19개 조건 충족, 전부 draftOnly.
- [x] 8-3. 게시 없는 실제 YouTube 리허설(`.reel/dryrun.mjs`, 제출 클릭 코드 없음): 한국어 화면·로그인 판정·댓글창·입력창·한 글자씩 입력 문장 일치·게시 버튼 활성·[취소] 확인. 실측으로 아바타 지연 렌더링 문제 발견 → 드라이버 수정(4b50fb5).
- [x] 8-4. **실제 게시 (2026-10-21)**: 본인 채널(UCAP7Ud89f9gJHbWm4_LNJhA)에 일부 공개 테스트 영상 3개 업로드(리허설 -FmXpsRA-BM · 녹화 RuxxJ4aNlMM · 예비 PYb7HrpSQv0), 3개 모두 소유 확인 VERIFIED. 리허설 영상에 러브커넥트 유지연 c5vYhdNbkdk의 QUESTION 초안(81점) 승인 → [댓글 달기] → PREFLIGHT~VERIFYING 전 단계 OK, `SUCCESS`(작성자 @athem11111). 로그아웃 상태의 별도 브라우저로 영상을 열어 같은 문장의 댓글이 공개 표시됨을 독립 확인.
- [x] 8-5. 시연 녹화 (2026-10-21): macOS `screencapture`로 대시보드 영역만 녹화, docs/14 스토리보드 순서로 조작. 녹화 중 녹화용 영상 RuxxJ4aNlMM에 실제 게시 `SUCCESS`, 재게시 차단·실행 기록·뜨기 직전 포함. 앞뒤 설명 화면을 붙여 2분 4초(`.reel/demo-out/CONTEXT_demo.mp4`, 저장소 미포함). 커서 점·자막은 녹화 페이지에만 얹은 표시이며 앱 코드는 바꾸지 않음.
- [x] 8-6. 시연 영상 일부 공개 업로드 (2026-10-22): https://youtu.be/cv8VmXWAFYc — 로그인하지 않은 브라우저에서 playabilityStatus `OK`, isUnlisted true, 124초 확인. 제출 양식에 이 링크를 넣는다.
- 주의: 진단 중 Playwright 기본값(`--use-mock-keychain`)으로 프로필을 한 번 열어 로그인 쿠키가 삭제된 적 있음 → 재로그인. 앱 본체는 `REAL_CHROME_IGNORED_DEFAULT_ARGS`로 이 옵션을 끄므로 해당 없음. 프로필 폴더를 직접 여는 스크립트는 반드시 같은 옵션을 쓸 것.
