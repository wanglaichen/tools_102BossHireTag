"""全局招聘渠道（投递登记子页签）配置。"""

from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any

try:
    import redis
except ImportError:  # pragma: no cover
    redis = None


DEFAULT_CHANNELS: list[dict[str, Any]] = [
    {"id": "boss", "name": "boss", "sort": 0},
    {"id": "51job", "name": "51job", "sort": 1},
    {"id": "zhilian", "name": "智联", "sort": 2},
    {"id": "liepin", "name": "列聘", "sort": 3},
    {"id": "yupao", "name": "鱼泡", "sort": 4},
    {"id": "linkedin", "name": "领英", "sort": 5},
]


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_channel_id(value: str) -> str:
    text = str(value or "").strip().lower()
    text = re.sub(r"\s+", "-", text)
    text = re.sub(r"[^a-z0-9_\u4e00-\u9fff-]+", "", text)
    return text[:48]


class ChannelService:
    def __init__(self, redis_url: str, channels_key: str, timeout_seconds: float = 15) -> None:
        if redis is None:
            raise RuntimeError("redis 依赖未安装")
        self._url = redis_url
        self._key = channels_key
        self._timeout = timeout_seconds
        self._client: Any = None
        self._cache: list[dict[str, Any]] | None = None

    @property
    def client(self):
        if self._client is None:
            self._client = redis.Redis.from_url(
                self._url,
                decode_responses=True,
                socket_connect_timeout=self._timeout,
                socket_timeout=self._timeout,
            )
        return self._client

    def list_channels(self) -> list[dict[str, Any]]:
        items = self._load()
        return sorted(items, key=lambda item: (int(item.get("sort") or 0), item.get("name") or ""))

    def get_channel(self, channel_id: str) -> dict[str, Any] | None:
        cid = normalize_channel_id(channel_id)
        for item in self._load():
            if item.get("id") == cid:
                return item
        return None

    def create_channel(self, *, name: str, channel_id: str | None = None) -> dict[str, Any]:
        display = str(name or "").strip()
        if not display:
            raise ValueError("渠道名称不能为空")
        if len(display) > 40:
            raise ValueError("渠道名称过长")

        cid = normalize_channel_id(channel_id or display)
        if not cid:
            cid = f"ch-{uuid.uuid4().hex[:8]}"

        items = self._load()
        if any(item.get("id") == cid for item in items):
            raise ValueError(f"渠道「{cid}」已存在")

        record = {
            "id": cid,
            "name": display,
            "sort": (max((int(item.get("sort") or 0) for item in items), default=-1) + 1),
            "created_at": _now(),
            "updated_at": _now(),
        }
        items.append(record)
        self._save(items)
        return record

    def delete_channel(self, channel_id: str) -> dict[str, Any]:
        """仅从页签配置中移除，永不删除各账号下的公司残留数据。"""
        cid = normalize_channel_id(channel_id)
        items = self._load()
        keep = [item for item in items if item.get("id") != cid]
        if len(keep) == len(items):
            raise ValueError("渠道不存在")
        if not keep:
            raise ValueError("至少保留一个招聘渠道")
        self._save(keep)
        return {"id": cid, "removed": True, "message": "渠道页签已移除，各账号残留公司数据已保留"}

    def ensure_defaults(self) -> list[dict[str, Any]]:
        items = self._load()
        if items:
            return self.list_channels()
        seeded = []
        now = _now()
        for item in DEFAULT_CHANNELS:
            seeded.append(
                {
                    "id": item["id"],
                    "name": item["name"],
                    "sort": item["sort"],
                    "created_at": now,
                    "updated_at": now,
                }
            )
        self._save(seeded)
        return self.list_channels()

    def _load(self) -> list[dict[str, Any]]:
        if self._cache is not None:
            return [dict(item) for item in self._cache]
        try:
            raw = self.client.get(self._key)
            if raw:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    self._cache = [self._normalize_item(item) for item in parsed if isinstance(item, dict)]
                else:
                    self._cache = []
            else:
                self._cache = []
        except Exception:
            self._cache = []
        return [dict(item) for item in self._cache]

    def _save(self, items: list[dict[str, Any]]) -> None:
        normalized = [self._normalize_item(item) for item in items]
        self._cache = normalized
        try:
            self.client.set(self._key, json.dumps(normalized, ensure_ascii=False))
        except Exception:
            pass

    @staticmethod
    def _normalize_item(item: dict[str, Any]) -> dict[str, Any]:
        cid = normalize_channel_id(item.get("id") or item.get("key") or "")
        name = str(item.get("name") or cid or "").strip() or cid
        return {
            "id": cid or f"ch-{uuid.uuid4().hex[:8]}",
            "name": name[:40],
            "sort": int(item.get("sort") or 0),
            "created_at": str(item.get("created_at") or ""),
            "updated_at": str(item.get("updated_at") or ""),
        }
