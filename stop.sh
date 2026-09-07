#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 停止逻辑统一由 restart.sh stop 负责：优先调用 /api/shutdown 优雅关闭，
# 端口未释放时再按 PID/端口兜底清理进程。
exec "$ROOT_DIR/restart.sh" stop "$@"
