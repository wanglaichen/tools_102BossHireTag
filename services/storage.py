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
        self.key = f"{key_prefix.rstrip('/')}/companies"
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

    def read(self) -> dict[str, Any]:
        raw_data = self.client.get(self.key)
        if not raw_data:
            return self._default_data()

        data = json.loads(raw_data)
        if not isinstance(data, dict):
            return self._default_data()
        data.setdefault("companies", [])
        data.setdefault("meta", {})
        data.setdefault("settings", {})
        return data

    def write(self, data: dict[str, Any]) -> None:
        self.client.set(self.key, json.dumps(data, ensure_ascii=False))

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
