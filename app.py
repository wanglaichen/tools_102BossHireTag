import os

from flask import Flask, g, jsonify, request
from werkzeug.exceptions import HTTPException

from config import AppConfig
from routes import register_blueprints
from routes.deps import get_auth, init_deps
from services.auth_service import AuthError, AuthService
from services.channel_service import ChannelService
from services.storage import StorageUnavailable


# 仅提供 API；Web 由 client/（Next.js）承载，不再使用 templates/static
app = Flask(__name__, static_folder=None, template_folder=None)
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
channel_service = ChannelService(
    AppConfig.REDIS_URL,
    AppConfig.REDIS_CHANNELS_KEY,
    AppConfig.REDIS_TIMEOUT_SECONDS,
)
init_deps(auth_service, channel_service)

try:
    auth_service.ensure_default_admin()
except Exception as exc:
    app.logger.warning("默认管理员初始化失败: %s", exc)

try:
    channel_service.ensure_defaults()
except Exception as exc:
    app.logger.warning("默认招聘渠道初始化失败: %s", exc)

register_blueprints(app)

_AUTH_PUBLIC_EXACT = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/registration-policy/public",
    "/api/version",
}


def _require_account() -> None:
    path = request.path
    if not path.startswith("/api/") or path in _AUTH_PUBLIC_EXACT:
        return
    g.account = get_auth().require_account(request.headers.get("Authorization"))


@app.before_request
def _auth_guard():
    if request.method == "OPTIONS":
        return ("", 204)
    try:
        _require_account()
    except AuthError as error:
        body = {"message": error.message}
        if error.code:
            body["code"] = error.code
        return jsonify(body), error.status_code


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
    body = {"message": error.message}
    if error.code:
        body["code"] = error.code
    return jsonify(body), error.status_code


@app.errorhandler(StorageUnavailable)
def handle_storage_unavailable(error: StorageUnavailable):
    return jsonify({"message": str(error)}), 503


@app.errorhandler(ValueError)
def handle_value_error(error):
    return jsonify({"message": str(error)}), 400


@app.errorhandler(HTTPException)
def handle_http_error(error):
    return jsonify({"message": error.description}), error.code


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    app.logger.exception("Unhandled error: %s", error)
    return jsonify({"message": "服务器内部错误"}), 500


def _web_mode() -> str:
    mode = (os.getenv("WEB_MODE") or "new").strip().lower()
    if mode in {"next", "web"}:
        return "new"
    if mode in {"api-only", "none"}:
        return "api"
    if mode in {"new", "api"}:
        return mode
    return "new"


@app.route("/api/version", methods=["GET"])
def get_version():
    return jsonify({"version": AppConfig.APP_VERSION, "web_mode": _web_mode()})


@app.route("/")
def index():
    """API 说明；Web 请用 Next（./start.sh，WEB_MODE=new）。旧版页面已移除。"""
    mode = _web_mode()
    client_host = os.getenv("CLIENT_HOST", "127.0.0.1")
    client_port = os.getenv("CLIENT_PORT", "3000")
    web = f"http://{client_host}:{client_port}" if mode == "new" else None
    return jsonify(
        {
            "name": "tools102-boss-hire-tag-api",
            "version": AppConfig.APP_VERSION,
            "web_mode": mode,
            "message": (
                "WEB_MODE=new：请打开 Next 前端（./start.sh）"
                if mode == "new"
                else "WEB_MODE=api：仅 API"
            ),
            "web": web,
            "api_port": AppConfig.APP_PORT,
            "client_port": int(client_port) if str(client_port).isdigit() else client_port,
            "docs": ["/api/version", "/api/auth/login", "/api/companies"],
        }
    )


if __name__ == "__main__":
    app.run(host=AppConfig.APP_HOST, port=AppConfig.APP_PORT, debug=False)
