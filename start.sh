#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ -f ".env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source ".env"
    set +a
fi

export APP_HOST="${APP_HOST:-0.0.0.0}"
export APP_PORT="${APP_PORT:-9212}"

if [[ -n "${APP_PROXY_URL:-}" ]]; then
    export HTTP_PROXY="${HTTP_PROXY:-$APP_PROXY_URL}"
    export HTTPS_PROXY="${HTTPS_PROXY:-$APP_PROXY_URL}"
    export ALL_PROXY="${ALL_PROXY:-$APP_PROXY_URL}"
    export http_proxy="${http_proxy:-$APP_PROXY_URL}"
    export https_proxy="${https_proxy:-$APP_PROXY_URL}"
    export all_proxy="${all_proxy:-$APP_PROXY_URL}"
fi

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
    "$PYTHON_BIN" -m pip install -r requirements.txt
fi

echo "Starting app: http://127.0.0.1:${APP_PORT}"
exec "$PYTHON_BIN" app.py
