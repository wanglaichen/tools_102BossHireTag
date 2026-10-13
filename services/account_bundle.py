"""整账号数据包：投递登记 + 忽略/黑名单/关注 + 岗位更新，支持增量与覆盖导入。"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import AppConfig
from services.account_factory import (
    blacklist_for_account,
    blocklist_for_account,
    job_updates_for_account,
    service_for_account,
    watchlist_for_account,
)

BUNDLE_TYPE = "tools102-boss-hire-tag-account-bundle"
BUNDLE_SCHEMA_VERSION = 1


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _safe_name(username: str) -> str:
    return "".join(ch for ch in (username or "account") if ch.isalnum() or ch in "._-") or "account"


def _account_meta(account: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(account, dict) or not account.get("id"):
        return None
    return {
        "id": str(account.get("id") or ""),
        "username": str(account.get("username") or ""),
        "displayName": str(account.get("displayName") or account.get("username") or ""),
    }


def is_account_bundle(payload: Any) -> bool:
    return isinstance(payload, dict) and payload.get("type") == BUNDLE_TYPE


def export_account_bundle(user: dict[str, Any], *, public_account: dict[str, Any] | None = None) -> dict[str, Any]:
    """导出账号全部业务数据（不含密码等敏感字段）。"""
    account = _account_meta(public_account or user)
    companies_svc = service_for_account(user)
    backup_dir = str(Path(AppConfig.DATA_DIR) / "backups" / str(user.get("id") or "unknown"))
    companies = companies_svc.create_backup(
        backup_dir,
        app_version=AppConfig.APP_VERSION,
        account=account,
    )
    ignored = blacklist_for_account(user).export_backup(account=account)
    blocklist = blocklist_for_account(user).export_backup(account=account)
    watchlist = watchlist_for_account(user).export_backup(account=account)
    job_items = job_updates_for_account(user).list_items()

    sections = {
        "companies": companies["payload"],
        "ignored": ignored["payload"],
        "blocklist": blocklist["payload"],
        "watchlist": watchlist["payload"],
        "job_updates": {
            "type": "tools102-boss-hire-tag-job-updates-backup",
            "schema_version": 1,
            "items": job_items,
        },
    }
    counts = {
        "companies": len((sections["companies"] or {}).get("companies") or []),
        "ignored": len((sections["ignored"] or {}).get("items") or []),
        "blocklist": len((sections["blocklist"] or {}).get("items") or []),
        "watchlist": len((sections["watchlist"] or {}).get("items") or []),
        "job_updates": len(job_items),
    }
    created_at = _now_iso()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    username = (account or {}).get("username") or "account"
    filename = f"account-bundle_{_safe_name(str(username))}_{stamp}.json"
    payload = {
        "type": BUNDLE_TYPE,
        "schema_version": BUNDLE_SCHEMA_VERSION,
        "app_version": AppConfig.APP_VERSION,
        "exported_at": created_at,
        "account": account,
        "counts": counts,
        "sections": sections,
    }
    return {
        "payload": payload,
        "filename": filename,
        "counts": counts,
        "message": (
            f"已导出账号「{username}」全部数据："
            f"登记 {counts['companies']}、忽略 {counts['ignored']}、"
            f"黑名单 {counts['blocklist']}、关注 {counts['watchlist']}、"
            f"岗位更新 {counts['job_updates']}"
        ),
    }


def _section_text(section: Any) -> str:
    return json.dumps(section, ensure_ascii=False)


def _import_job_updates(user: dict[str, Any], section: Any, *, overwrite: bool) -> dict[str, Any]:
    svc = job_updates_for_account(user)
    if isinstance(section, dict):
        items = section.get("items") or []
    elif isinstance(section, list):
        items = section
    else:
        items = []
    if not isinstance(items, list):
        raise ValueError("岗位更新备份缺少 items")
    if overwrite:
        svc.clear_items()
    return svc.upsert_batch(items, preserve_updated_at=True)


def import_account_bundle(
    user: dict[str, Any],
    text: str,
    *,
    overwrite: bool = False,
) -> dict[str, Any]:
    """将数据包导入目标账号。overwrite=True 为覆盖，False 为增量合并。"""
    if not str(text or "").strip():
        raise ValueError("导入内容不能为空")
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("账号数据包必须是 JSON") from exc

    # 兼容旧的「仅公司备份」文件
    if not is_account_bundle(payload):
        companies = service_for_account(user).import_rows(text, overwrite=overwrite)
        return {
            "mode": "overwrite" if overwrite else "merge",
            "legacy_companies_only": True,
            "sections": {"companies": companies},
            "message": (
                f"{'覆盖' if overwrite else '增量'}导入登记数据："
                f"新增 {companies.get('imported_count', 0)}，"
                f"更新 {companies.get('updated_count', 0)}，"
                f"跳过 {companies.get('skipped_count', 0)}"
            ),
        }

    sections = payload.get("sections") if isinstance(payload.get("sections"), dict) else {}
    results: dict[str, Any] = {}

    if "companies" in sections and sections["companies"] is not None:
        results["companies"] = service_for_account(user).import_rows(
            _section_text(sections["companies"]),
            overwrite=overwrite,
        )
    if "ignored" in sections and sections["ignored"] is not None:
        results["ignored"] = blacklist_for_account(user).import_backup(
            _section_text(sections["ignored"]),
            overwrite=overwrite,
        )
    if "blocklist" in sections and sections["blocklist"] is not None:
        results["blocklist"] = blocklist_for_account(user).import_backup(
            _section_text(sections["blocklist"]),
            overwrite=overwrite,
        )
    if "watchlist" in sections and sections["watchlist"] is not None:
        results["watchlist"] = watchlist_for_account(user).import_backup(
            _section_text(sections["watchlist"]),
            overwrite=overwrite,
        )
    if "job_updates" in sections and sections["job_updates"] is not None:
        results["job_updates"] = _import_job_updates(user, sections["job_updates"], overwrite=overwrite)

    if not results:
        raise ValueError("数据包中没有可导入的业务分区")

    parts = []
    if "companies" in results:
        c = results["companies"]
        parts.append(
            f"登记 +{c.get('imported_count', 0)}/~{c.get('updated_count', 0)}"
        )
    for key, label in (
        ("ignored", "忽略"),
        ("blocklist", "黑名单"),
        ("watchlist", "关注"),
    ):
        if key in results:
            r = results[key]
            parts.append(
                f"{label} +{r.get('imported_count', 0)}/~{r.get('updated_count', 0)}"
            )
    if "job_updates" in results:
        j = results["job_updates"]
        parts.append(f"岗位 +{j.get('created_count', 0)}/~{j.get('updated_count', 0)}")

    return {
        "mode": "overwrite" if overwrite else "merge",
        "legacy_companies_only": False,
        "sections": results,
        "message": f"{'覆盖' if overwrite else '增量'}导入完成：{'；'.join(parts)}",
    }
