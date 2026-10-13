"""持续关注企业路由（账号级，无渠道）。"""
from __future__ import annotations

from flask import Blueprint, Response, g, jsonify, request

from routes.deps import watchlist_svc

bp = Blueprint("watchlist", __name__)


@bp.route("/api/watchlist", methods=["GET"])
def list_watchlist():
    keyword = request.args.get("q", "")
    return jsonify({
        "items": watchlist_svc().list_items(keyword=keyword),
        "summary": watchlist_svc().get_summary(),
    })


@bp.route("/api/watchlist", methods=["POST"])
def create_watchlist_item():
    payload = request.get_json(silent=True) or {}
    item = watchlist_svc().create_item(payload)
    return jsonify({
        "message": "已加入持续关注",
        "item": item,
        "summary": watchlist_svc().get_summary(),
        "items": watchlist_svc().list_items(),
    }), 201


@bp.route("/api/watchlist/backup", methods=["POST"])
def backup_watchlist():
    account = {
        "id": str((g.account or {}).get("id") or ""),
        "username": str((g.account or {}).get("username") or ""),
        "displayName": str((g.account or {}).get("displayName") or (g.account or {}).get("username") or ""),
    }
    result = watchlist_svc().export_backup(account=account)
    return jsonify({
        "message": result.get("message") or "备份完成",
        "filename": result["filename"],
        "company_count": result.get("company_count", 0),
        "payload": result["payload"],
    })


@bp.route("/api/watchlist/export.csv", methods=["GET"])
def export_watchlist_csv():
    body = watchlist_svc().export_csv()
    username = str((g.account or {}).get("username") or "account")
    safe = "".join(ch for ch in username if ch.isalnum() or ch in "._-") or "account"
    return Response(
        body.encode("utf-8-sig"),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={safe}-watchlist.csv"},
    )


@bp.route("/api/watchlist/import", methods=["POST"])
def import_watchlist():
    payload = request.get_json(silent=True) or {}
    result = watchlist_svc().import_backup(payload.get("text", ""), overwrite=False)
    return jsonify({
        "message": (
            f"导入持续关注 {result['imported_count']} 条，"
            f"更新 {result['updated_count']} 条，跳过 {result['skipped_count']} 条"
        ),
        **result,
    })


@bp.route("/api/watchlist/import-overwrite", methods=["POST"])
def import_watchlist_overwrite():
    payload = request.get_json(silent=True) or {}
    result = watchlist_svc().import_backup(payload.get("text", ""), overwrite=True)
    count = result.get("imported_count", 0) + result.get("updated_count", 0)
    return jsonify({
        "message": f"已覆盖导入持续关注 {count} 条",
        **result,
    })


@bp.route("/api/watchlist/clear", methods=["POST"])
def clear_watchlist():
    result = watchlist_svc().clear_items()
    return jsonify({
        "message": f"已清空持续关注 {result['cleared_count']} 条",
        **result,
    })


@bp.route("/api/watchlist/<item_id>", methods=["PATCH"])
def update_watchlist_item(item_id: str):
    payload = request.get_json(silent=True) or {}
    item = watchlist_svc().update_item(item_id, payload)
    return jsonify({
        "message": "持续关注已更新",
        "item": item,
        "summary": watchlist_svc().get_summary(),
        "items": watchlist_svc().list_items(),
    })


@bp.route("/api/watchlist/<item_id>", methods=["DELETE"])
def delete_watchlist_item(item_id: str):
    result = watchlist_svc().delete_item(item_id)
    return jsonify({
        "message": "已移出持续关注",
        **result,
        "summary": watchlist_svc().get_summary(),
        "items": watchlist_svc().list_items(),
    })
