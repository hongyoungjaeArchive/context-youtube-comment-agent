#!/bin/bash
# CONTEXT macOS 1회 Setup (docs/11 §2). 각 단계 실패 시 원인과 해결 방법을 출력하고 중단한다.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
REPO="$(pwd)"
DATA_DIR="${CONTEXT_DATA_DIR:-$HOME/Library/Application Support/context-marketing-agent}"
ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✖ %s\033[0m\n    해결: %s\n' "$1" "$2"; exit 1; }

echo "== CONTEXT Setup =="
[ "$(uname -s)" = "Darwin" ] || fail "macOS가 아닙니다." "이 Setup은 macOS 전용입니다."
ok "macOS $(sw_vers -productVersion) / $(uname -m)"

command -v node >/dev/null 2>&1 || fail "Node.js가 없습니다." "https://nodejs.org 에서 Node 22.12 이상을 설치하세요 (또는 brew install node)."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
NODE_MINOR=$(node -p 'process.versions.node.split(".")[1]')
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 12 ]; }; then
  fail "Node $(node -v)는 지원하지 않습니다." "Node 22.12 이상으로 업그레이드하세요."
fi
ok "Node $(node -v), npm $(npm -v)"

if [ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ]; then
  ok "Google Chrome 설치 확인"
else
  warn "Google Chrome이 없습니다 — 분석은 가능하지만 테스트 게시는 불가. https://www.google.com/chrome 설치 후 다시 실행하세요."
fi

CLAUDE_BIN="$(command -v claude || true)"
[ -z "$CLAUDE_BIN" ] && [ -x "$HOME/.local/bin/claude" ] && CLAUDE_BIN="$HOME/.local/bin/claude"
if [ -n "$CLAUDE_BIN" ]; then
  ok "Claude Code CLI $("$CLAUDE_BIN" --version 2>/dev/null | head -1) — 기본 AI Provider (구독 사용량, 추가 비용 없음)"
else
  warn "Claude Code CLI(claude)가 없습니다 — AI 분석은 모의 모드로 동작합니다. 설치·로그인 후 다시 실행하세요."
fi

[ -w "$REPO" ] || fail "저장소 폴더에 쓰기 권한이 없습니다." "Desktop/iCloud 동기화 폴더가 아닌 곳으로 옮기거나 권한을 확인하세요."

echo "-- 의존성 설치 (lockfile 기준)"
npm ci --no-audit --no-fund >/dev/null || fail "npm ci 실패" "네트워크를 확인하고 'npm ci'를 직접 실행해 오류를 확인하세요."
ok "의존성 설치"

echo "-- 빌드"
npm run build >/dev/null || fail "빌드 실패" "'npm run build'를 직접 실행해 오류를 확인하세요."
ok "shared / server / web 빌드"

echo "-- 데이터 폴더·SQLite 초기화"
CONTEXT_DATA_DIR="$DATA_DIR" node apps/server/dist/cli/init.js || fail "DB 초기화 실패" "디스크 공간·권한을 확인하세요."
ok "Application Support 데이터 폴더 (권한 0700)"

echo "-- macOS Keychain (서비스명 context-marketing-agent) — 값은 읽지 않고 등록 여부만 확인"
for acct in anthropic youtube; do
  if security find-generic-password -s context-marketing-agent -a "$acct" >/dev/null 2>&1; then ok "$acct 키 등록됨"; else warn "$acct 키 미등록 — 앱 설정 화면에서 등록하세요 (미등록 시 모의/합성 모드)."; fi
done

echo "-- 테스트 전용 Chrome 프로필"
warn "앱의 [프로필] 화면에서 '유튜브1 로그인 창 열기'로 직접 Google 로그인하세요. 평소 쓰는 Chrome 프로필은 사용하지 않습니다."
warn "본인 소유 테스트 영상을 [테스트 영상]에서 등록·소유 확인하기 전에는 게시 버튼이 비활성입니다."

mkdir -p "$DATA_DIR/run" && date -u +%Y-%m-%dT%H:%M:%SZ > "$DATA_DIR/run/setup-complete"
echo "== Setup 완료. 이제 'Start CONTEXT.command'를 더블클릭하세요. =="
