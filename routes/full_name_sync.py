"""企业全称跨名单同步路由（NDJSON 流式进度）。"""
from __future__ import annotations

import json

from flask import Blueprint, Response, stream_with_context

from routes.deps import bls, blocklist_svc, cs, watchlist_svc
from services.full_name_sync import FullNameSyncService

bp = Blueprint("full_name_sync", __name__)


@bp.route("/api/company-full-name-sync", methods=["POST"])
def sync_company_full_names():
    service = FullNameSyncService(
        companies=cs(),
        ignored=bls(),
        blocklist=blocklist_svc(),
        watchlist=watchlist_svc(),
    )

    @stream_with_context
    def generate():
        try:
            for event in service.iter_events():
                yield json.dumps(event, ensure_ascii=False) + "\n"
        except Exception as exc:  # noqa: BLE001 — 流式接口需把错误传给前端
            yield json.dumps(
                {"type": "error", "message": str(exc) or "企业全称同步失败"},
                ensure_ascii=False,
            ) + "\n"

    return Response(
        generate(),
        mimetype="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
