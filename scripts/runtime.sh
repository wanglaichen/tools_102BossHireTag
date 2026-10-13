# shellcheck shell=bash
# 公共运行时：加载配置、选 Python、停进程（供 start.sh / stop.sh / build.sh source）

# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/load_ports.sh"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/web_mode.sh"

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

is_nested_venv_python() {
  local p="${1:-}"
  [[ "$p" == *"/venv/"* || "$p" == *"\\venv\\"* || "$p" == *"/hermes/"* || "$p" == *"\\hermes\\"* ]]
}

pick_python() {
  if [[ -n "${PYTHON_BIN:-}" ]]; then
    echo "$PYTHON_BIN"
    return 0
  fi
  local user_dir="${USERNAME:-${USER:-}}"
  local preferred=()
  local others=()
  local p
  for p in \
    "/c/Users/${user_dir}/AppData/Local/Programs/Python/Python313/python.exe" \
    "/c/Users/${user_dir}/AppData/Local/Programs/Python/Python312/python.exe" \
    "/c/Users/${user_dir}/AppData/Local/Programs/Python/Python315/python.exe"; do
    [[ -x "$p" ]] && preferred+=("$p")
  done
  for p in python.exe python3 python; do
    if command -v "$p" >/dev/null 2>&1; then
      local full
      full="$(command -v "$p")"
      is_nested_venv_python "$full" && continue
      others+=("$full")
    fi
  done
  for p in "${preferred[@]}" "${others[@]}"; do
    if "$p" -c "import flask, redis" >/dev/null 2>&1; then
      echo "$p"
      return 0
    fi
  done
  for p in "${preferred[@]}" "${others[@]}"; do
    echo "$p"
    return 0
  done
  echo "错误: 未找到可用 Python，请设置 PYTHON_BIN" >&2
  exit 1
}

api_shutdown() {
  local port="${1:-}"
  [[ -z "$port" ]] && return 1
  local host="${APP_HOST:-127.0.0.1}"
  [[ "$host" == "0.0.0.0" ]] && host="127.0.0.1"
  curl -s -X POST "http://${host}:${port}/api/shutdown" --max-time 5 >/dev/null 2>&1
}

stop_all() {
  normalize_web_mode
  # 先尝试优雅关 API
  api_shutdown "${APP_PORT:-9212}" || true
  stop_next_web
  stop_flask_api
  rm -f "${ROOT_DIR}/logs/restart.pid" 2>/dev/null || true
}

ensure_npm_deps() {
  if [[ ! -d "${ROOT_DIR}/node_modules" ]]; then
    echo "Installing root npm deps..."
    npm install
  fi
  if [[ ! -d "${ROOT_DIR}/client/node_modules" ]]; then
    echo "Installing client npm deps..."
    npm install --prefix client
  fi
}
