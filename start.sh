#!/usr/bin/env bash
# 按 .env 启动（唯一启服入口）
#
#   WEB_MODE=new  → Flask API + Next Web
#   WEB_MODE=api  → 仅 Flask API
#
# 用法: ./start.sh
# 停止: ./stop.sh
# 构建: ./build.sh

set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/runtime.sh"
load_root_env
sync_client_env_local
configure_proxy
normalize_web_mode
export WEB_MODE

echo "Stopping leftovers first..."
stop_all
sleep 1

PY="$(pick_python)"
export PYTHON_BIN="$PY"

case "$WEB_MODE" in
  api)
    echo "API only: $(api_url)  (python=$PY)"
    exec "$PY" -u app.py
    ;;
  new)
    if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
      echo "错误: WEB_MODE=new 需要 Node.js / npm" >&2
      exit 1
    fi
    ensure_npm_deps
    echo "API  $(api_url)   APP_PORT=${APP_PORT}"
    echo "Web  $(web_url)   CLIENT_PORT=${CLIENT_PORT}"
    echo "API base  ${NEXT_PUBLIC_API_BASE_URL}"
    export PORT="${CLIENT_PORT}"
    export HOSTNAME="${CLIENT_HOST}"
    exec npx concurrently -n api,web -c blue,green \
      "${PY} -u app.py" \
      "npm run dev --prefix client -- -H ${CLIENT_HOST} -p ${CLIENT_PORT}"
    ;;
  legacy)
    echo "错误: 旧版 Web 已关闭。请将 .env 中 WEB_MODE 设为 new 或 api" >&2
    exit 1
    ;;
esac
