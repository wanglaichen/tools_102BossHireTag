# shellcheck shell=bash
# 由 start.sh / stop.sh / build.sh source：加载根 .env 并同步前端端口/API 地址
# 用法: source "$ROOT_DIR/scripts/load_ports.sh"

load_root_env() {
  local root="${ROOT_DIR:-.}"
  if [[ -f "$root/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$root/.env"
    set +a
  fi
  export APP_HOST="${APP_HOST:-0.0.0.0}"
  export APP_PORT="${APP_PORT:-9212}"
  export CLIENT_HOST="${CLIENT_HOST:-127.0.0.1}"
  export CLIENT_PORT="${CLIENT_PORT:-3000}"
  # new=Next 前端 + API；api=只 API
  export WEB_MODE="${WEB_MODE:-new}"
  if [[ -z "${NEXT_PUBLIC_API_BASE_URL:-}" ]]; then
    local api_host="127.0.0.1"
    [[ "$APP_HOST" != "0.0.0.0" && -n "$APP_HOST" ]] && api_host="$APP_HOST"
    export NEXT_PUBLIC_API_BASE_URL="http://${api_host}:${APP_PORT}"
  fi
}

sync_client_env_local() {
  local root="${ROOT_DIR:-.}"
  mkdir -p "$root/client"
  cat >"$root/client/.env.local" <<EOF
# 由 scripts/load_ports.sh 从仓库根 .env 同步，勿手改长期配置
NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
EOF
}

web_url() {
  echo "http://${CLIENT_HOST}:${CLIENT_PORT}"
}

api_url() {
  local api_host="127.0.0.1"
  [[ "${APP_HOST}" != "0.0.0.0" && -n "${APP_HOST}" ]] && api_host="${APP_HOST}"
  echo "http://${api_host}:${APP_PORT}"
}
