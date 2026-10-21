#!/bin/bash
# CONTEXT 원클릭 실행: 설치 확인 → 중복 실행 감지 → 127.0.0.1 서버 시작 → health check → 대시보드 열기.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
DATA_DIR="${CONTEXT_DATA_DIR:-$HOME/Library/Application Support/context-marketing-agent}"
PORT="${CONTEXT_PORT:-4317}"
URL="http://127.0.0.1:$PORT"
LOG_DIR="$DATA_DIR/logs"

open_dashboard() { [ "${CONTEXT_NO_OPEN:-0}" = "1" ] || open "$URL"; }
health() { curl -fsS --max-time 2 "$URL/api/health" 2>/dev/null | grep -q '"status":"LOCAL_READY"'; }

if [ ! -f "$DATA_DIR/run/setup-complete" ] || [ ! -f apps/server/dist/index.js ] || [ ! -f apps/web/dist/index.html ]; then
  echo "Setup이 필요합니다. Setup을 먼저 실행합니다..."
  ./scripts/setup.sh
fi

if health; then
  echo "CONTEXT가 이미 실행 중입니다 → $URL"
  open_dashboard
  exit 0
fi
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "포트 $PORT를 다른 프로그램이 사용 중입니다. 해당 프로그램을 종료하거나 CONTEXT_PORT를 바꿔 실행하세요."
  exit 1
fi

mkdir -p "$LOG_DIR"
echo "CONTEXT 로컬 서버 시작 (로그: $LOG_DIR/server.log)"
CONTEXT_PORT="$PORT" CONTEXT_DATA_DIR="$DATA_DIR" nohup node apps/server/dist/index.js >> "$LOG_DIR/server.log" 2>&1 &
for _ in $(seq 1 60); do
  if health; then
    echo "준비 완료 → $URL"
    open_dashboard
    exit 0
  fi
  sleep 0.5
done
echo "서버가 30초 안에 준비되지 않았습니다. 로그를 확인하세요: $LOG_DIR/server.log"
tail -n 20 "$LOG_DIR/server.log" || true
exit 1
