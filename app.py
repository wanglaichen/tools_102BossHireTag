import json
import os
from pathlib import Path

from flask import Flask, Response, g, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from config import AppConfig
from services.auth_service import AuthError, AuthService
from services.company_service import CompanyService
from services.storage import RedisProxyStore, RedisSettingsStore, StorageUnavailable, create_storage


app = Flask(__name__)
app.config.from_object(AppConfig)

auth_service = AuthService(
    redis_url=AppConfig.REDIS_URL,
    key_prefix=AppConfig.REDIS_KEY_PREFIX,
    timeout_seconds=AppConfig.REDIS_TIMEOUT_SECONDS,
    secret_key=AppConfig.SECRET_KEY,
    wechat_appid=AppConfig.WECHAT_APPID,
    wechat_secret=AppConfig.WECHAT_SECRET,
    session_ttl_seconds=AppConfig.AUTH_SESSION_TTL_SECONDS,
    dev_token=AppConfig.MINIAPP_DEV_TOKEN,
    admin_username=AppConfig.ADMIN_USERNAME,
    admin_password=AppConfig.ADMIN_PASSWORD,
)
_account_services: dict[str, CompanyService] = {}

try:
    auth_service.ensure_default_admin()
except Exception as exc:
    app.logger.warning("默认管理员初始化失败: %s", exc)


def _service_for_account(user: dict) -> CompanyService:
    user_id = str(user["id"])
    cached = _account_services.get(user_id)
    if cached is not None:
        return cached
    legacy = bool(user.get("legacyStore"))
    prefix = AppConfig.REDIS_KEY_PREFIX if legacy else f"{AppConfig.REDIS_KEY_PREFIX}:user:{user_id}"
    settings_key = AppConfig.REDIS_SETTINGS_KEY if legacy else f"{prefix}:settings"
    storage_file = (
        AppConfig.STORAGE_FILE
        if legacy
        else str(Path(AppConfig.DATA_DIR) / "users" / user_id / "companies.json")
    )
    config = dict(AppConfig.__dict__)
    config["REDIS_KEY_PREFIX"] = prefix
    config["STORAGE_FILE"] = storage_file
    service = CompanyService(
        create_storage(config),
        settings_store=RedisSettingsStore(AppConfig.REDIS_URL, settings_key, AppConfig.REDIS_TIMEOUT_SECONDS),
    )
    _account_services[user_id] = service
    return service


def _cs() -> CompanyService:
    user = getattr(g, "account", None)
    if not user:
        raise AuthError("未登录")
    return _service_for_account(user)


def _export_filename(ext: str) -> str:
    username = str((getattr(g, "account", None) or {}).get("username") or "account")
    safe = "".join(ch for ch in username if ch.isalnum() or ch in "._-") or "account"
    return f"{safe}-companies.{ext}"


def _backup_dir() -> str:
    user = getattr(g, "account", None) or {}
    user_id = str(user.get("id") or "anonymous")
    return str(Path(AppConfig.DATA_DIR) / "backups" / user_id)


_AUTH_PUBLIC_EXACT = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/version",
}


def _require_account() -> None:
    path = request.path
    if not path.startswith("/api/") or path in _AUTH_PUBLIC_EXACT:
        return
    g.account = auth_service.require_account(request.headers.get("Authorization"))


@app.before_request
def _auth_guard():
    if request.method == "OPTIONS":
        return ("", 204)
    try:
        _require_account()
    except AuthError as error:
        return jsonify({"message": error.message}), error.status_code


@app.after_request
def _add_cors_headers(response):
    origin = request.headers.get("Origin", "")
    allow = AppConfig.CORS_ALLOW_ORIGINS.strip()
    if allow == "*":
        response.headers["Access-Control-Allow-Origin"] = "*"
    elif origin and origin in {item.strip() for item in allow.split(",") if item.strip()}:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    return response


@app.errorhandler(AuthError)
def handle_auth_error(error: AuthError):
    return jsonify({"message": error.message}), error.status_code


@app.errorhandler(StorageUnavailable)
def handle_storage_unavailable(error: StorageUnavailable):
    return jsonify({"message": str(error)}), 503


@app.errorhandler(ValueError)
def handle_value_error(error):
    return jsonify({"message": str(error)}), 400


@app.errorhandler(HTTPException)
def handle_http_error(error):
    if request.path.startswith("/api/"):
        return jsonify({"message": error.description}), error.code
    return error


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    app.logger.exception("Unhandled error")
    if request.path.startswith("/api/"):
        return jsonify({"message": str(error)}), 500
    raise error


@app.route("/api/version", methods=["GET"])
def get_version():
    return jsonify({"version": AppConfig.APP_VERSION})


@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    payload = request.get_json(silent=True) or {}
    try:
        result = auth_service.register_account(
            payload.get("username", ""),
            payload.get("password", ""),
            payload.get("displayName"),
        )
    except ValueError as error:
        status = 409 if "已存在" in str(error) else 400
        return jsonify({"message": str(error)}), status
    return jsonify({"message": "注册成功", **result}), 201


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    payload = request.get_json(silent=True) or {}
    if payload.get("username"):
        result = auth_service.login_with_password(payload.get("username", ""), payload.get("password", ""))
        return jsonify({"message": "登录成功", **result})
    result = auth_service.login_with_code(payload.get("code", ""))
    account = auth_service.ensure_wechat_user(result["user"]["openid"])
    return jsonify({"message": "登录成功", **result, "user": auth_service.public_user(account)})


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    token = auth_service._bearer_token(request.headers.get("Authorization"))
    auth_service.delete_session(token)
    return jsonify({"ok": True})


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    return jsonify({"user": auth_service.public_user(g.account)})


@app.route("/api/auth/change-password", methods=["POST"])
def auth_change_password():
    payload = request.get_json(silent=True) or {}
    user = auth_service.change_password(g.account["id"], payload.get("oldPassword", ""), payload.get("newPassword", ""))
    return jsonify({"user": user, "message": "密码已更新"})


def _require_admin() -> dict:
    if g.account.get("role") != "admin":
        raise AuthError("仅管理员可操作", 403)
    return g.account


@app.route("/api/auth/users", methods=["GET"])
def auth_list_users():
    _require_admin()
    return jsonify({"users": auth_service.list_users()})


@app.route("/api/auth/users", methods=["POST"])
def auth_create_user():
    _require_admin()
    payload = request.get_json(silent=True) or {}
    try:
        user = auth_service.create_user(
            username=payload.get("username", ""),
            password=payload.get("password", ""),
            display_name=payload.get("displayName"),
            role=payload.get("role") or "user",
            source="admin",
        )
    except ValueError as error:
        status = 409 if "已存在" in str(error) else 400
        return jsonify({"message": str(error)}), status
    return jsonify({"user": auth_service.public_user(user), "message": "账号已创建"}), 201


@app.route("/api/auth/users/<user_id>", methods=["PUT"])
def auth_update_user(user_id: str):
    payload = request.get_json(silent=True) or {}
    user = auth_service.update_user(g.account, user_id, payload)
    return jsonify({"user": user, "message": "账号已更新"})


@app.route("/api/auth/users/<user_id>", methods=["DELETE"])
def auth_delete_user(user_id: str):
    auth_service.delete_user(g.account, user_id)
    _account_services.pop(user_id, None)
    return jsonify({"ok": True, "message": "账号已删除"})


@app.route("/api/shutdown", methods=["POST"])
def shutdown_server():
    """Gracefully stop the running Flask process.

    Prefers Werkzeug's dev-server shutdown hook; falls back to os._exit
    so it also works when not running under the Werkzeug reloader.
    """
    # 关闭进程只允许已登录管理员
    if g.account.get("role") != "admin":
        raise AuthError("仅管理员可关闭服务", 403)

    shutdown_func = request.environ.get("werkzeug.server.shutdown")
    if shutdown_func is not None:
        try:
            shutdown_func()
        except RuntimeError:
            pass
        return jsonify({"message": "服务已关闭"})

    os._exit(0)


@app.route("/")
def index():
    return render_template("index.html", app_version=AppConfig.APP_VERSION)


@app.route("/api/summary", methods=["GET"])
def summary():
    return jsonify(_cs().get_summary())


def _proxy_store():
    return RedisProxyStore(
        AppConfig.REDIS_URL,
        AppConfig.REDIS_PROXY_KEY,
        AppConfig.REDIS_TIMEOUT_SECONDS,
    )


@app.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify(_cs().get_settings())


@app.route("/api/settings", methods=["PATCH"])
def update_settings():
    payload = request.get_json(silent=True) or {}
    next_settings = _cs().update_settings(payload)
    return jsonify({
        "message": "配置已保存",
        "settings": next_settings,
        "summary": _cs().get_summary(),
    })


@app.route("/api/companies", methods=["GET"])
def list_companies():
    time_filter = request.args.get("time_filter", "all")
    return jsonify({"items": _cs().list_companies(time_filter=time_filter)})


@app.route("/api/companies", methods=["POST"])
def create_company():
    payload = request.get_json(silent=True) or {}
    item = _cs().create_company(payload)
    return jsonify(
        {
            "message": "记录已新增",
            "item": item,
            "summary": _cs().get_summary(),
        }
    )


@app.route("/api/companies/import", methods=["POST"])
def import_companies():
    payload = request.get_json(silent=True) or {}
    result = _cs().import_rows(payload.get("text", ""))
    return jsonify(
        {
            "message": f"导入 {result['imported_count']} 条，更新 {result['updated_count']} 条，跳过 {result['skipped_count']} 条",
            **result,
        }
    )


@app.route("/api/companies/import-overwrite", methods=["POST"])
def import_companies_overwrite():
    payload = request.get_json(silent=True) or {}
    result = _cs().import_rows(payload.get("text", ""), overwrite=True)
    count = result.get("imported_count", 0) + result.get("updated_count", 0)
    return jsonify(
        {
            "message": f"已覆盖导入 {count} 条",
            **result,
        }
    )


@app.route("/api/companies/clear", methods=["POST"])
def clear_companies():
    """清空当前账号公司记录；保留交流状态、行业等自定义标签。"""
    result = _cs().clear_companies()
    return jsonify(
        {
            "message": f"已清空当前账号 {result['cleared_count']} 条公司记录（自定义标签已保留）",
            **result,
        }
    )


@app.route("/api/companies/export.csv", methods=["GET"])
def export_companies_csv():
    """导出当前账号公司数据为 CSV，不含账号信息。"""
    body = _cs().export_csv()
    return Response(
        body.encode("utf-8-sig"),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={_export_filename('csv')}"},
    )


@app.route("/api/backup", methods=["POST"])
def create_backup():
    """Create a full backup for the current account and return metadata + downloadable payload."""
    result = _cs().create_backup(
        _backup_dir(),
        app_version=AppConfig.APP_VERSION,
        account=g.account,
    )
    return jsonify(
        {
            "message": result["message"],
            "filename": result["filename"],
            "company_count": result["company_count"],
            "created_at": result["created_at"],
            "payload": result["payload"],
        }
    )


@app.route("/api/backup", methods=["GET"])
def download_backup():
    """One-click: save current-account backup on server and download the file."""
    result = _cs().create_backup(
        _backup_dir(),
        app_version=AppConfig.APP_VERSION,
        account=g.account,
    )
    body = json.dumps(result["payload"], ensure_ascii=False, indent=2) + "\n"
    return Response(
        body,
        mimetype="application/json; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={result['filename']}"},
    )


@app.route("/api/backups", methods=["GET"])
def list_backups():
    return jsonify({"items": _cs().list_backups(_backup_dir())})


@app.route("/api/backup/restore", methods=["POST"])
def restore_backup():
    payload = request.get_json(silent=True)
    if payload is None:
        raw = request.get_data(as_text=True) or ""
        if not raw.strip():
            return jsonify({"message": "请上传备份文件"}), 400
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return jsonify({"message": "备份文件不是有效的 JSON"}), 400
    try:
        result = _cs().restore_backup(payload)
    except ValueError as error:
        return jsonify({"message": str(error)}), 400
    return jsonify(
        {
            "message": result["message"],
            "restored_count": result["restored_count"],
            "skipped_count": result["skipped_count"],
            "items": result["items"],
            "summary": result["summary"],
        }
    )


@app.route("/api/companies/<company_id>", methods=["PATCH"])
def update_company(company_id: str):
    payload = request.get_json(silent=True) or {}
    item = _cs().update_company(company_id, payload)
    return jsonify(
        {
            "message": "记录已更新",
            "item": item,
            "summary": _cs().get_summary(),
        }
    )


@app.route("/api/companies/<company_id>", methods=["DELETE"])
def delete_company(company_id: str):
    result = _cs().delete_company(company_id)
    return jsonify(
        {
            "message": "记录已删除",
            **result,
            "summary": _cs().get_summary(),
        }
    )


@app.route("/api/companies/fix-history", methods=["POST"])
def fix_company_history():
    result = _cs().fix_history_timestamps()
    return jsonify(result)


def _proxy_store():
    return RedisProxyStore(
        AppConfig.REDIS_URL,
        AppConfig.REDIS_PROXY_KEY,
        AppConfig.REDIS_TIMEOUT_SECONDS,
    )


@app.route("/api/proxy", methods=["GET"])
def get_proxy():
    proxy_store = _proxy_store()
    return jsonify({
        "proxy_url": proxy_store.get_proxy(),
        "using_fallback": getattr(_cs().storage, "using_fallback", False),
    })


@app.route("/api/proxy", methods=["POST"])
def set_proxy():
    payload = request.get_json(silent=True) or {}
    proxy_url = (payload.get("proxy_url") or "").strip()
    proxy_store = _proxy_store()
    proxy_store.set_proxy(proxy_url)

    if proxy_url:
        for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
            os.environ[name] = proxy_url
            os.environ[name.lower()] = proxy_url
        os.environ["APP_PROXY_URL"] = proxy_url
    else:
        for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "APP_PROXY_URL"):
            os.environ.pop(name, None)

    return jsonify({
        "message": "代理设置已保存，重启应用后生效" if proxy_url else "代理设置已清除，重启应用后生效",
        "proxy_url": proxy_url,
    })


if __name__ == "__main__":
    debug_enabled = os.getenv("APP_DEBUG", "0") == "1"
    app.run(
        debug=debug_enabled,
        use_reloader=False,
        host=app.config["APP_HOST"],
        port=app.config["APP_PORT"],
    )
