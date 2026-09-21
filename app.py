import json
import os
from pathlib import Path

from flask import Flask, Response, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from config import AppConfig
from services.auth_service import AuthError, AuthService
from services.company_service import CompanyService
from services.storage import RedisProxyStore, RedisSettingsStore, create_storage


app = Flask(__name__)
app.config.from_object(AppConfig)


settings_store = RedisSettingsStore(
    AppConfig.REDIS_URL,
    AppConfig.REDIS_SETTINGS_KEY,
    AppConfig.REDIS_TIMEOUT_SECONDS,
)
company_service = CompanyService(create_storage(AppConfig.__dict__), settings_store=settings_store)
auth_service = AuthService(
    redis_url=AppConfig.REDIS_URL,
    key_prefix=AppConfig.REDIS_KEY_PREFIX,
    timeout_seconds=AppConfig.REDIS_TIMEOUT_SECONDS,
    secret_key=AppConfig.SECRET_KEY,
    wechat_appid=AppConfig.WECHAT_APPID,
    wechat_secret=AppConfig.WECHAT_SECRET,
    session_ttl_seconds=AppConfig.AUTH_SESSION_TTL_SECONDS,
    dev_token=AppConfig.MINIAPP_DEV_TOKEN,
)

# 需要登录的接口（当 MINIAPP_AUTH_REQUIRED=1）
_AUTH_REQUIRED_PREFIXES = (
    "/api/companies",
    "/api/settings",
    "/api/proxy",
    "/api/backup",
    "/api/shutdown",
)
_AUTH_PUBLIC_EXACT = {
    "/api/auth/login",
    "/api/version",
    "/api/summary",
}


def _require_auth_if_needed() -> None:
    if not AppConfig.MINIAPP_AUTH_REQUIRED:
        return
    path = request.path
    if path in _AUTH_PUBLIC_EXACT or path == "/":
        return
    if not path.startswith(_AUTH_REQUIRED_PREFIXES):
        return
    # 读接口也统一鉴权，避免未登录扫全库；开发期可关开关
    auth_service.require_user(request.headers.get("Authorization"))


@app.before_request
def _auth_guard():
    if request.method == "OPTIONS":
        return ("", 204)
    try:
        _require_auth_if_needed()
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


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    payload = request.get_json(silent=True) or {}
    result = auth_service.login_with_code(payload.get("code", ""))
    return jsonify({"message": "登录成功", **result})


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    user = auth_service.require_user(request.headers.get("Authorization"))
    return jsonify({"user": user})


@app.route("/api/shutdown", methods=["POST"])
def shutdown_server():
    """Gracefully stop the running Flask process.

    Prefers Werkzeug's dev-server shutdown hook; falls back to os._exit
    so it also works when not running under the Werkzeug reloader.
    """
    # 本地 Web 可关鉴权；开启鉴权后必须登录才能关闭
    if AppConfig.MINIAPP_AUTH_REQUIRED:
        auth_service.require_user(request.headers.get("Authorization"))

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
    return jsonify(company_service.get_summary())


def _proxy_store():
    return RedisProxyStore(
        AppConfig.REDIS_URL,
        AppConfig.REDIS_PROXY_KEY,
        AppConfig.REDIS_TIMEOUT_SECONDS,
    )


@app.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify(company_service.get_settings())


@app.route("/api/settings", methods=["PATCH"])
def update_settings():
    payload = request.get_json(silent=True) or {}
    next_settings = company_service.update_settings(payload)
    return jsonify({
        "message": "配置已保存",
        "settings": next_settings,
        "summary": company_service.get_summary(),
    })


@app.route("/api/companies", methods=["GET"])
def list_companies():
    time_filter = request.args.get("time_filter", "all")
    return jsonify({"items": company_service.list_companies(time_filter=time_filter)})


@app.route("/api/companies", methods=["POST"])
def create_company():
    payload = request.get_json(silent=True) or {}
    item = company_service.create_company(payload)
    return jsonify(
        {
            "message": "记录已新增",
            "item": item,
            "summary": company_service.get_summary(),
        }
    )


@app.route("/api/companies/import", methods=["POST"])
def import_companies():
    payload = request.get_json(silent=True) or {}
    result = company_service.import_rows(payload.get("text", ""))
    return jsonify(
        {
            "message": f"导入 {result['imported_count']} 条，更新 {result['updated_count']} 条，跳过 {result['skipped_count']} 条",
            **result,
        }
    )


@app.route("/api/companies/import-overwrite", methods=["POST"])
def import_companies_overwrite():
    payload = request.get_json(silent=True) or {}
    result = company_service.import_rows(payload.get("text", ""), overwrite=True)
    return jsonify(
        {
            "message": f"已覆盖导入 {result['imported_count']} 条",
            **result,
        }
    )


@app.route("/api/companies/export.csv", methods=["GET"])
def export_companies_csv():
    body = company_service.export_csv()
    return Response(
        body.encode("utf-8-sig"),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=resume-company-tags.csv"},
    )


@app.route("/api/companies/export.json", methods=["GET"])
def export_companies_json():
    body = json.dumps({"items": company_service.list_companies()}, ensure_ascii=False, indent=2)
    return Response(
        body,
        mimetype="application/json; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=resume-company-tags.json"},
    )


def _backup_dir() -> str:
    return str(Path(AppConfig.DATA_DIR) / "backups")


@app.route("/api/backup", methods=["POST"])
def create_backup():
    """Create a full backup on server and return metadata (payload included for client download)."""
    result = company_service.create_backup(_backup_dir(), app_version=AppConfig.APP_VERSION)
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
    """One-click: save backup on server and download the file."""
    result = company_service.create_backup(_backup_dir(), app_version=AppConfig.APP_VERSION)
    body = json.dumps(result["payload"], ensure_ascii=False, indent=2) + "\n"
    return Response(
        body,
        mimetype="application/json; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={result['filename']}"},
    )


@app.route("/api/backups", methods=["GET"])
def list_backups():
    return jsonify({"items": company_service.list_backups(_backup_dir())})


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
        result = company_service.restore_backup(payload)
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
    item = company_service.update_company(company_id, payload)
    return jsonify(
        {
            "message": "记录已更新",
            "item": item,
            "summary": company_service.get_summary(),
        }
    )


@app.route("/api/companies/<company_id>", methods=["DELETE"])
def delete_company(company_id: str):
    result = company_service.delete_company(company_id)
    return jsonify(
        {
            "message": "记录已删除",
            **result,
            "summary": company_service.get_summary(),
        }
    )


@app.route("/api/companies/fix-history", methods=["POST"])
def fix_company_history():
    result = company_service.fix_history_timestamps()
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
        "using_fallback": getattr(company_service.storage, "using_fallback", False),
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
