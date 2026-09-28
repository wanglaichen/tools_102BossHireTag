"""Global hiring channel routes."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from routes.deps import get_auth, get_channels, require_admin
from services.account_factory import service_for_account

bp = Blueprint("channels", __name__)

@bp.route("/api/channels", methods=["GET"])
def list_channels():
    return jsonify({"items": get_channels().list_channels()})


@bp.route("/api/channels", methods=["POST"])
def create_channel():
    require_admin()
    payload = request.get_json(silent=True) or {}
    try:
        item = get_channels().create_channel(name=payload.get("name", ""), channel_id=payload.get("id"))
    except ValueError as error:
        status = 409 if "已存在" in str(error) else 400
        return jsonify({"message": str(error)}), status
    return jsonify({"item": item, "message": "渠道已添加", "items": get_channels().list_channels()}), 201


@bp.route("/api/channels/<channel_id>", methods=["DELETE"])
def delete_channel(channel_id: str):
    """删除渠道页签；各账号公司数据一律保留为残留数据。"""
    require_admin()
    residual = 0
    for user in get_auth().list_users():
        full = get_auth().read_user(user["id"])
        if not full:
            continue
        counts = service_for_account(full).count_by_channel()
        residual += int(counts.get(channel_id, 0) or 0)
    try:
        result = get_channels().delete_channel(channel_id)
    except ValueError as error:
        return jsonify({"message": str(error)}), 400
    result["residual_count"] = residual
    if residual:
        result["message"] = f"渠道页签已移除；已有 {residual} 条公司数据保留未删"
    return jsonify({**result, "items": get_channels().list_channels()})

