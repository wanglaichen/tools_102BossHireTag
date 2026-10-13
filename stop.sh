#!/usr/bin/env bash
# 停止本项目 API + Web（唯一停服入口）
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
# shellcheck disable=SC1091
source "$ROOT_DIR/scripts/runtime.sh"
load_root_env
configure_proxy
normalize_web_mode

echo "Stopping (WEB_MODE=${WEB_MODE})..."
stop_all
echo "Stopped."
