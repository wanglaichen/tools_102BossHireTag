# shellcheck shell=bash
# WEB_MODE：new | api（旧版 legacy 已关闭）

normalize_web_mode() {
  local m
  m="$(echo "${WEB_MODE:-new}" | tr '[:upper:]' '[:lower:]' | tr -d '\r')"
  case "$m" in
    new|next|web) export WEB_MODE="new" ;;
    api|api-only|none) export WEB_MODE="api" ;;
    legacy|old)
      echo "错误: 旧版 Web 已移除，请将 WEB_MODE 改为 new 或 api" >&2
      exit 1
      ;;
    *)
      echo "错误: WEB_MODE=$m 无效，应为 new | api" >&2
      exit 1
      ;;
  esac
}

_win_path() {
  # Git Bash 路径转 Windows，供 powershell 匹配命令行
  local p="${1:-}"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$p"
  else
    echo "$p" | sed -e 's|^/e/|E:/|' -e 's|^/c/|C:/|' -e 's|/|\\|g'
  fi
}

# 停掉本仓库相关的 Next（dev/start）与 concurrently，避免 3000/7001 双开
stop_next_web() {
  local root="${ROOT_DIR:-.}"
  local win_root
  win_root="$(_win_path "$root")"
  local ps=""
  if command -v powershell.exe >/dev/null 2>&1; then
    ps=powershell.exe
  elif command -v powershell >/dev/null 2>&1; then
    ps=powershell
  else
    return 0
  fi
  "$ps" -NoProfile -Command "
\$root = '$win_root'
Get-CimInstance Win32_Process | Where-Object {
  \$_.CommandLine -and (
    (\$_.CommandLine -match [regex]::Escape(\$root + '\\client') -and (
      \$_.CommandLine -match 'next' -or \$_.CommandLine -match 'client:dev' -or \$_.CommandLine -match 'client:start'
    )) -or (
      \$_.CommandLine -match 'concurrently' -and \$_.CommandLine -match [regex]::Escape(\$root)
    )
  )
} | ForEach-Object {
  Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue
}
" >/dev/null 2>&1 || true
}

stop_flask_api() {
  local root="${ROOT_DIR:-.}"
  local win_root
  win_root="$(_win_path "$root")"
  local ps=""
  if command -v powershell.exe >/dev/null 2>&1; then
    ps=powershell.exe
  elif command -v powershell >/dev/null 2>&1; then
    ps=powershell
  else
    return 0
  fi
  "$ps" -NoProfile -Command "
\$root = '$win_root'
Get-CimInstance Win32_Process | Where-Object {
  \$_.CommandLine -and \$_.CommandLine -match 'app\.py' -and \$_.CommandLine -match [regex]::Escape(\$root)
} | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }
" >/dev/null 2>&1 || true
}
