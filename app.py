import json
import os
from typing import Any

from flask import Flask, Response, jsonify, render_template, request
from werkzeug.exceptions import HTTPException

from config import AppConfig
from services.company_service import CompanyService
from services.storage import RedisProxyStore, RedisSettingsStore, create_storage


app = Flask(__name__)
app.config.from_object(AppConfig)


company_service = CompanyService(create_storage(AppConfig.__dict__))


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


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/summary", methods=["GET"])
def summary():
    return jsonify(company_service.get_summary())


def _proxy_store():
    return RedisProxyStore(
        AppConfig.REDIS_URL,
        AppConfig.REDIS_PROXY_KEY,
        AppConfig.REDIS_TIMEOUT_SECONDS,
    )


def _settings_store():
    return RedisSettingsStore(
        AppConfig.REDIS_URL,
        AppConfig.REDIS_SETTINGS_KEY,
        AppConfig.REDIS_TIMEOUT_SECONDS,
    )


@app.route("/api/settings", methods=["GET"])
def get_settings():
    store = _settings_store()
    settings = store.get_settings()
    return jsonify(settings)


@app.route("/api/settings", methods=["PATCH"])
def update_settings():
    payload = request.get_json(silent=True) or {}
    store = _settings_store()
    current = store.get_settings()
    next_settings = {
        "status_options": _normalize_options(payload.get("status_options"), current.get("status_options", ["拒绝", "加微信", "在考虑"])),
        "industry_options": _normalize_options(payload.get("industry_options"), current.get("industry_options", ["棋牌", "游戏", "互联网"])),
    }
    store.save_settings(next_settings)
    return jsonify({
        "message": "配置已保存",
        "settings": next_settings,
        "summary": company_service.get_summary(),
    })


def _normalize_options(value: Any, fallback: list) -> list:
    if isinstance(value, list):
        items = [str(item).strip() for item in value]
        items = [item for item in items if item]
        if items:
            seen = set()
            ordered = []
            for item in items:
                key = item.casefold()
                if key not in seen:
                    seen.add(key)
                    ordered.append(item)
            return ordered[:50]
    return list(fallback)


@app.route("/api/companies", methods=["GET"])
def list_companies():
    return jsonify({"items": company_service.list_companies()})


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
