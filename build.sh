#!/usr/bin/env bash
# 生产构建 Next 前端（读根目录 .env）
#
# 用法:
#   ./build.sh              # 仅 build → client/.next
#   ./build.sh --start      # build 后按配置启动（等同先 build 再 ./start.sh 的生产前端）
#   ./build.sh --with-api   # 同 --start（兼容旧参数）
#
# 日常开发请用: ./start.sh
# 停止: ./stop.sh

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

if ! command -v node >/dev/null 2>&1; then
  echo "错误: 未找到 node" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "错误: 未找到 npm" >&2
  exit 1
fi

MODE=build
for arg in "$@"; do
  case "$arg" in
    --start|-s|--with-api|--prod) MODE=start ;;
    -h|--help)
      echo "用法: ./build.sh [--start]"
      echo "  配置见 .env：WEB_MODE / APP_PORT / CLIENT_PORT / NEXT_PUBLIC_API_BASE_URL"
      echo "  启动开发: ./start.sh"
      echo "  停止:     ./stop.sh"
      exit 0
      ;;
    *)
      echo "未知参数: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ "$WEB_MODE" != "new" ]]; then
  echo "WEB_MODE=${WEB_MODE}：无需构建 Next。直接 ./start.sh 即可。"
  exit 0
fi

ensure_npm_deps
sync_client_env_local
echo "Building Next.js (API base=${NEXT_PUBLIC_API_BASE_URL})..."
npm run client:build
echo "Build OK → client/.next"

if [[ "$MODE" == "build" ]]; then
  exit 0
fi

echo "Stopping leftovers, then starting production web + API..."
stop_all
sleep 1
PY="$(pick_python)"
echo "API  $(api_url)"
echo "Web  $(web_url)  (next start)"
export PORT="${CLIENT_PORT}"
export HOSTNAME="${CLIENT_HOST}"
exec npx concurrently -n api,web -c blue,green \
  "${PY} -u app.py" \
  "npm run start --prefix client -- -H ${CLIENT_HOST} -p ${CLIENT_PORT}"
