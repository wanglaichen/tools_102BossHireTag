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
        return {"companies": [], "meta": {}}


class RedisStorage:
    def __init__(self, url: str, key_prefix: str, timeout_seconds: float = 5) -> None:
        if redis is None:
            raise StorageUnavailable("redis 依赖未安装，请先执行 pip install -r requirements.txt")
        self.client = redis.Redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=timeout_seconds,
            socket_timeout=timeout_seconds,
            health_check_interval=30,
        )
        self.key = f"{key_prefix.rstrip('/')}/companies"

    def read(self) -> dict[str, Any]:
        raw_data = self.client.get(self.key)
        if not raw_data:
            return self._default_data()

        data = json.loads(raw_data)
        if not isinstance(data, dict):
            return self._default_data()
        data.setdefault("companies", [])
        data.setdefault("meta", {})
        return data

    def write(self, data: dict[str, Any]) -> None:
        self.client.set(self.key, json.dumps(data, ensure_ascii=False))

    @staticmethod
    def _default_data() -> dict[str, Any]:
        return {"companies": [], "meta": {}}


def create_storage(config: dict[str, Any]) -> JsonStorage | RedisStorage:
    backend = config.get("STORAGE_BACKEND", "auto").strip().lower()
    if backend == "json":
        return JsonStorage(config["STORAGE_FILE"])

    redis_url = config.get("REDIS_URL", "").strip()
    if backend == "redis" and not redis_url:
        raise StorageUnavailable("STORAGE_BACKEND=redis 时必须配置 REDIS_URL")
    if redis_url:
        return RedisStorage(
            redis_url,
            config.get("REDIS_KEY_PREFIX", "jjob/tools102-boss-hire-tag"),
            float(config.get("REDIS_TIMEOUT_SECONDS", 5)),
        )
    return JsonStorage(config["STORAGE_FILE"])
