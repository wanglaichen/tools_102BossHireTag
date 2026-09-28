"""黑名单企业路由（与忽略企业 /api/ignored 隔离）。"""
from __future__ import annotations

from flask import Blueprint, Response, g, jsonify, request

from routes.deps import blocklist_svc

bp = Blueprint("blocklist", __name__)


@bp.route("/api/blocklist", methods=["GET"])
def list_blocklist():
    keyword = request.args.get("q", "")
    return jsonify({
        "items": blocklist_svc().list_items(keyword=keyword),
        "summary": blocklist_svc().get_summary(),
    })


@bp.route("/api/blocklist", methods=["POST"])
def create_blocklist_item():
    payload = request.get_json(silent=True) or {}
    item = blocklist_svc().create_item(payload)
    return jsonify({
        "message": "已加入黑名单",
        "item": item,
        "summary": blocklist_svc().get_summary(),
        "items": blocklist_svc().list_items(),
    }), 201


@bp.route("/api/blocklist/backup", methods=["POST"])
def backup_blocklist():
    account = {
        "id": str((g.account or {}).get("id") or ""),
        "username": str((g.account or {}).get("username") or ""),
        "displayName": str((g.account or {}).get("displayName") or (g.account or {}).get("username") or ""),
    }
    result = blocklist_svc().export_backup(account=account)
    return jsonify({
        "message": result.get("message") or "备份完成",
        "filename": result["filename"],
        "company_count": result.get("company_count", 0),
        "payload": result["payload"],
    })


@bp.route("/api/blocklist/export.csv", methods=["GET"])
def export_blocklist_csv():
    body = blocklist_svc().export_csv()
    username = str((g.account or {}).get("username") or "account")
    safe = "".join(ch for ch in username if ch.isalnum() or ch in "._-") or "account"
    return Response(
        body.encode("utf-8-sig"),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={safe}-blocklist.csv"},
    )


@bp.route("/api/blocklist/import", methods=["POST"])
def import_blocklist():
    payload = request.get_json(silent=True) or {}
    result = blocklist_svc().import_backup(payload.get("text", ""), overwrite=False)
    return jsonify({
        "message": f"导入黑名单 {result['imported_count']} 条，更新 {result['updated_count']} 条，跳过 {result['skipped_count']} 条",
        **result,
    })


@bp.route("/api/blocklist/import-overwrite", methods=["POST"])
def import_blocklist_overwrite():
    payload = request.get_json(silent=True) or {}
    result = blocklist_svc().import_backup(payload.get("text", ""), overwrite=True)
    count = result.get("imported_count", 0) + result.get("updated_count", 0)
    return jsonify({
        "message": f"已覆盖导入黑名单 {count} 条",
        **result,
    })


@bp.route("/api/blocklist/clear", methods=["POST"])
def clear_blocklist():
    result = blocklist_svc().clear_items()
    return jsonify({
        "message": f"已清空黑名单 {result['cleared_count']} 条",
        **result,
    })


@bp.route("/api/blocklist/<item_id>", methods=["PATCH"])
def update_blocklist_item(item_id: str):
    payload = request.get_json(silent=True) or {}
    item = blocklist_svc().update_item(item_id, payload)
    return jsonify({
        "message": "黑名单已更新",
        "item": item,
        "summary": blocklist_svc().get_summary(),
        "items": blocklist_svc().list_items(),
    })


@bp.route("/api/blocklist/<item_id>", methods=["DELETE"])
def delete_blocklist_item(item_id: str):
    result = blocklist_svc().delete_item(item_id)
    return jsonify({
        "message": "已移出黑名单",
        **result,
        "summary": blocklist_svc().get_summary(),
        "items": blocklist_svc().list_items(),
    })
