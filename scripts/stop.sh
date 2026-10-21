#!/bin/bash
# 안전 종료: SIGTERM → 서버가 큐를 멈추고 진행 중 게시 실행을 기다린 뒤 종료 (강제 종료 시 다음 시작에서 UNKNOWN/INTERRUPTED 복구).
set -euo pipefail
DATA_DIR="${CONTEXT_DATA_DIR:-$HOME/Library/Application Support/context-marketing-agent}"
PID_FILE="$DATA_DIR/run/server.pid"
if [ ! -f "$PID_FILE" ]; then echo "실행 중인 CONTEXT 서버가 없습니다."; exit 0; fi
PID=$(cat "$PID_FILE")
if ! kill -0 "$PID" 2>/dev/null; then echo "프로세스 $PID 없음 — pid 파일 정리"; rm -f "$PID_FILE"; exit 0; fi
kill -TERM "$PID"
for _ in $(seq 1 60); do kill -0 "$PID" 2>/dev/null || { echo "CONTEXT 종료됨"; exit 0; }; sleep 0.5; done
echo "30초 안에 종료되지 않았습니다 (게시 실행 대기 중일 수 있음). 필요하면 'kill $PID'로 직접 종료하세요."
