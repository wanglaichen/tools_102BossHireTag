#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT_DIR/logs/restart.pid"
LOG_FILE="$ROOT_DIR/logs/restart.log"

load_env_file() {
    if [[ -f "$ROOT_DIR/.env" ]]; then
        set -a
        # shellcheck disable=SC1091
        source "$ROOT_DIR/.env"
        set +a
    fi
}

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

is_windows_shell() {
    [[ "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* || "${OSTYPE:-}" == win32* ]]
}

kill_process_tree() {
    local pid="${1:-}"
    if [[ -z "$pid" ]]; then
        return 0
    fi

    if is_windows_shell; then
        # Git Bash 下 taskkill 对 PID 处理有 MSYS 转换问题，改用 powershell 更可靠
        powershell -Command "Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue" >/dev/null 2>&1 || true
    else
        kill -TERM "$pid" >/dev/null 2>&1 || true
        sleep 1
        kill -KILL "$pid" >/dev/null 2>&1 || true
    fi
}

# 通过 /api/shutdown 优雅关闭指定端口上的服务，成功返回 0
api_shutdown() {
    local port="${1:-}"
    [[ -z "$port" ]] && return 1
    local host="${APP_HOST:-127.0.0.1}"
    [[ "$host" == "0.0.0.0" ]] && host="127.0.0.1"
    curl -s -X POST "http://${host}:${port}/api/shutdown" --max-time 5 >/dev/null 2>&1
}

python_has_deps() {
    "$1" -c "import flask, redis" >/dev/null 2>&1
}

python_has_pip() {
    "$1" -m pip --version >/dev/null 2>&1
}

ensure_python() {
    # 已显式指定解释器则直接用它
    if [[ -n "${PYTHON_BIN:-}" ]]; then
        if python_has_deps "$PYTHON_BIN"; then
            return 0
        fi
        if python_has_pip "$PYTHON_BIN"; then
            echo "Installing Python dependencies from requirements.txt..."
            "$PYTHON_BIN" -m pip install -r "$ROOT_DIR/requirements.txt"
        fi
        if python_has_deps "$PYTHON_BIN"; then
            return 0
        fi
        echo "Python dependencies (flask, redis) are not available in $PYTHON_BIN." >&2
        exit 1
    fi

    # 收集候选解释器：PATH 上的 + Windows 常见安装路径
    local candidates=()
    local cmd
    for cmd in python.exe python3 python; do
        if command -v "$cmd" >/dev/null 2>&1; then
            candidates+=("$(command -v "$cmd")")
        fi
    done
    if command -v py.exe >/dev/null 2>&1; then
        # py launcher 列出所有已装版本，取每行最后一个字段（python.exe 路径）
        while IFS= read -r path; do
            [[ -n "$path" && -x "$path" ]] && candidates+=("$path")
        done < <(py.exe -0p 2>/dev/null | awk '{print $NF}')
    fi
    # Windows 常见安装目录
    local user_dir="${USERNAME:-${USER:-}}"
    if [[ -z "$user_dir" ]]; then
        user_dir="$(whoami 2>/dev/null || echo '')"
    fi
    local p
    for p in \
        "/c/Users/${user_dir}/AppData/Local/Programs/Python/Python313/python.exe" \
        "/c/Users/${user_dir}/AppData/Local/Programs/Python/Python312/python.exe" \
        "/c/Users/${user_dir}/AppData/Local/Programs/Python/Python311/python.exe" \
        "/c/Program Files/Python313/python.exe" \
        "/c/Program Files/Python312/python.exe" \
        "/c/Program Files/Python311/python.exe"; do
        [[ -x "$p" ]] && candidates+=("$p")
    done

    # 1) 优先挑选已装好 flask+redis 的解释器，避免依赖 pip
    local cand
    for cand in "${candidates[@]}"; do
        if python_has_deps "$cand"; then
            PYTHON_BIN="$cand"
            return 0
        fi
    done

    # 2) 退而求其次：找一个有 pip 的解释器来安装依赖
    for cand in "${candidates[@]}"; do
        if python_has_pip "$cand"; then
            echo "Installing Python dependencies from requirements.txt..."
            "$cand" -m pip install -r "$ROOT_DIR/requirements.txt"
            if python_has_deps "$cand"; then
                PYTHON_BIN="$cand"
                return 0
            fi
        fi
    done

    echo "No usable Python interpreter with flask+redis was found." >&2
    echo "Candidates checked:" >&2
    printf '  %s\n' "${candidates[@]}" >&2
    exit 1
}

port_in_use() {
    local port="${1:-}"
    [[ -z "$port" ]] && return 1
    if command -v lsof >/dev/null 2>&1; then
        lsof -ti tcp:"$port" >/dev/null 2>&1
    elif command -v ss >/dev/null 2>&1; then
        ss -ltn 2>/dev/null | grep -q ":${port} "
    elif command -v netstat >/dev/null 2>&1; then
        netstat -ano 2>/dev/null | grep -qE ":${port}[[:space:]]+.*LISTEN"
    else
        return 1
    fi
}

stop_old_listener() {
    local port="${APP_PORT:-9212}"

    # 1) 优先通过 API 优雅关闭
    if port_in_use "$port"; then
        if api_shutdown "$port"; then
            # 等待端口释放
            for _ in 1 2 3 4 5; do
                port_in_use "$port" || return 0
                sleep 1
            done
        fi
    fi

    # 2) 兜底：按端口找到进程并终止
    local pids=()
    if command -v lsof >/dev/null 2>&1; then
        mapfile -t pids < <(lsof -ti tcp:"$port" 2>/dev/null || true)
    elif command -v ss >/dev/null 2>&1; then
        mapfile -t pids < <(ss -ltnp 2>/dev/null | grep ":${port} " | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' || true)
    elif command -v netstat >/dev/null 2>&1; then
        mapfile -t pids < <(netstat -ano 2>/dev/null | awk -v target=":${port}" '
            $0 ~ target && ($0 ~ /LISTENING/ || $0 ~ /LISTEN/) {
                print $NF
            }
        ' || true)
    fi

    if [[ ${#pids[@]} -gt 0 ]]; then
        local unique_pids=()
        local pid
        for pid in "${pids[@]}"; do
            if [[ -n "$pid" ]] && [[ "$pid" != "0" ]] && [[ ! " ${unique_pids[*]} " =~ " ${pid} " ]]; then
                unique_pids+=("$pid")
            fi
        done

        if [[ ${#unique_pids[@]} -gt 0 ]]; then
            echo "Stopping existing process(es) on port ${port}: ${unique_pids[*]}"
            for pid in "${unique_pids[@]}"; do
                kill_process_tree "$pid"
            done
        fi
    fi
}

run_monitor() {
    :
}

start_daemon() {
    local cleanup_listener="${1:-1}"
    mkdir -p "$ROOT_DIR/logs"
    if [[ "$cleanup_listener" == "1" ]]; then
        stop_old_listener
    fi

    if [[ -f "$PID_FILE" ]]; then
        old_pid="$(tr -d '\r\n' < "$PID_FILE" || true)"
        if [[ -n "$old_pid" ]]; then
            kill_process_tree "$old_pid"
        fi
    fi

    cd "$ROOT_DIR"
    export APP_HOST="${APP_HOST:-0.0.0.0}"
    export APP_PORT="${APP_PORT:-9212}"

    # nohup + disown 让进程脱离父 shell，Windows Git Bash 下关闭终端也不会被连带杀掉
    nohup "$PYTHON_BIN" -u app.py >>"$LOG_FILE" 2>&1 </dev/null &
    app_pid=$!
    echo "$app_pid" >"$PID_FILE"
    disown "$app_pid" 2>/dev/null || true
    sleep 2
}

stop_daemon() {
    if [[ -f "$PID_FILE" ]]; then
        pid="$(tr -d '\r\n' < "$PID_FILE" || true)"
        if [[ -n "$pid" ]]; then
            kill_process_tree "$pid"
        fi
        rm -f "$PID_FILE"
    fi
    stop_old_listener
}

run_foreground() {
    # 前台运行：请求日志直接打印到终端，Ctrl+C / 关闭终端即停止
    stop_old_listener
    cd "$ROOT_DIR"
    export APP_HOST="${APP_HOST:-0.0.0.0}"
    export APP_PORT="${APP_PORT:-9212}"
    exec "$PYTHON_BIN" -u app.py
}

status_daemon() {
    if [[ -f "$PID_FILE" ]]; then
        pid="$(tr -d '\r\n' < "$PID_FILE" || true)"
        if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
            echo "running pid=$pid port=${APP_PORT:-9212}"
            return 0
        fi
    fi
    echo "stopped"
    return 1
}

main() {
    load_env_file
    configure_proxy

    case "${1:-start}" in
        start)
            ensure_python
            start_daemon 1
            echo "Started. Open http://127.0.0.1:${APP_PORT:-9212}"
            ;;
        run)
            ensure_python
            run_foreground
            ;;
        stop)
            stop_daemon
            echo "Stopped."
            ;;
        restart)
            ensure_python
            stop_daemon
            start_daemon 0
            echo "Restarted. Open http://127.0.0.1:${APP_PORT:-9212}"
            ;;
        status)
            status_daemon
            ;;
        *)
            echo "Usage: $0 {start|run|stop|restart|status}" >&2
            echo "  start    后台常驻启动（关闭终端不退出，日志在 logs/restart.log）" >&2
            echo "  run      前台运行，实时打印请求日志（Ctrl+C 停止）" >&2
            echo "  stop     停止服务" >&2
            echo "  restart  重启服务（后台模式）" >&2
            echo "  status   查看运行状态" >&2
            exit 1
            ;;
    esac
}

cd "$ROOT_DIR"
main "$@"
