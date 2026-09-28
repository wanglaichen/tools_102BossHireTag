"""招聘平台采集的「更新企业」岗位条目；按渠道隔离，企业名+岗位名哈希唯一。"""
from __future__ import annotations

import hashlib
from datetime import date, datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from services.channel_service import normalize_channel_id
from services.storage import JsonStorage, RedisStorage

FIELD_LIMITS = {
    "company_name": 160,
    "job_title": 160,
    "location": 200,
    "job_summary": 2000,
}

DEFAULT_CHANNEL = "boss"
LOCAL_TZ = ZoneInfo("Asia/Shanghai")


class JobUpdateService:
    """采集入库：同一渠道下「企业名称 + 岗位名称」唯一（SHA256 作 id，upsert 互斥）。"""

    def __init__(self, storage: JsonStorage | RedisStorage) -> None:
        self.storage = storage

    @classmethod
    def make_unique_id(cls, channel: str, company_name: str, job_title: str) -> str:
        channel_id = cls._normalize_channel(channel)
        company = cls._clean_text(company_name, FIELD_LIMITS["company_name"]).casefold()
        title = cls._clean_text(job_title, FIELD_LIMITS["job_title"]).casefold()
        raw = f"{channel_id}\n{company}\n{title}".encode("utf-8")
        return hashlib.sha256(raw).hexdigest()[:32]

    def list_items(
        self,
        *,
        channel: str | None = None,
        keyword: str = "",
        time_filter: str = "all",
        date_value: str = "",
        from_ts: int | None = None,
        to_ts: int | None = None,
    ) -> list[dict[str, Any]]:
        items = list(self._read_state().get("items") or [])
        channel_id = self._normalize_channel(channel) if channel else None
        if channel_id:
            items = [item for item in items if self._item_channel(item) == channel_id]
        text = (keyword or "").strip().casefold()
        if text:
            items = [
                item
                for item in items
                if text in str(item.get("company_name") or "").casefold()
                or text in str(item.get("job_title") or "").casefold()
                or text in str(item.get("location") or "").casefold()
                or text in str(item.get("job_summary") or "").casefold()
            ]
        items = self._filter_by_updated_time(
            items,
            time_filter=time_filter,
            date_value=date_value,
            from_ts=from_ts,
            to_ts=to_ts,
        )
        return sorted(items, key=lambda x: str(x.get("updated_at") or ""), reverse=True)

    def get_summary(
        self,
        channel: str | None = None,
        *,
        keyword: str = "",
        time_filter: str = "all",
        date_value: str = "",
        from_ts: int | None = None,
        to_ts: int | None = None,
    ) -> dict[str, Any]:
        items = self.list_items(
            channel=channel,
            keyword=keyword,
            time_filter=time_filter,
            date_value=date_value,
            from_ts=from_ts,
            to_ts=to_ts,
        )
        return {
            "job_update_count": len(items),
            "channel": self._normalize_channel(channel) if channel else "",
            "time_filter": (time_filter or "all"),
            "date": (date_value or "").strip(),
            "from_ts": from_ts or 0,
            "to_ts": to_ts or 0,
            "last_updated_at": (self._read_state().get("meta") or {}).get("last_changed_at") or "",
        }

    def _filter_by_updated_time(
        self,
        items: list[dict[str, Any]],
        *,
        time_filter: str = "all",
        date_value: str = "",
        from_ts: int | None = None,
        to_ts: int | None = None,
    ) -> list[dict[str, Any]]:
        if from_ts is not None or to_ts is not None:
            start = int(from_ts) if from_ts is not None else 0
            end = int(to_ts) if to_ts is not None else 2**31 - 1
            if end < start:
                start, end = end, start
            return [item for item in items if self._in_range(item.get("updated_at"), start, end)]

        date_text = (date_value or "").strip()
        filter_key = (time_filter or "all").strip().lower()
        if date_text:
            day = self._parse_date(date_text)
            if day is None:
                return items
            start_ts, end_ts = self._day_bounds(day)
            return [item for item in items if self._in_range(item.get("updated_at"), start_ts, end_ts)]

        if filter_key in {"", "all"}:
            return items

        today = datetime.now(LOCAL_TZ).date()
        if filter_key == "today":
            start_ts, end_ts = self._day_bounds(today)
        elif filter_key == "yesterday":
            start_ts, end_ts = self._day_bounds(today - timedelta(days=1))
        elif filter_key in {"day_before_yesterday", "before_yesterday", "前天"}:
            start_ts, end_ts = self._day_bounds(today - timedelta(days=2))
        else:
            return items
        return [item for item in items if self._in_range(item.get("updated_at"), start_ts, end_ts)]

    @staticmethod
    def _parse_date(value: str) -> date | None:
        try:
            return date.fromisoformat(value.strip()[:10])
        except ValueError:
            return None

    @staticmethod
    def _day_bounds(day: date) -> tuple[int, int]:
        start = datetime.combine(day, time.min, tzinfo=LOCAL_TZ)
        end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=LOCAL_TZ)
        return int(start.timestamp()), int(end.timestamp()) - 1

    @classmethod
    def _in_range(cls, raw_ts: Any, start_ts: int, end_ts: int) -> bool:
        ts = cls._parse_ts(raw_ts)
        if ts is None:
            return False
        return start_ts <= ts <= end_ts

    @staticmethod
    def _parse_ts(value: Any) -> int | None:
        text = str(value or "").strip()
        if not text:
            return None
        if text.isdigit():
            return int(text)
        try:
            # ISO fallback
            normalized = text.replace("Z", "+00:00")
            return int(datetime.fromisoformat(normalized).timestamp())
        except ValueError:
            return None

    def upsert_item(self, payload: dict[str, Any]) -> dict[str, Any]:
        """单条 upsert：同渠道同企业同岗位则更新，否则新增。返回 {item, created}。"""
        company_name = self._clean_text(payload.get("company_name"), FIELD_LIMITS["company_name"])
        job_title = self._clean_text(payload.get("job_title"), FIELD_LIMITS["job_title"])
        if not company_name:
            raise ValueError("企业名称不能为空")
        if not job_title:
            raise ValueError("岗位名称不能为空")
        channel = self._normalize_channel(payload.get("channel"))
        item_id = self.make_unique_id(channel, company_name, job_title)
        data = self._read_state()
        existing = self._find_by_id(data["items"], item_id)
        now = self._now()
        fields = self._extract_optional_fields(payload)
        if existing:
            existing["company_name"] = company_name
            existing["job_title"] = job_title
            existing["channel"] = channel
            self._merge_optional_fields(existing, payload, fields)
            existing["updated_at"] = now
            data["meta"]["last_changed_at"] = now
            self._save_item(data, existing)
            return {"item": existing, "created": False}
        record = {
            "id": item_id,
            "company_name": company_name,
            "job_title": job_title,
            "channel": channel,
            "created_at": now,
            "updated_at": now,
            **fields,
        }
        data["items"].append(record)
        data["meta"]["last_changed_at"] = now
        self._save_item(data, record)
        return {"item": record, "created": True}

    def upsert_batch(self, items: list[Any], *, channel: str | None = None) -> dict[str, Any]:
        if not isinstance(items, list):
            raise ValueError("items 必须是数组")
        default_channel = self._normalize_channel(channel) if channel else None
        created_count = 0
        updated_count = 0
        skipped_count = 0
        touched: list[dict[str, Any]] = []
        for raw in items:
            if not isinstance(raw, dict):
                skipped_count += 1
                continue
            payload = dict(raw)
            if default_channel and not payload.get("channel"):
                payload["channel"] = default_channel
            try:
                result = self.upsert_item(payload)
            except ValueError:
                skipped_count += 1
                continue
            touched.append(result["item"])
            if result["created"]:
                created_count += 1
            else:
                updated_count += 1
        channel_id = default_channel
        return {
            "created_count": created_count,
            "updated_count": updated_count,
            "skipped_count": skipped_count,
            "items": self.list_items(channel=channel_id) if channel_id else self.list_items(),
            "summary": self.get_summary(channel=channel_id),
            "touched": touched,
        }

    def delete_item(self, item_id: str) -> dict[str, Any]:
        data = self._read_state()
        before = len(data["items"])
        data["items"] = [item for item in data["items"] if item.get("id") != item_id]
        if len(data["items"]) == before:
            raise ValueError("记录不存在")
        data["meta"]["last_changed_at"] = self._now()
        if hasattr(self.storage, "delete_company_record"):
            self.storage.delete_company_record(item_id, {"last_changed_at": data["meta"]["last_changed_at"]})
        else:
            self.storage.write(self._to_storage_shape(data))
        return {"deleted": True, "id": item_id}

    def clear_items(self, channel: str | None = None) -> dict[str, Any]:
        channel_id = self._normalize_channel(channel) if channel else None
        data = self._read_state()
        items = list(data.get("items") or [])
        if channel_id:
            kept = [item for item in items if self._item_channel(item) != channel_id]
            removed = [item for item in items if self._item_channel(item) == channel_id]
        else:
            kept = []
            removed = items
        base_ids = [str(item.get("id")) for item in items if item.get("id")]
        now = self._now()
        data["items"] = kept
        data["meta"]["last_changed_at"] = now
        if channel_id:
            data["meta"]["cleared_channel"] = channel_id
        self.storage.write(self._to_storage_shape(data), replace=True, base_ids=base_ids)
        return {
            "cleared_count": len(removed),
            "channel": channel_id or "",
            "items": self.list_items(channel=channel_id),
            "summary": self.get_summary(channel=channel_id),
        }

    def _save_item(self, data: dict[str, Any], record: dict[str, Any]) -> None:
        if hasattr(self.storage, "upsert_company"):
            self.storage.upsert_company(record, {"last_changed_at": data["meta"].get("last_changed_at") or self._now()})
            return
        self.storage.write(self._to_storage_shape(data))

    def _read_state(self) -> dict[str, Any]:
        raw = self.storage.read()
        companies = list(raw.get("companies") or [])
        items = list(raw.get("items") or companies)
        meta = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}
        return {"items": items, "meta": meta}

    @staticmethod
    def _to_storage_shape(data: dict[str, Any]) -> dict[str, Any]:
        return {
            "companies": list(data.get("items") or []),
            "meta": data.get("meta") or {},
            "settings": {},
        }

    @staticmethod
    def _find_by_id(items: list[dict[str, Any]], item_id: str) -> dict[str, Any] | None:
        return next((item for item in items if item.get("id") == item_id), None)

    @staticmethod
    def _normalize_channel(value: Any) -> str:
        return normalize_channel_id(str(value or "")) or DEFAULT_CHANNEL

    @classmethod
    def _item_channel(cls, item: dict[str, Any] | None) -> str:
        if not item:
            return DEFAULT_CHANNEL
        return cls._normalize_channel(item.get("channel"))

    @staticmethod
    def _clean_text(value: Any, limit: int) -> str:
        text = str(value or "").strip()
        return text[:limit]

    @classmethod
    def _extract_optional_fields(cls, payload: dict[str, Any]) -> dict[str, Any]:
        salary_min = cls._parse_salary(payload.get("salary_min"))
        salary_max = cls._parse_salary(payload.get("salary_max"))
        if salary_min is not None and salary_max is not None and salary_min > salary_max:
            salary_min, salary_max = salary_max, salary_min
        return {
            "location": cls._clean_text(payload.get("location"), FIELD_LIMITS["location"]),
            "job_summary": cls._clean_text(payload.get("job_summary"), FIELD_LIMITS["job_summary"]),
            "salary_min": salary_min,
            "salary_max": salary_max,
        }

    @staticmethod
    def _merge_optional_fields(record: dict[str, Any], payload: dict[str, Any], fields: dict[str, Any]) -> None:
        for key in ("location", "job_summary", "salary_min", "salary_max"):
            if key in payload:
                record[key] = fields.get(key)

    @staticmethod
    def _parse_salary(value: Any) -> int | None:
        """解析薪资数字（单位建议 K，如 15 表示 15K）。空值返回 None。"""
        if value is None:
            return None
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            if value < 0:
                raise ValueError("薪资不能为负数")
            return int(value)
        text = str(value).strip()
        if not text:
            return None
        text = text.replace(",", "").replace("，", "").replace(" ", "")
        # 允许 15k / 15K / 15千
        lowered = text.casefold()
        for suffix in ("k", "千"):
            if lowered.endswith(suffix):
                text = text[: -len(suffix)]
                break
        try:
            num = float(text)
        except ValueError as exc:
            raise ValueError(f"薪资格式无效：{value}") from exc
        if num < 0:
            raise ValueError("薪资不能为负数")
        return int(num)

    @staticmethod
    def _now() -> str:
        return str(int(datetime.now(timezone.utc).timestamp()))
