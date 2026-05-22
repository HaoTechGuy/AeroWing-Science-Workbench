#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

HOST="127.0.0.1"
BACKEND_PORT="${INTERNAGENTS_BACKEND_PORT:-2024}"
LOCAL_RUNTIME_PORT="${INTERNAGENTS_LOCAL_RUNTIME_PORT:-22024}"
UI_PORT="${INTERNAGENTS_UI_PORT:-3000}"
OPEN_BROWSER="${INTERNAGENTS_OPEN_BROWSER:-1}"
SKIP_INSTALL="${INTERNAGENTS_SKIP_INSTALL:-0}"
ASSISTANT_ID="${INTERNAGENTS_ASSISTANT_ID:-agent_local}"

RUNTIME_DIR="$ROOT_DIR/.internagents"
LOG_DIR="$RUNTIME_DIR/logs"
PID_DIR="$RUNTIME_DIR/pids"
BACKEND_LOG="$LOG_DIR/backend.log"
LOCAL_RUNTIME_LOG="$LOG_DIR/local-runtime.log"
UI_LOG="$LOG_DIR/ui.log"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
LOCAL_RUNTIME_PID_FILE="$PID_DIR/local-runtime.pid"
UI_PID_FILE="$PID_DIR/ui.pid"

PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
BACKEND_URL="http://$HOST:$BACKEND_PORT"
LOCAL_RUNTIME_URL="http://$HOST:$LOCAL_RUNTIME_PORT"
UI_URL="http://$HOST:$UI_PORT"
APP_URL="$UI_URL/?assistantId=$ASSISTANT_ID"

BACKEND_OWNED=0
LOCAL_RUNTIME_OWNED=0
UI_OWNED=0
BACKEND_PID=""
LOCAL_RUNTIME_PID=""
UI_PID=""

log() {
  printf '[InternAgents] %s\n' "$*"
}

die() {
  printf '[InternAgents] Error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

print_log_tail() {
  local label="$1"
  local file="$2"
  if [ -f "$file" ]; then
    printf '\n---- %s log: %s ----\n' "$label" "$file" >&2
    tail -80 "$file" >&2 || true
    printf '%s\n\n' '---- end log ----' >&2
  fi
}

url_ok() {
  curl -fsS --max-time 2 "$1" >/dev/null 2>&1
}

port_open() {
  "$PYTHON_BIN" - "$HOST" "$1" <<'PY' >/dev/null 2>&1
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.settimeout(0.5)
    sys.exit(0 if sock.connect_ex((host, port)) == 0 else 1)
PY
}

wait_for_url() {
  local label="$1"
  local url="$2"
  local log_file="$3"
  local pid="${4:-}"
  local timeout="${5:-120}"
  local start
  start="$(date +%s)"

  while true; do
    if url_ok "$url"; then
      log "$label is ready: $url"
      return 0
    fi

    if [ -n "$pid" ] && ! kill -0 "$pid" >/dev/null 2>&1; then
      print_log_tail "$label" "$log_file"
      die "$label process exited before becoming ready."
    fi

    if [ $(( $(date +%s) - start )) -ge "$timeout" ]; then
      print_log_tail "$label" "$log_file"
      die "$label did not become ready within ${timeout}s: $url"
    fi

    sleep 1
  done
}

terminate_pid() {
  local label="$1"
  local pid="$2"
  [ -n "$pid" ] || return 0
  kill -0 "$pid" >/dev/null 2>&1 || return 0

  log "Stopping $label (pid $pid)..."
  if command -v pkill >/dev/null 2>&1; then
    pkill -TERM -P "$pid" >/dev/null 2>&1 || true
  fi
  kill -TERM "$pid" >/dev/null 2>&1 || true

  for _ in 1 2 3 4 5; do
    kill -0 "$pid" >/dev/null 2>&1 || return 0
    sleep 1
  done

  if command -v pkill >/dev/null 2>&1; then
    pkill -KILL -P "$pid" >/dev/null 2>&1 || true
  fi
  kill -KILL "$pid" >/dev/null 2>&1 || true
}

cleanup() {
  local exit_code="${1:-$?}"
  trap - EXIT INT TERM

  if [ "$UI_OWNED" = "1" ]; then
    terminate_pid "frontend" "$UI_PID"
    rm -f "$UI_PID_FILE"
  fi
  if [ "$BACKEND_OWNED" = "1" ]; then
    terminate_pid "backend" "$BACKEND_PID"
    rm -f "$BACKEND_PID_FILE"
  fi
  if [ "$LOCAL_RUNTIME_OWNED" = "1" ]; then
    terminate_pid "local runtime" "$LOCAL_RUNTIME_PID"
    rm -f "$LOCAL_RUNTIME_PID_FILE"
  fi

  exit "$exit_code"
}

trap 'cleanup 130' INT
trap 'cleanup 143' TERM
trap 'cleanup $?' EXIT

open_browser() {
  [ "$OPEN_BROWSER" != "0" ] || return 0

  if command -v open >/dev/null 2>&1; then
    open "$APP_URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$APP_URL" >/dev/null 2>&1 || true
  else
    log "Open this URL in your browser: $APP_URL"
  fi
}

install_dependencies() {
  require_command python3

  if [ ! -x "$PYTHON_BIN" ]; then
    log "Creating Python virtual environment at .venv..."
    python3 -m venv "$ROOT_DIR/.venv"
  fi

  if [ ! -f "$ROOT_DIR/.env" ] && [ -f "$ROOT_DIR/.env.example" ]; then
    log "Creating .env from .env.example..."
    cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  fi

  log "Installing Python package in editable mode..."
  "$PYTHON_BIN" -m pip install -e .

  if [ ! -d "$ROOT_DIR/ui/node_modules" ]; then
    require_command npm
    log "Installing UI dependencies..."
    (cd "$ROOT_DIR/ui" && npm install --legacy-peer-deps --ignore-scripts)
  fi
}

prepare_environment() {
  mkdir -p "$LOG_DIR" "$PID_DIR"

  if [ "$SKIP_INSTALL" = "1" ]; then
    [ -x "$PYTHON_BIN" ] || die ".venv is missing. Unset INTERNAGENTS_SKIP_INSTALL or create it first."
    [ -d "$ROOT_DIR/ui/node_modules" ] || die "ui/node_modules is missing. Unset INTERNAGENTS_SKIP_INSTALL or run npm install first."
  else
    install_dependencies
  fi

  require_command curl
  require_command npm
}

start_local_runtime() {
  if url_ok "$LOCAL_RUNTIME_URL/ok"; then
    log "Reusing existing local runtime: $LOCAL_RUNTIME_URL"
    rm -f "$LOCAL_RUNTIME_PID_FILE"
    return 0
  fi

  if port_open "$LOCAL_RUNTIME_PORT"; then
    die "Port $LOCAL_RUNTIME_PORT is in use, but $LOCAL_RUNTIME_URL/ok is not healthy."
  fi

  : > "$LOCAL_RUNTIME_LOG"
  log "Starting local agent runtime on $LOCAL_RUNTIME_URL..."
  (
    cd "$ROOT_DIR"
    INTERNAGENT_PROCESS_ROLE=runtime \
    INTERNAGENT_RUNTIME_ID=local \
      "$PYTHON_BIN" -m langgraph_cli dev \
        --host "$HOST" \
        --port "$LOCAL_RUNTIME_PORT" \
        --no-browser \
        --config langgraph.runtime.json
  ) >>"$LOCAL_RUNTIME_LOG" 2>&1 &

  LOCAL_RUNTIME_PID="$!"
  LOCAL_RUNTIME_OWNED=1
  printf '%s\n' "$LOCAL_RUNTIME_PID" > "$LOCAL_RUNTIME_PID_FILE"
  wait_for_url "Local runtime" "$LOCAL_RUNTIME_URL/ok" "$LOCAL_RUNTIME_LOG" "$LOCAL_RUNTIME_PID"
}

start_backend() {
  if url_ok "$BACKEND_URL/ok"; then
    log "Reusing existing backend: $BACKEND_URL"
    rm -f "$BACKEND_PID_FILE"
    return 0
  fi

  if port_open "$BACKEND_PORT"; then
    die "Port $BACKEND_PORT is in use, but $BACKEND_URL/ok is not healthy."
  fi

  : > "$BACKEND_LOG"
  log "Starting backend on $BACKEND_URL..."
  (
    cd "$ROOT_DIR"
    "$PYTHON_BIN" -m langgraph_cli dev \
      --host "$HOST" \
      --port "$BACKEND_PORT" \
      --no-browser \
      --config langgraph.json
  ) >>"$BACKEND_LOG" 2>&1 &

  BACKEND_PID="$!"
  BACKEND_OWNED=1
  printf '%s\n' "$BACKEND_PID" > "$BACKEND_PID_FILE"
  wait_for_url "Backend" "$BACKEND_URL/ok" "$BACKEND_LOG" "$BACKEND_PID"
}

start_frontend() {
  if url_ok "$UI_URL"; then
    log "Reusing existing frontend: $UI_URL"
    rm -f "$UI_PID_FILE"
    return 0
  fi

  if port_open "$UI_PORT"; then
    die "Port $UI_PORT is in use, but $UI_URL is not serving InternAgents."
  fi

  : > "$UI_LOG"
  log "Starting frontend on $UI_URL..."
  (
    cd "$ROOT_DIR/ui"
    INTERNAGENTS_APP_ROOT="$ROOT_DIR" \
    NEXT_PUBLIC_LANGGRAPH_DEPLOYMENT_URL="$BACKEND_URL" \
    NEXT_PUBLIC_LANGGRAPH_ASSISTANT_ID="$ASSISTANT_ID" \
      npm run dev -- --hostname "$HOST" --port "$UI_PORT"
  ) >>"$UI_LOG" 2>&1 &

  UI_PID="$!"
  UI_OWNED=1
  printf '%s\n' "$UI_PID" > "$UI_PID_FILE"
  wait_for_url "Frontend" "$UI_URL" "$UI_LOG" "$UI_PID"
}

monitor_processes() {
  log "InternAgents is running."
  log "UI:      $APP_URL"
  log "Backend: $BACKEND_URL"
  log "Runtime: $LOCAL_RUNTIME_URL"
  log "Logs:    $LOG_DIR"
  log "Press Ctrl+C to stop services started by this script."

  while true; do
    if [ "$LOCAL_RUNTIME_OWNED" = "1" ] && ! kill -0 "$LOCAL_RUNTIME_PID" >/dev/null 2>&1; then
      print_log_tail "local runtime" "$LOCAL_RUNTIME_LOG"
      die "Local runtime process exited."
    fi
    if [ "$BACKEND_OWNED" = "1" ] && ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
      print_log_tail "backend" "$BACKEND_LOG"
      die "Backend process exited."
    fi
    if [ "$UI_OWNED" = "1" ] && ! kill -0 "$UI_PID" >/dev/null 2>&1; then
      print_log_tail "frontend" "$UI_LOG"
      die "Frontend process exited."
    fi
    sleep 2
  done
}

prepare_environment
start_local_runtime
start_backend
start_frontend
open_browser
monitor_processes
