#!/usr/bin/env bash
# 导入「真实岗位」JSON 到本系统 boss 渠道（不造假、不爬站）
# 实际逻辑：fetchdata_boss/fetch_boss_jobs.py
#
# 用法（仓库根目录，Git Bash）：
#   ./fetch_boss.sh --from-json path/to/jobs.json
#   ./fetch_boss.sh --purge-demo
#   ./fetch_boss.sh --purge-demo --from-json jobs.json
#   cat jobs.json | ./fetch_boss.sh --from-json -
#
# 环境变量（可选）：FETCH_USERNAME / PYTHON

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
PY_SCRIPT="$ROOT_DIR/fetchdata_boss/fetch_boss_jobs.py"

if [[ ! -f "$PY_SCRIPT" ]]; then
  echo "找不到 Python 脚本：$PY_SCRIPT" >&2
  exit 1
fi

_pick_python() {
  local cand
  local candidates=(
    "${PYTHON:-}"
    "/c/Users/chenwl/AppData/Local/Programs/Python/Python315/python.exe"
    "/c/Users/chenwl/AppData/Local/Programs/Python/Python314/python.exe"
    "/c/Users/chenwl/AppData/Local/Programs/Python/Python313/python.exe"
    "/c/Users/chenwl/AppData/Local/Programs/Python/Python312/python.exe"
    "python"
    "python3"
    "py"
  )
  for cand in "${candidates[@]}"; do
    [[ -z "$cand" ]] && continue
    if ! command -v "$cand" >/dev/null 2>&1 && [[ ! -f "$cand" ]]; then
      continue
    fi
    if "$cand" -c "import redis" >/dev/null 2>&1; then
      if command -v "$cand" >/dev/null 2>&1; then
        command -v "$cand"
      else
        echo "$cand"
      fi
      return 0
    fi
  done
  return 1
}

PYTHON_BIN="$(_pick_python || true)"
if [[ -z "${PYTHON_BIN:-}" ]]; then
  echo "找不到可用 python（需已安装 redis 包）。可设置 PYTHON=完整路径" >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  cat >&2 <<'EOF'
已停用假数据生成。请导入真实岗位 JSON：

  ./fetch_boss.sh --from-json jobs.json
  ./fetch_boss.sh --purge-demo
  ./fetch_boss.sh --purge-demo --from-json jobs.json

JSON 示例见 fetchdata_boss/jobs.example.json
真公司/真职位/真简介需由外部采集后写入 JSON；本脚本只负责入库。
EOF
  exit 1
fi

USERNAME_ARGS=()
if [[ -n "${FETCH_USERNAME:-}" ]]; then
  USERNAME_ARGS=(--username "$FETCH_USERNAME")
fi

echo "==> python=$PYTHON_BIN"
cd "$ROOT_DIR"
exec "$PYTHON_BIN" "$PY_SCRIPT" "${USERNAME_ARGS[@]}" "$@"
