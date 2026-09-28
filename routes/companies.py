"""Company / summary / backup routes."""
from __future__ import annotations

import json

from flask import Blueprint, Response, g, jsonify, request

from config import AppConfig
from routes.deps import backup_dir, cs, export_filename

bp = Blueprint("companies", __name__)


@bp.route("/api/summary", methods=["GET"])
def summary():
    channel = request.args.get("channel")
    return jsonify(cs().get_summary(channel=channel))


@bp.route("/api/companies", methods=["GET"])
def list_companies():
    time_filter = request.args.get("time_filter", "all")
    channel = request.args.get("channel")
    return jsonify({"items": cs().list_companies(time_filter=time_filter, channel=channel)})


@bp.route("/api/companies", methods=["POST"])
def create_company():
    payload = request.get_json(silent=True) or {}
    if not payload.get("channel"):
        payload["channel"] = request.args.get("channel") or "boss"
    item = cs().create_company(payload)
    return jsonify(
        {
            "message": "记录已新增",
            "item": item,
            "summary": cs().get_summary(channel=item.get("channel")),
        }
    )


@bp.route("/api/companies/import", methods=["POST"])
def import_companies():
    payload = request.get_json(silent=True) or {}
    result = cs().import_rows(payload.get("text", ""), channel=payload.get("channel"))
    return jsonify(
        {
            "message": f"导入 {result['imported_count']} 条，更新 {result['updated_count']} 条，跳过 {result['skipped_count']} 条",
            **result,
        }
    )


@bp.route("/api/companies/import-overwrite", methods=["POST"])
def import_companies_overwrite():
    payload = request.get_json(silent=True) or {}
    result = cs().import_rows(payload.get("text", ""), overwrite=True, channel=payload.get("channel"))
    count = result.get("imported_count", 0) + result.get("updated_count", 0)
    return jsonify(
        {
            "message": f"已覆盖导入 {count} 条",
            **result,
        }
    )


@bp.route("/api/companies/clear", methods=["POST"])
def clear_companies():
    """清空公司记录；body/query 带 channel 时只清该渠道，否则清整账号。自定义标签保留。"""
    payload = request.get_json(silent=True) or {}
    channel = payload.get("channel") or request.args.get("channel")
    result = cs().clear_companies(channel=channel)
    scope = f"渠道「{result.get('channel')}」" if result.get("channel") else "当前账号"
    return jsonify(
        {
            "message": f"已清空{scope} {result['cleared_count']} 条公司记录（自定义标签已保留）",
            **result,
        }
    )


@bp.route("/api/companies/export.csv", methods=["GET"])
def export_companies_csv():
    """导出公司 CSV；可按 channel 过滤。管理中心不传 channel 即全量。"""
    channel = request.args.get("channel")
    body = cs().export_csv(channel=channel)
    return Response(
        body.encode("utf-8-sig"),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={export_filename('csv', channel=channel)}"},
    )


@bp.route("/api/backup", methods=["POST"])
def create_backup():
    """Create backup; with channel query/body, only that channel."""
    payload = request.get_json(silent=True) or {}
    channel = payload.get("channel") or request.args.get("channel")
    result = cs().create_backup(
        backup_dir(),
        app_version=AppConfig.APP_VERSION,
        account=g.account,
        channel=channel,
    )
    return jsonify(
        {
            "message": result["message"],
            "filename": result["filename"],
            "company_count": result["company_count"],
            "channel": result.get("channel") or "",
            "created_at": result["created_at"],
            "payload": result["payload"],
        }
    )


@bp.route("/api/backup", methods=["GET"])
def download_backup():
    """One-click: save backup on server and download the file. Optional channel filter."""
    channel = request.args.get("channel")
    result = cs().create_backup(
        backup_dir(),
        app_version=AppConfig.APP_VERSION,
        account=g.account,
        channel=channel,
    )
    body = json.dumps(result["payload"], ensure_ascii=False, indent=2) + "\n"
    return Response(
        body,
        mimetype="application/json; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={result['filename']}"},
    )


@bp.route("/api/backups", methods=["GET"])
def list_backups():
    return jsonify({"items": cs().list_backups(backup_dir())})


@bp.route("/api/backup/restore", methods=["POST"])
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
        result = cs().restore_backup(payload)
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


@bp.route("/api/companies/<company_id>", methods=["PATCH"])
def update_company(company_id: str):
    payload = request.get_json(silent=True) or {}
    item = cs().update_company(company_id, payload)
    return jsonify(
        {
            "message": "记录已更新",
            "item": item,
            "summary": cs().get_summary(channel=item.get("channel")),
        }
    )


@bp.route("/api/companies/<company_id>", methods=["DELETE"])
def delete_company(company_id: str):
    channel = request.args.get("channel")
    result = cs().delete_company(company_id)
    return jsonify(
        {
            "message": "记录已删除",
            **result,
            "summary": cs().get_summary(channel=channel),
        }
    )


@bp.route("/api/companies/fix-history", methods=["POST"])
def fix_company_history():
    result = cs().fix_history_timestamps()
    return jsonify(result)

