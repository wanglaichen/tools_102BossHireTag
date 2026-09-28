"""更新企业（岗位采集）API：按渠道 upsert，企业名+岗位名哈希唯一。"""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from routes.deps import job_updates_svc

bp = Blueprint("job_updates", __name__)


def _channel_from_request(payload: dict | None = None) -> str | None:
    body = payload if isinstance(payload, dict) else {}
    return body.get("channel") or request.args.get("channel")


@bp.route("/api/job-updates", methods=["GET"])
def list_job_updates():
    channel = request.args.get("channel")
    keyword = request.args.get("q", "")
    time_filter = request.args.get("time_filter", "all")
    date_value = request.args.get("date", "")
    from_ts = _parse_int_arg(request.args.get("from_ts"))
    to_ts = _parse_int_arg(request.args.get("to_ts"))
    items = job_updates_svc().list_items(
        channel=channel,
        keyword=keyword,
        time_filter=time_filter,
        date_value=date_value,
        from_ts=from_ts,
        to_ts=to_ts,
    )
    summary = job_updates_svc().get_summary(
        channel,
        keyword=keyword,
        time_filter=time_filter,
        date_value=date_value,
        from_ts=from_ts,
        to_ts=to_ts,
    )
    return jsonify({
        "items": items,
        "summary": summary,
    })


def _parse_int_arg(raw: str | None) -> int | None:
    text = str(raw or "").strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


@bp.route("/api/job-updates", methods=["POST"])
def upsert_job_update():
    """单条采集入库（upsert）。必填：company_name, job_title, channel。"""
    payload = request.get_json(silent=True) or {}
    if not payload.get("channel"):
        payload["channel"] = request.args.get("channel") or "boss"
    result = job_updates_svc().upsert_item(payload)
    item = result["item"]
    channel = item.get("channel")
    created = result["created"]
    return jsonify({
        "message": "已新增岗位采集" if created else "已更新岗位采集",
        "created": created,
        "item": item,
        "summary": job_updates_svc().get_summary(channel=channel),
        "items": job_updates_svc().list_items(channel=channel),
    }), (201 if created else 200)


@bp.route("/api/job-updates/batch", methods=["POST"])
def upsert_job_updates_batch():
    """批量采集入库。body: { channel?, items: [{ company_name, job_title, location?, job_summary?, salary_min?, salary_max?, channel? }] }"""
    payload = request.get_json(silent=True) or {}
    items = payload.get("items")
    if items is None and isinstance(payload.get("data"), list):
        items = payload.get("data")
    if not isinstance(items, list):
        return jsonify({"message": "请提供 items 数组"}), 400
    channel = _channel_from_request(payload)
    result = job_updates_svc().upsert_batch(items, channel=channel)
    return jsonify({
        "message": (
            f"批量完成：新增 {result['created_count']}，更新 {result['updated_count']}，"
            f"跳过 {result['skipped_count']}"
        ),
        **result,
    })


@bp.route("/api/job-updates/clear", methods=["POST"])
def clear_job_updates():
    payload = request.get_json(silent=True) or {}
    channel = _channel_from_request(payload)
    result = job_updates_svc().clear_items(channel=channel)
    scope = f"渠道「{result.get('channel')}」" if result.get("channel") else "全部渠道"
    return jsonify({
        "message": f"已清空{scope} {result['cleared_count']} 条岗位采集",
        **result,
    })


@bp.route("/api/job-updates/<item_id>", methods=["DELETE"])
def delete_job_update(item_id: str):
    channel = request.args.get("channel")
    result = job_updates_svc().delete_item(item_id)
    return jsonify({
        "message": "已删除岗位采集",
        **result,
        "summary": job_updates_svc().get_summary(channel=channel),
        "items": job_updates_svc().list_items(channel=channel),
    })
