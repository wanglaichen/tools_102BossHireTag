#!/usr/bin/env bash
# 兼容入口：转发到仓库根目录 ./fetch_boss.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/../fetch_boss.sh" "$@"
