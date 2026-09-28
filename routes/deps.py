"""Shared request helpers for route modules."""
from __future__ import annotations

from pathlib import Path

from flask import g

from config import AppConfig
from services.account_factory import (
    blacklist_for_account,
    blocklist_for_account,
    job_updates_for_account,
    service_for_account,
)
from services.auth_service import AuthError, AuthService
from services.blacklist_service import BlacklistService
from services.blocklist_service import BlocklistService
from services.channel_service import ChannelService
from services.company_service import CompanyService
from services.job_update_service import JobUpdateService
from services.storage import RedisProxyStore

auth_service: AuthService | None = None
channel_service: ChannelService | None = None


def init_deps(auth: AuthService, channels: ChannelService) -> None:
    global auth_service, channel_service
    auth_service = auth
    channel_service = channels


def get_auth() -> AuthService:
    assert auth_service is not None
    return auth_service


def get_channels() -> ChannelService:
    assert channel_service is not None
    return channel_service


def cs() -> CompanyService:
    user = getattr(g, "account", None)
    if not user:
        raise AuthError("未登录")
    return service_for_account(user)


def bls() -> BlacklistService:
    user = getattr(g, "account", None)
    if not user:
        raise AuthError("未登录")
    return blacklist_for_account(user)


def blocklist_svc() -> BlocklistService:
    user = getattr(g, "account", None)
    if not user:
        raise AuthError("未登录")
    return blocklist_for_account(user)


def job_updates_svc() -> JobUpdateService:
    user = getattr(g, "account", None)
    if not user:
        raise AuthError("未登录")
    return job_updates_for_account(user)


def require_admin() -> dict:
    user = getattr(g, "account", None)
    if not user or user.get("role") != "admin":
        raise AuthError("需要管理员权限", 403)
    return user


def export_filename(ext: str, channel: str | None = None) -> str:
    username = str((getattr(g, "account", None) or {}).get("username") or "account")
    safe = "".join(ch for ch in username if ch.isalnum() or ch in "._-") or "account"
    channel_id = str(channel or "").strip()
    if channel_id:
        ch_safe = "".join(ch for ch in channel_id if ch.isalnum() or ch in "._-") or "channel"
        return f"{safe}-{ch_safe}-companies.{ext}"
    return f"{safe}-companies.{ext}"


def backup_dir() -> str:
    user = getattr(g, "account", None) or {}
    user_id = str(user.get("id") or "anonymous")
    return str(Path(AppConfig.DATA_DIR) / "backups" / user_id)


def proxy_store() -> RedisProxyStore:
    return RedisProxyStore(AppConfig.REDIS_URL, AppConfig.REDIS_PROXY_KEY, AppConfig.REDIS_TIMEOUT_SECONDS)
