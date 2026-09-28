"""Proxy settings routes."""
from __future__ import annotations

import os

from flask import Blueprint, jsonify, request

from routes.deps import cs, proxy_store

bp = Blueprint("proxy", __name__)


@bp.route("/api/proxy", methods=["GET"])
def get_proxy():
    store = proxy_store()
    return jsonify({
        "proxy_url": store.get_proxy(),
        "using_fallback": getattr(cs().storage, "using_fallback", False),
    })


@bp.route("/api/proxy", methods=["POST"])
def set_proxy():
    payload = request.get_json(silent=True) or {}
    proxy_url = (payload.get("proxy_url") or "").strip()
    store = proxy_store()
    store.set_proxy(proxy_url)

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
