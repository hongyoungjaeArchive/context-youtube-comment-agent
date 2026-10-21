# 11. macOS 원클릭 실행 및 Git 제출

## 1. 16차 C안 확정

Electron 미채택. React 프로덕션 번들과 Node 로컬 백엔드, SQLite를 실행하는 **macOS `.command` 더블클릭 런처**를 개발 대상으로 한다. 최초 설치(`Setup`)와 평소 실행(`Launch`) 분리. 최종 `.app` 서명/공증 배포는 기본 범위가 아니다.

## 2. Setup 1회 프로세스

- 실행 OS/CPU, 지원 Node 버전, Google Chrome 여부와 쓰기 권한 검사.
- lockfile 기반 의존성 설치, 앱 빌드, SQLite 스키마 초기화·마이그레이션, Application Support 데이터 폴더 생성.
- Keychain 연동 접근 가능 확인 및 Claude/YouTube 키 등록 안내.
- 테스트 전용 Chrome 디렉터리 생성·로그인 안내. 본인 테스트 영상 소유 확인이 없으면 실행 비활성.
- 설정 이상 발생 시 각 단계 원인과 직접 해결 방식 표시; 설치 성공을 가짜로 표시하지 않음.

## 3. 일상 실행

- `.command` 더블클릭 → 설치 확인 → 이미 실행 중인지 감지 → 127.0.0.1 로컬 백엔드 실행 → health check → 프리미엄 3열 대시보드 열기.
- 재실행 시 중복 서버/작업 큐/Playwright context를 생성하지 않음.
- 오프라인에서도 앱/이전 자료는 조회 가능, YouTube/Claude 관련 기능은 연결 불가 상태로 처리.
- 종료는 앱의 `프로그램 종료`을 통해 안전하게. 제출 중 종료 요청 시 UNKNOWN 복구 정책 준수.

## 4. 저장소 범위

권장 monorepo:

| 경로 | 내용 |
|---|---|
| `apps/dashboard/` | React/Vite/Tailwind UI |
| `apps/server/` | 로컬 API, 세션, 권한·health check |
| `packages/agents/` | 5개 에이전트 역할 |
| `packages/orchestrator/` | 큐·모델 분담·예산·캐시 |
| `packages/database/` | SQLite·migration·감사 로그 |
| `packages/browser/` | Playwright 테스트 전용 실행 |
| `packages/security/` | Keychain·파일 권한·redaction |
| `packages/shared/` | 타입·스키마·요구사항 ID |
| `evaluation/` | 데이터셋·A/B·회귀·결과 생성 |
| `tests/` | 기능·통합·E2E·장애 주입 |
| `launcher/` | Setup·Launch·Shutdown |
| `docs/` | 기획 정본과 릴리스 자료 |
| `CLAUDE.md` | 목표 불변·읽기 인덱스 |

## 5. Git 및 안전한 배포

- API 키·Keychain 비밀·Chrome 세션·실데이터 DB·트레이스/스크린샷 민감 자료는 Git에 포함 금지.
- 예제 데이터는 `DEMO/SYNTHETIC`과 `ACTUAL/OBSERVED`를 명확히 구분.
- `README`는 기초 환경·설치·실행·테스트·알려진 제약·정확한 모델/요금 검증 링크 제공.
- 서명되지 않은 앱 번들 실행을 모든 Mac에 보장한다고 표현하지 않음. 실제 검증 환경과 macOS Gatekeeper 제한 명시.

## 6. 제출 패키지

과제 원문 p.5: (1) 2~3분 시연 영상 필수: 링크가 공개 접근 가능해야 함. (2) Git 프로그램 선택. (3) 제작 의도 제출 요청. p.7: 1인 1트랙, AI 도구 사용 제한 없음, 오픈소스 출처 표시, 타인 결과 도용 금지.

**마감:** 2026-10-20 (KST). **마감 시각:** 현재 미확인. 이 문서는 업로드·제출을 대신 수행하지 않으며, 결과물이 없는 상태에서 제출 성공을 말하지 않는다.
