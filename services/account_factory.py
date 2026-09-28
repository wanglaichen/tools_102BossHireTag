"""Per-account CompanyService / BlacklistService factories with cache."""
from __future__ import annotations

from pathlib import Path

from config import AppConfig
from services.blacklist_service import BlacklistService
from services.company_service import CompanyService
from services.storage import RedisSettingsStore, create_storage

_account_services: dict[str, CompanyService] = {}
_blacklist_services: dict[str, BlacklistService] = {}
_blocklist_services: dict[str, "BlocklistService"] = {}
_job_update_services: dict[str, "JobUpdateService"] = {}

try:
    import redis as _redis
except ImportError:  # pragma: no cover
    _redis = None


def service_for_account(user: dict) -> CompanyService:
    user_id = str(user["id"])
    cached = _account_services.get(user_id)
    if cached is not None:
        return cached
    legacy = bool(user.get("legacyStore"))
    prefix = AppConfig.REDIS_KEY_PREFIX if legacy else f"{AppConfig.REDIS_KEY_PREFIX}:user:{user_id}"
    settings_key = AppConfig.REDIS_SETTINGS_KEY if legacy else f"{prefix}:settings"
    storage_file = (
        AppConfig.STORAGE_FILE
        if legacy
        else str(Path(AppConfig.DATA_DIR) / "users" / user_id / "companies.json")
    )
    config = dict(AppConfig.__dict__)
    config["REDIS_KEY_PREFIX"] = prefix
    config["STORAGE_FILE"] = storage_file
    service = CompanyService(
        create_storage(config),
        settings_store=RedisSettingsStore(AppConfig.REDIS_URL, settings_key, AppConfig.REDIS_TIMEOUT_SECONDS),
    )
    _account_services[user_id] = service
    return service


def _resolve_ignored_storage_file(legacy: bool, user_id: str) -> str:
    """优先 ignored.json；若仅有旧 blacklist.json 则复制迁移。"""
    if legacy:
        new_path = Path(AppConfig.DATA_DIR) / "ignored.json"
        old_path = Path(AppConfig.DATA_DIR) / "blacklist.json"
    else:
        user_dir = Path(AppConfig.DATA_DIR) / "users" / user_id
        new_path = user_dir / "ignored.json"
        old_path = user_dir / "blacklist.json"
    if not new_path.exists() and old_path.exists():
        new_path.parent.mkdir(parents=True, exist_ok=True)
        new_path.write_bytes(old_path.read_bytes())
    return str(new_path)


def _redis_client():
    redis_url = (AppConfig.REDIS_URL or "").strip()
    if not redis_url or _redis is None:
        return None
    return _redis.Redis.from_url(
        redis_url,
        decode_responses=True,
        socket_connect_timeout=AppConfig.REDIS_TIMEOUT_SECONDS,
        socket_timeout=AppConfig.REDIS_TIMEOUT_SECONDS,
    )


def _prefix_has_data(prefix: str) -> bool:
    client = _redis_client()
    if client is None:
        return False
    prefix = prefix.rstrip(":")
    try:
        for key in client.scan_iter(match=f"{prefix}*", count=50):
            return True
    except Exception:
        return False
    return False


def _migrate_redis_blacklist_prefix_to_ignored(old_prefix: str, new_prefix: str) -> None:
    """将 …:blacklist:* 重命名为 …:ignored:*（目标 key 已存在则跳过）。"""
    client = _redis_client()
    if client is None:
        return
    old_prefix = old_prefix.rstrip(":")
    new_prefix = new_prefix.rstrip(":")
    if old_prefix == new_prefix:
        return
    try:
        for key in client.scan_iter(match=f"{old_prefix}*", count=200):
            key_s = str(key)
            if not key_s.startswith(old_prefix):
                continue
            new_key = new_prefix + key_s[len(old_prefix) :]
            if client.exists(new_key):
                continue
            try:
                client.rename(key_s, new_key)
            except Exception:
                pass
    except Exception:
        return


def blacklist_for_account(user: dict) -> BlacklistService:
    """忽略企业（原黑名单）按账号隔离；存储前缀 blacklist → ignored。"""
    user_id = str(user["id"])
    cached = _blacklist_services.get(user_id)
    if cached is not None:
        return cached
    legacy = bool(user.get("legacyStore"))
    base = AppConfig.REDIS_KEY_PREFIX if legacy else f"{AppConfig.REDIS_KEY_PREFIX}:user:{user_id}"
    old_prefix = f"{base}:blacklist"
    new_prefix = f"{base}:ignored"
    _migrate_redis_blacklist_prefix_to_ignored(old_prefix, new_prefix)
    # 迁移后若新前缀仍无数据而旧前缀有，则本会话继续读旧前缀，下次启动再迁
    prefix = new_prefix
    if (AppConfig.REDIS_URL or "").strip():
        if not _prefix_has_data(new_prefix) and _prefix_has_data(old_prefix):
            prefix = old_prefix
    storage_file = _resolve_ignored_storage_file(legacy, user_id)
    config = dict(AppConfig.__dict__)
    config["REDIS_KEY_PREFIX"] = prefix
    config["STORAGE_FILE"] = storage_file
    service = BlacklistService(create_storage(config, data_hash_name="items"))
    _blacklist_services[user_id] = service
    return service


def blocklist_for_account(user: dict):
    """黑名单企业：独立 Redis 前缀 …:blocklist，与忽略企业 …:ignored 隔离。"""
    from services.blocklist_service import BlocklistService

    user_id = str(user["id"])
    cached = _blocklist_services.get(user_id)
    if cached is not None:
        return cached
    legacy = bool(user.get("legacyStore"))
    base = AppConfig.REDIS_KEY_PREFIX if legacy else f"{AppConfig.REDIS_KEY_PREFIX}:user:{user_id}"
    prefix = f"{base}:blocklist"
    if legacy:
        storage_file = str(Path(AppConfig.DATA_DIR) / "blocklist.json")
    else:
        storage_file = str(Path(AppConfig.DATA_DIR) / "users" / user_id / "blocklist.json")
    config = dict(AppConfig.__dict__)
    config["REDIS_KEY_PREFIX"] = prefix
    config["STORAGE_FILE"] = storage_file
    service = BlocklistService(create_storage(config, data_hash_name="items"))
    _blocklist_services[user_id] = service
    return service


def job_updates_for_account(user: dict):
    """更新企业（岗位采集）：独立前缀 …:job-updates。"""
    from services.job_update_service import JobUpdateService

    user_id = str(user["id"])
    cached = _job_update_services.get(user_id)
    if cached is not None:
        return cached
    legacy = bool(user.get("legacyStore"))
    base = AppConfig.REDIS_KEY_PREFIX if legacy else f"{AppConfig.REDIS_KEY_PREFIX}:user:{user_id}"
    prefix = f"{base}:job-updates"
    if legacy:
        storage_file = str(Path(AppConfig.DATA_DIR) / "job_updates.json")
    else:
        storage_file = str(Path(AppConfig.DATA_DIR) / "users" / user_id / "job_updates.json")
    config = dict(AppConfig.__dict__)
    config["REDIS_KEY_PREFIX"] = prefix
    config["STORAGE_FILE"] = storage_file
    service = JobUpdateService(create_storage(config, data_hash_name="items"))
    _job_update_services[user_id] = service
    return service


def drop_account_caches(user_id: str) -> None:
    _account_services.pop(user_id, None)
    _blacklist_services.pop(user_id, None)
    _blocklist_services.pop(user_id, None)
    _job_update_services.pop(user_id, None)
