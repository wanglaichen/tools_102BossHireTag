"""Admin summary and shutdown."""
from __future__ import annotations

import os

from flask import Blueprint, g, jsonify, request

from routes.deps import get_auth, get_channels, require_admin
from services.account_factory import blacklist_for_account, service_for_account
from services.auth_service import AuthError

bp = Blueprint("admin", __name__)


@bp.route("/api/admin/summary", methods=["GET"])
def admin_summary():
    require_admin()
    channels = get_channels().list_channels()
    users_out = []
    total_companies = 0
    channel_totals: dict[str, int] = {item["id"]: 0 for item in channels}
    for user in get_auth().list_users():
        full = get_auth().read_user(user["id"])
        if not full:
            continue
        service = service_for_account(full)
        by_channel = service.count_by_channel()
        company_count = sum(by_channel.values())
        total_companies += company_count
        for cid, count in by_channel.items():
            channel_totals[cid] = channel_totals.get(cid, 0) + int(count)
        bl_count = 0
        try:
            bl_count = len(blacklist_for_account(full).list_items())
        except Exception:
            bl_count = 0
        users_out.append(
            {
                **user,
                "company_count": company_count,
                "ignored_count": bl_count,
                "blacklist_count": bl_count,
                "by_channel": by_channel,
            }
        )
    return jsonify(
        {
            "channels": channels,
            "users": users_out,
            "totals": {
                "user_count": len(users_out),
                "company_count": total_companies,
                "channel_count": len(channels),
                "by_channel": channel_totals,
            },
        }
    )


@bp.route("/api/shutdown", methods=["POST"])
def shutdown_server():
    """Gracefully stop the running Flask process.

    Prefers Werkzeug's dev-server shutdown hook; falls back to os._exit
    so it also works when not running under the Werkzeug reloader.
    """
    # 关闭进程只允许已登录管理员
    if getattr(g, "account", None) is None or g.account.get("role") != "admin":
        raise AuthError("仅管理员可关闭服务", 403)

    shutdown_func = request.environ.get("werkzeug.server.shutdown")
    if shutdown_func is not None:
        try:
            shutdown_func()
        except RuntimeError:
            pass
        return jsonify({"message": "服务已关闭"})

    os._exit(0)
