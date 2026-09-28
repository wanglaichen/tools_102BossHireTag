"""Settings routes."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from routes.deps import cs

bp = Blueprint("settings", __name__)

@bp.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify(cs().get_settings())


@bp.route("/api/settings", methods=["PATCH"])
def update_settings():
    payload = request.get_json(silent=True) or {}
    next_settings = cs().update_settings(payload)
    channel = request.args.get("channel") or payload.get("channel")
    return jsonify({
        "message": "配置已保存",
        "settings": next_settings,
        "summary": cs().get_summary(channel=channel),
    })

