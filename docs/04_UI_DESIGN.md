# 04. UI/UX 디자인 명세 — Premium AI Marketing SaaS

## 1. 디자인 목표와 뷰포트

- 밝은 웜그레이 기반 업무용 SaaS(CHG-2026-10-21-01). 움직임은 흐림→선명 등장·카드 순차 등장·호버 떠오름·Sage 구슬로 한정하고 `prefers-reduced-motion`이면 끈다. 읽기·검증·작업 상태 강조.
- 최우선 데스크톱 1440px, 1280px에서 3열 유지. 작은 화면에서는 가운데 영역 우선 노출하되 공식 3열 동선에 접근 가능하도록 적응.
- 왼쪽 29% (영상 탐색) / 가운데 43% (AI 분석·편집) / 오른쪽 28% (승인·실행); 상단 헤더·하단 Activity Center.
- 글로벌 상태: `LOCAL READY`, `API DISCONNECTED`, `TEST MODE`, `READ-ONLY`, `BUSY`, `ERROR`.

## 2. 디자인 토큰

| Token | 값 | 사용 |
|---|---|---|
| bg.default | `#ECEAE5` | 배경(웜그레이) |
| bg.surface | `#FFFFFF` | 패널 |
| bg.elevated | `#F6F5F2` | 카드·팝오버 |
| accent.primary | `#4E6B57` | 선택/강조(세이지 그린) |
| accent.strong | `#3F5A47` | 강조 텍스트 |
| action.primary | `#1A1A1A` 배경 + 흰 글자, 알약형 | 주요 행동 버튼 |
| status.success | `#18704F` | 실제 검증 통과 |
| status.warning | `#8F5600` | 확인 필요 |
| status.danger | `#B3364A` | 차단·오류 |
| fg.main | `#1A1A1A` | 주요 텍스트 |
| fg.muted | `#646464` | 보조 텍스트 |
| sage.orb | `#4F5BFF → #8EA2FF` 방사 그라데이션 | Sage 구슬 |
| radius.card | 16px | 카드 |
| shadow.card | 아주 옅은 2단 그림자 | 패널·헤더 버튼 |
| gap.panel | 16px | 패널 간격 |
| padding.panel | 20px | 패널 내부 |
| font | Pretendard / system fallback | 한국어 UI |
| size.body | 14~15px | 본문 |
| size.helper | 12~13px | 보조 설명 |

색상만으로 상태를 알리지 않으며 상태 아이콘과 글자를 함께 사용한다. 주요 버튼 40~44px, 명시적 포커스/비활성 상태, 명암 대비를 검증한다.

## 3. 화면 구조

### 상단: Global Header

- 로고 `CONTEXT`, 로컬 서버 연결, 현재 작업 ID, `테스트 모드`, 설정 및 Evaluation Lab 링크.
- `모의 분석`과 `실제 Claude 분석`이 다르면 결과에 명백한 라벨을 붙인다.

### 1열: Video Discovery

- `영상 불러오기` 주요 버튼, 마지막 갱신 시간, 5개 채널 안내.
- URL 직접 입력, 정렬(추천·최신·채널), 메타데이터 썸네일/제목/채널/날짜.
- 마케팅 추천 점수(0~100), `근거 확보` 별도 표시. 점수 미산출은 `평가 불가`, 0으로 위장하지 않음.
- 추천 이유 접기/펼치기와 후보 미리보기. 클릭하면 중앙 패널 전환.

### 2열: AI Intelligence Workspace

- 선택 영상/요약 + `core_problem` 한 줄.
- 원문 근거별 신뢰도 `A 직접확인 / B 공식 메타 / C 댓글 반응 / D 추론(인용 금지)`; 발언 근거에는 영상 타임스탬프.
- `A 공감형`, `B 질문형`, `C 정보형` 후보 3개 세로 카드(코멘트 전문, 5개 품질 항목, 위험, 추천 이유).
- 선택 후보 편집창 + 글자 수 + 정적 검증 + `AI 재검증`.
- 수정 즉시 이전 `quality_review`·`approval` 상태 무효화. 자동 호출은 하지 않음.

### 3열: Execution Control

- 댓글 품질 통과/수정 필요/자료 부족을 표시.
- 최종 승인한 텍스트 전문 및 해시 대조, 테스트 영상 소유권 확인, 프로필 유튜브1~3 수동 선택.
- `운영자 승인`과 `테스트 실행` 버튼 분리.
- 실행 단계 실시간 진행: OPEN → AUTH → NAVIGATE → TYPE → SUBMIT → VERIFY.
- 실패 시 메시지·캡처 링크·복구 정책 표시. `UNKNOWN`은 성공 색으로 보이지 않음.

### 하단: Activity Center

탭: `작업 큐`, `AI 사용량`, `실행 로그`, `오류 기록`. 기록에 실제/모의·시간·요청 ID·프로필 별칭 표시. 키/세션 비밀 값 표시 금지.

## 4. 보조 화면

- `Settings`: Claude/YouTube API 등록 상태, 모델별 설정, 예산, 로그 삭제·백업.
- `Profile Manager`: 최대 3개 전용 테스트 프로필 등록/인증 상태/잠금/삭제.
- `Evaluation Lab`: 평가 영상 15개, 프롬프트 A/B 및 회귀, 장애 주입, 테스트 증거.
- `Execution History`: 시간순 성공/실패/UNKNOWN, 승인 버전 및 스크린샷 참조.

## 5. 중요 컴포넌트 상태

| 컴포넌트 | 필수 상태 |
|---|---|
| VideoList | EMPTY, LOADING, LOADED, STALE, ERROR |
| EvidencePanel | VERIFIED, PARTIAL, UNKNOWN, CONFLICT |
| CandidateCard | NOT_SELECTED, SELECTED, REJECTED |
| CommentEditor | CLEAN, DIRTY, STATIC_ERROR, REVALIDATING, READY |
| ApprovalControl | DISABLED, READY, APPROVED, INVALIDATED |
| ExecutionTimeline | WAITING, RUNNING, SUCCESS, FAILED, UNKNOWN |
| ProfilePicker | REGISTERED, AUTH_REQUIRED, LOCKED, ERROR |

## 5-1. Sage 비서 (REQ-UX-003)

- 진입: 오른쪽 아래 "Sage에게 묻기" 알약 버튼, 헤더 질문창("검색하거나 Sage에게 묻기…"). 첫 방문에 화면 위쪽 가운데 인사 말풍선 4초(클릭을 가리지 않음).
- 패널: 오른쪽 380px, 열리면 3열이 같은 비율로 줄어든다. 큰 구슬·인사·추천 질문 3개·대화(메모리만)·입력창(1~500자). Esc·닫기 버튼으로 닫고 런처로 포커스 복귀.
- 답변 근거는 서버가 만든 콘솔 상황 요약(오늘 게시 수/한도, 작업 큐, Provider, 선택 영상의 분석·후보 승인 상태, 최근 실행 3건)뿐이다. Sage는 게시·승인·설정 변경을 하지 않는다.
- 구슬은 장식(`aria-hidden`): 숨쉬기, 3~6초 랜덤 깜빡임, 마우스 방향 눈동자, 답변 대기 중 빠른 맥동. reduced-motion이면 정지.

## 6. 사용성 테스트

처음 보는 사용자에게 3열에서 영상 선택→후보 비교→승인/실행 가능 여부 판단을 요청한다. 클릭 수보다 **잘못된 승인·게시 조작이 발생하지 않는지**와 단서의 충분성을 우선한다. 테스트 완료와 공식 사용성 10점을 동일하게 취급하지 않는다.
