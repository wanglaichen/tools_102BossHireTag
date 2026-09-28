"""忽略企业（原黑名单）路由；/api/ignored 为主，/api/blacklist 兼容别名。"""
from __future__ import annotations

from flask import Blueprint, Response, g, jsonify, request

from routes.deps import bls

bp = Blueprint("ignored", __name__)


def _list_items():
    keyword = request.args.get("q", "")
    channel = request.args.get("channel")
    return jsonify({
        "items": bls().list_items(keyword=keyword, channel=channel),
        "summary": bls().get_summary(channel=channel),
    })


def _create_item():
    payload = request.get_json(silent=True) or {}
    if not payload.get("channel"):
        payload["channel"] = request.args.get("channel") or "boss"
    item = bls().create_item(payload)
    channel = item.get("channel")
    return jsonify({
        "message": "已加入忽略企业",
        "item": item,
        "summary": bls().get_summary(channel=channel),
        "items": bls().list_items(channel=channel),
    }), 201


def _update_item(item_id: str):
    payload = request.get_json(silent=True) or {}
    item = bls().update_item(item_id, payload)
    channel = item.get("channel") or request.args.get("channel")
    return jsonify({
        "message": "忽略企业已更新",
        "item": item,
        "summary": bls().get_summary(channel=channel),
        "items": bls().list_items(channel=channel),
    })


def _delete_item(item_id: str):
    channel = request.args.get("channel")
    result = bls().delete_item(item_id)
    return jsonify({
        "message": "已移出忽略企业",
        **result,
        "summary": bls().get_summary(channel=channel),
        "items": bls().list_items(channel=channel),
    })


def _current_channel(payload: dict | None = None) -> str | None:
    body = payload if isinstance(payload, dict) else {}
    return body.get("channel") or request.args.get("channel")


@bp.route("/api/ignored", methods=["GET"])
@bp.route("/api/blacklist", methods=["GET"])
def list_ignored():
    return _list_items()


@bp.route("/api/ignored", methods=["POST"])
@bp.route("/api/blacklist", methods=["POST"])
def create_ignored_item():
    return _create_item()


@bp.route("/api/ignored/backup", methods=["POST"])
@bp.route("/api/blacklist/backup", methods=["POST"])
def backup_ignored():
    """当前登录账号：按渠道（或全量）下载忽略企业备份。"""
    payload = request.get_json(silent=True) or {}
    channel = _current_channel(payload)
    account = {
        "id": str((g.account or {}).get("id") or ""),
        "username": str((g.account or {}).get("username") or ""),
        "displayName": str((g.account or {}).get("displayName") or (g.account or {}).get("username") or ""),
    }
    result = bls().export_backup(account=account, channel=channel)
    return jsonify({
        "message": result.get("message") or "备份完成",
        "filename": result["filename"],
        "company_count": result.get("company_count", 0),
        "channel": result.get("channel") or "",
        "payload": result["payload"],
    })


@bp.route("/api/ignored/export.csv", methods=["GET"])
@bp.route("/api/blacklist/export.csv", methods=["GET"])
def export_ignored_csv():
    channel = request.args.get("channel")
    body = bls().export_csv(channel=channel)
    username = str((g.account or {}).get("username") or "account")
    safe = "".join(ch for ch in username if ch.isalnum() or ch in "._-") or "account"
    ch = str(channel or "").strip()
    ch_tag = f"-{ch}" if ch else ""
    return Response(
        body.encode("utf-8-sig"),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={safe}-ignored{ch_tag}.csv"},
    )


@bp.route("/api/ignored/import", methods=["POST"])
@bp.route("/api/blacklist/import", methods=["POST"])
def import_ignored():
    payload = request.get_json(silent=True) or {}
    channel = _current_channel(payload)
    result = bls().import_backup(payload.get("text", ""), overwrite=False, channel=channel)
    return jsonify({
        "message": f"导入忽略企业 {result['imported_count']} 条，更新 {result['updated_count']} 条，跳过 {result['skipped_count']} 条",
        **result,
    })


@bp.route("/api/ignored/import-overwrite", methods=["POST"])
@bp.route("/api/blacklist/import-overwrite", methods=["POST"])
def import_ignored_overwrite():
    payload = request.get_json(silent=True) or {}
    channel = _current_channel(payload)
    result = bls().import_backup(payload.get("text", ""), overwrite=True, channel=channel)
    count = result.get("imported_count", 0) + result.get("updated_count", 0)
    scope = f"渠道「{channel}」" if channel else "全部"
    return jsonify({
        "message": f"已覆盖导入忽略企业（{scope}）{count} 条",
        **result,
    })


@bp.route("/api/ignored/clear", methods=["POST"])
@bp.route("/api/blacklist/clear", methods=["POST"])
def clear_ignored():
    payload = request.get_json(silent=True) or {}
    channel = _current_channel(payload)
    result = bls().clear_items(channel=channel)
    scope = f"渠道「{result.get('channel')}」" if result.get("channel") else "当前账号"
    return jsonify({
        "message": f"已清空{scope} {result['cleared_count']} 条忽略企业",
        **result,
    })


@bp.route("/api/ignored/<item_id>", methods=["PATCH"])
@bp.route("/api/blacklist/<item_id>", methods=["PATCH"])
def update_ignored_item(item_id: str):
    return _update_item(item_id)


@bp.route("/api/ignored/<item_id>", methods=["DELETE"])
@bp.route("/api/blacklist/<item_id>", methods=["DELETE"])
def delete_ignored_item(item_id: str):
    return _delete_item(item_id)
