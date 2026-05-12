#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/logs/restart.pid"
LOG_FILE="$ROOT_DIR/logs/restart.log"

load_env_file() {
    if [[ -f "$ROOT_DIR/.env" ]]; then
        set -a
        # shellcheck disable=SC1091
        source "$ROOT_DIR/.env"
        set +a
    fi
}

configure_proxy() {
    if [[ -n "${APP_PROXY_URL:-}" ]]; then
        export HTTP_PROXY="${HTTP_PROXY:-$APP_PROXY_URL}"
        export HTTPS_PROXY="${HTTPS_PROXY:-$APP_PROXY_URL}"
        export ALL_PROXY="${ALL_PROXY:-$APP_PROXY_URL}"
        export http_proxy="${http_proxy:-$APP_PROXY_URL}"
        export https_proxy="${https_proxy:-$APP_PROXY_URL}"
        export all_proxy="${all_proxy:-$APP_PROXY_URL}"
    fi
}

ensure_python() {
    if command -v python3 >/dev/null 2>&1; then
        PYTHON_BIN="${PYTHON_BIN:-python3}"
    elif command -v python >/dev/null 2>&1; then
        PYTHON_BIN="${PYTHON_BIN:-python}"
    else
        echo "Python was not found. Install Python 3 first." >&2
        exit 1
    fi

    if ! "$PYTHON_BIN" - <<'PY' >/dev/null 2>&1
import flask
import redis
PY
    then
        echo "Installing Python dependencies from requirements.txt..."
        "$PYTHON_BIN" -m pip install -r "$ROOT_DIR/requirements.txt"
    fi
}

stop_old_listener() {
    local port="${APP_PORT:-9212}"
    local pid=""

    if command -v lsof >/dev/null 2>&1; then
        pid="$(lsof -ti tcp:"$port" 2>/dev/null | head -n 1 || true)"
    elif command -v ss >/dev/null 2>&1; then
        pid="$(ss -ltnp 2>/dev/null | grep ":${port} " | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' | head -n 1 || true)"
    elif command -v netstat >/dev/null 2>&1; then
        pid="$(netstat -ano 2>/dev/null | awk -v target=":${port}" '
            $0 ~ target && ($0 ~ /LISTENING/ || $0 ~ /LISTEN/) {
                print $NF
                exit
            }
        ' || true)"
    fi

    if [[ -n "$pid" ]]; then
        echo "Stopping existing process on port ${port} (PID ${pid})..."
        if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* || "${OSTYPE:-}" == win32* ]]; then
            taskkill /PID "$pid" /T /F >/dev/null 2>&1 || true
        else
            kill -TERM "$pid" >/dev/null 2>&1 || true
            sleep 1
            kill -KILL "$pid" >/dev/null 2>&1 || true
        fi
    fi
}

run_monitor() {
    mkdir -p "$ROOT_DIR/logs"
    cd "$ROOT_DIR"
    export APP_HOST="${APP_HOST:-0.0.0.0}"
    export APP_PORT="${APP_PORT:-9212}"

    trap 'rm -f "$PID_FILE"; exit 0' INT TERM

    while true; do
        echo "$$" >"$PID_FILE"
        echo "Starting app on http://127.0.0.1:${APP_PORT}"
        "$PYTHON_BIN" -u app.py >>"$LOG_FILE" 2>&1 &
        app_pid=$!
        wait "$app_pid" || true
        echo "App exited. Restarting in 2 seconds..."
        sleep 2
    done
}

start_daemon() {
    mkdir -p "$ROOT_DIR/logs"
    stop_old_listener

    if [[ -f "$PID_FILE" ]]; then
        old_pid="$(tr -d '\r\n' < "$PID_FILE" || true)"
        if [[ -n "$old_pid" ]]; then
            if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* || "${OSTYPE:-}" == win32* ]]; then
                taskkill /PID "$old_pid" /T /F >/dev/null 2>&1 || true
            else
                kill -TERM "$old_pid" >/dev/null 2>&1 || true
            fi
        fi
    fi

    nohup "$ROOT_DIR/restart.sh" --monitor >/dev/null 2>&1 </dev/null &
    sleep 2
}

stop_daemon() {
    if [[ -f "$PID_FILE" ]]; then
        pid="$(tr -d '\r\n' < "$PID_FILE" || true)"
        if [[ -n "$pid" ]]; then
            if [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* || "${OSTYPE:-}" == win32* ]]; then
                taskkill /PID "$pid" /T /F >/dev/null 2>&1 || true
            else
                kill -TERM "$pid" >/dev/null 2>&1 || true
            fi
        fi
        rm -f "$PID_FILE"
    fi
}

status_daemon() {
    if [[ -f "$PID_FILE" ]]; then
        pid="$(tr -d '\r\n' < "$PID_FILE" || true)"
        if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
            echo "running pid=$pid port=${APP_PORT:-9212}"
            return 0
        fi
    fi
    echo "stopped"
    return 1
}

main() {
    load_env_file
    configure_proxy
    ensure_python

    case "${1:-start}" in
        --monitor)
            run_monitor
            ;;
        start)
            start_daemon
            echo "Started. Open http://127.0.0.1:${APP_PORT:-9212}"
            ;;
        stop)
            stop_daemon
            echo "Stopped."
            ;;
        restart)
            stop_daemon
            start_daemon
            echo "Restarted. Open http://127.0.0.1:${APP_PORT:-9212}"
            ;;
        status)
            status_daemon
            ;;
        *)
            echo "Usage: $0 {start|stop|restart|status}" >&2
            exit 1
            ;;
    esac
}

cd "$ROOT_DIR"
main "$@"
