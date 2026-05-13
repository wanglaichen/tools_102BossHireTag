import json
import os
import threading
from pathlib import Path
from typing import Any

try:
    import redis
except ImportError:  # pragma: no cover - allows local syntax checks before dependencies are installed.
    redis = None


class StorageUnavailable(RuntimeError):
    pass


class JsonStorage:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = threading.RLock()

    def read(self) -> dict[str, Any]:
        with self._lock:
            if not self.path.exists():
                return self._default_data()

            with self.path.open("r", encoding="utf-8") as file:
                data = json.load(file)

            if not isinstance(data, dict):
                return self._default_data()
            data.setdefault("companies", [])
            data.setdefault("meta", {})
            data.setdefault("settings", {})
            return data

    def write(self, data: dict[str, Any]) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = self.path.with_suffix(f"{self.path.suffix}.tmp")
            with tmp_path.open("w", encoding="utf-8") as file:
                json.dump(data, file, ensure_ascii=False, indent=2)
                file.write("\n")
            os.replace(tmp_path, self.path)

    @staticmethod
    def _default_data() -> dict[str, Any]:
        return {"companies": [], "meta": {}, "settings": {}}


class RedisStorage:
    def __init__(self, url: str, key_prefix: str, timeout_seconds: float = 5) -> None:
        if redis is None:
            raise StorageUnavailable("redis 依赖未安装，请先执行 pip install -r requirements.txt")
        self.url = url
        self.key_prefix = key_prefix.rstrip(":")
        self._timeout = timeout_seconds
        self._client: redis.Redis | None = None

    @property
    def client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.Redis.from_url(
                self.url,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=self._timeout,
            )
        return self._client

    @property
    def _companies_key(self) -> str:
        return f"{self.key_prefix}:companies"

    @property
    def _meta_key(self) -> str:
        return f"{self.key_prefix}:meta"

    @property
    def _next_id_key(self) -> str:
        return f"{self.key_prefix}:next_id"

    @property
    def _timestamps_key(self) -> str:
        return f"{self.key_prefix}:timestamps"

    def _next_id(self) -> int:
        return self.client.incr(self._next_id_key)

    def _update_timestamps_index(self, companies: list[dict], pipeline: Any = None) -> None:
        """Update the sorted set index with company creation timestamps."""
        timestamp_members = []  # [(score, member), ...]
        for company in companies:
            company_id = str(company.get("id", ""))
            created_at = company.get("created_at")
            if company_id and created_at:
                try:
                    # Try parsing as Unix timestamp integer first
                    ts = int(created_at)
                    timestamp_members.append((float(ts), company_id))
                except (ValueError, TypeError):
                    # Fallback: try parsing ISO string datetime
                    try:
                        from datetime import datetime, timezone
                        dt = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
                        ts = int(dt.timestamp())
                        timestamp_members.append((float(ts), company_id))
                    except Exception:
                        pass

        if pipeline is None:
            p = self.client.pipeline()
        else:
            p = pipeline

        p.delete(self._timestamps_key)
        if timestamp_members:
            for score, member in timestamp_members:
                p.zadd(self._timestamps_key, {member: score})

        if pipeline is None:
            p.execute()

    def get_companies_by_time_filter(self, time_filter: str) -> list[str]:
        """Get company IDs by time filter. time_filter: all/today/yesterday/before_yesterday"""
        import time
        now = int(time.time())
        today_start = now - (now % 86400)

        if time_filter == "all":
            return [k.decode() if isinstance(k, bytes) else k for k in self.client.zrange(self._timestamps_key, 0, -1)]
        if time_filter == "today":
            return [k.decode() if isinstance(k, bytes) else k for k in self.client.zrangebyscore(self._timestamps_key, today_start, "+inf")]
        if time_filter == "yesterday":
            yesterday_start = today_start - 86400
            yesterday_end = today_start - 1
            return [k.decode() if isinstance(k, bytes) else k for k in self.client.zrangebyscore(self._timestamps_key, yesterday_start, yesterday_end)]
        if time_filter == "before_yesterday":
            before_yesterday_end = today_start - 1
            return [k.decode() if isinstance(k, bytes) else k for k in self.client.zrangebyscore(self._timestamps_key, 0, before_yesterday_end)]
        return []

    def rebuild_timestamps_index(self) -> int:
        """Rebuild the timestamps index from existing company hash data. Returns count."""
        # Use the same data reading logic as read() to get all companies
        legacy_state = self._read_legacy_state()
        companies = self._read_company_hash()
        if not companies:
            companies = legacy_state.get("companies", [])
        self._update_timestamps_index(companies)
        return len(companies)

    def read(self) -> dict[str, Any]:
        legacy_state = self._read_legacy_state()
        companies = self._read_company_hash()
        if not companies:
            companies = legacy_state.get("companies", [])

        meta_raw = self.client.hgetall(self._meta_key)
        meta = dict(meta_raw) if meta_raw else legacy_state.get("meta", {})

        return {
            "companies": sorted(companies, key=lambda x: x.get("updated_at") or "", reverse=True),
            "meta": meta,
            "settings": legacy_state.get("settings", {}),
        }

    def write(self, data: dict[str, Any]) -> None:
        companies = data.get("companies", [])
        company_mapping = {
            str(company["id"]): json.dumps(company, ensure_ascii=False)
            for company in companies
            if company.get("id")
        }

        company_key_type = self._key_type(self._companies_key)
        existing_fields = set(self.client.hkeys(self._companies_key)) if company_key_type == "hash" else set()
        stale_fields = existing_fields - set(company_mapping)

        pipeline = self.client.pipeline()
        if company_key_type not in {"none", "hash"}:
            pipeline.delete(self._companies_key)
        elif stale_fields:
            pipeline.hdel(self._companies_key, *stale_fields)

        if company_mapping:
            pipeline.hset(self._companies_key, mapping=company_mapping)
        else:
            pipeline.delete(self._companies_key)

        meta = data.get("meta", {})
        pipeline.delete(self._meta_key)
        if meta:
            pipeline.hset(self._meta_key, mapping={key: str(value) for key, value in meta.items()})

        # Update timestamps sorted set
        self._update_timestamps_index(companies, pipeline)

        legacy_keys = [key for key in self.client.scan_iter(f"{self.key_prefix}:companies:*")]
        legacy_state_key = f"{self.key_prefix}/companies"
        if legacy_state_key != self._companies_key and self._key_type(legacy_state_key) != "none":
            legacy_keys.append(legacy_state_key)
        if legacy_keys:
            pipeline.delete(*legacy_keys)

        pipeline.execute()

    def _read_company_hash(self) -> list[dict[str, Any]]:
        if self._key_type(self._companies_key) != "hash":
            return []

        companies: list[dict[str, Any]] = []
        for raw in self.client.hgetall(self._companies_key).values():
            try:
                item = json.loads(raw)
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(item, dict):
                companies.append(item)
        return companies

    def _read_legacy_state(self) -> dict[str, Any]:
        for key in (self._companies_key, f"{self.key_prefix}/companies"):
            if self._key_type(key) != "string":
                continue
            try:
                raw_data = self.client.get(key)
                if not raw_data:
                    continue
                data = json.loads(raw_data)
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(data, dict):
                data.setdefault("companies", [])
                data.setdefault("meta", {})
                data.setdefault("settings", {})
                return data

        companies = []
        for key in self.client.scan_iter(f"{self.key_prefix}:companies:*"):
            try:
                raw_data = self.client.get(key)
                if not raw_data:
                    continue
                item = json.loads(raw_data)
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(item, dict):
                companies.append(item)

        return {
            "companies": companies,
            "meta": {},
            "settings": {},
        }

    def _key_type(self, key: str) -> str:
        key_type = self.client.type(key)
        if isinstance(key_type, bytes):
            return key_type.decode("utf-8")
        return str(key_type)

    @staticmethod
    def _default_data() -> dict[str, Any]:
        return {"companies": [], "meta": {}, "settings": {}}


class FallbackStorage:
    def __init__(self, primary: RedisStorage, fallback: JsonStorage) -> None:
        self.primary = primary
        self.fallback = fallback
        self._use_fallback = False
        self._tested = False

    def _test_primary(self) -> bool:
        if self._tested:
            return not self._use_fallback
        self._tested = True
        try:
            self.primary.client.ping()
            self._use_fallback = False
            return True
        except Exception:
            self._use_fallback = True
            return False

    def read(self) -> dict[str, Any]:
        if self._test_primary():
            return self.primary.read()
        return self.fallback.read()

    def write(self, data: dict[str, Any]) -> None:
        if self._use_fallback:
            self.fallback.write(data)
            return
        try:
            self.primary.write(data)
            self._use_fallback = False
        except Exception:
            self.fallback.write(data)
            self._use_fallback = True

    @property
    def using_fallback(self) -> bool:
        return self._use_fallback


class QuickFallbackStorage:
    def __init__(self, primary: RedisStorage, fallback: JsonStorage) -> None:
        self.primary = primary
        self.fallback = fallback
        self._use_fallback = False

    def read(self) -> dict[str, Any]:
        try:
            data = self.primary.read()
            self._use_fallback = False
            return data
        except Exception:
            self._use_fallback = True
            return self.fallback.read()

    def write(self, data: dict[str, Any]) -> None:
        try:
            self.primary.write(data)
            self._use_fallback = False
        except Exception:
            self._use_fallback = True
            self.fallback.write(data)

    @property
    def using_fallback(self) -> bool:
        return self._use_fallback


def create_storage(config: dict[str, Any]) -> JsonStorage | RedisStorage | FallbackStorage:
    backend = config.get("STORAGE_BACKEND", "auto").strip().lower()
    if backend == "json":
        return JsonStorage(config["STORAGE_FILE"])

    redis_url = config.get("REDIS_URL", "").strip()
    json_path = config.get("STORAGE_FILE", "")

    if redis_url:
        redis_storage = RedisStorage(
            redis_url,
            config.get("REDIS_KEY_PREFIX", "jjob/tools102-boss-hire-tag/state"),
            float(config.get("REDIS_TIMEOUT_SECONDS", 5)),
        )
        if json_path:
            json_storage = JsonStorage(json_path)
            return QuickFallbackStorage(redis_storage, json_storage)
        return redis_storage

    if backend == "redis" and not redis_url:
        raise StorageUnavailable("STORAGE_BACKEND=redis 时必须配置 REDIS_URL")
    return JsonStorage(json_path or "data/companies.json")


class RedisProxyStore:
    def __init__(self, redis_url: str, proxy_key: str, timeout_seconds: float = 5) -> None:
        if redis is None:
            raise StorageUnavailable("redis 依赖未安装")
        self._client: redis.Redis | None = None
        self._url = redis_url
        self._key = proxy_key
        self._timeout = timeout_seconds

    @property
    def client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.Redis.from_url(
                self._url,
                decode_responses=True,
                socket_connect_timeout=self._timeout,
                socket_timeout=self._timeout,
            )
        return self._client

    def get_proxy(self) -> str:
        try:
            value = self.client.get(self._key)
            return value or ""
        except Exception:
            return ""

    def set_proxy(self, proxy_url: str) -> None:
        try:
            if proxy_url:
                self.client.set(self._key, proxy_url)
            else:
                self.client.delete(self._key)
        except Exception:
            pass


class RedisSettingsStore:
    def __init__(self, redis_url: str, settings_key: str, timeout_seconds: float = 5) -> None:
        if redis is None:
            raise StorageUnavailable("redis 依赖未安装")
        self._client: redis.Redis | None = None
        self._url = redis_url
        self._key = settings_key
        self._timeout = timeout_seconds
        self._cache: dict | None = None

    @property
    def client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.Redis.from_url(
                self._url,
                decode_responses=True,
                socket_connect_timeout=self._timeout,
                socket_timeout=self._timeout,
            )
        return self._client

    def get_settings(self) -> dict:
        if self._cache is not None:
            return self._cache
        try:
            raw = self.client.get(self._key)
            if raw:
                self._cache = json.loads(raw)
            else:
                self._cache = {"status_options": ["拒绝", "加微信", "在考虑"], "industry_options": ["棋牌", "游戏", "互联网"]}
        except Exception:
            self._cache = {"status_options": ["拒绝", "加微信", "在考虑"], "industry_options": ["棋牌", "游戏", "互联网"]}
        return self._cache

    def save_settings(self, settings: dict) -> dict:
        self._cache = settings
        try:
            self.client.set(self._key, json.dumps(settings, ensure_ascii=False))
        except Exception:
            pass
        return settings

    def clear_cache(self) -> None:
        self._cache = None
