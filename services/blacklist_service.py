import json
import uuid
from datetime import datetime, timezone
from typing import Any

from services.channel_service import normalize_channel_id
from services.storage import JsonStorage, RedisStorage


FIELD_LIMITS = {
    "company_name": 120,
    "reason": 500,
}

DEFAULT_CHANNEL = "boss"
BACKUP_TYPE = "tools102-boss-hire-tag-blacklist-backup"
BACKUP_SCHEMA_VERSION = 1


class BlacklistService:
    """按账号隔离的企业黑名单。"""

    def __init__(self, storage: JsonStorage | RedisStorage) -> None:
        self.storage = storage

    def list_items(self, keyword: str = "", channel: str | None = None) -> list[dict[str, Any]]:
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
                or text in str(item.get("reason") or "").casefold()
            ]
        return sorted(items, key=lambda x: str(x.get("updated_at") or ""), reverse=True)

    def create_item(self, payload: dict[str, Any]) -> dict[str, Any]:
        company_name = self._clean_text(payload.get("company_name"), FIELD_LIMITS["company_name"])
        if not company_name:
            raise ValueError("企业名称不能为空")
        channel = self._normalize_channel(payload.get("channel"))
        data = self._read_state()
        if self._find_by_name(data["items"], company_name, channel=channel):
            raise ValueError("当前渠道下该企业已在黑名单中")
        now = self._now()
        record = {
            "id": str(uuid.uuid4()),
            "company_name": company_name,
            "channel": channel,
            "reason": self._clean_text(payload.get("reason"), FIELD_LIMITS["reason"]),
            "created_at": now,
            "updated_at": now,
        }
        data["items"].append(record)
        data["meta"]["last_changed_at"] = now
        self._save_item(data, record)
        return record

    def update_item(self, item_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        data = self._read_state()
        record = self._find_by_id(data["items"], item_id)
        if not record:
            raise ValueError("记录不存在")
        channel = self._normalize_channel(payload.get("channel") if "channel" in payload else record.get("channel"))
        if "company_name" in payload:
            company_name = self._clean_text(payload.get("company_name"), FIELD_LIMITS["company_name"])
            if not company_name:
                raise ValueError("企业名称不能为空")
            existing = self._find_by_name(data["items"], company_name, channel=channel)
            if existing and existing.get("id") != item_id:
                raise ValueError("当前渠道下该企业已在黑名单中")
            record["company_name"] = company_name
        if "reason" in payload:
            record["reason"] = self._clean_text(payload.get("reason"), FIELD_LIMITS["reason"])
        if "channel" in payload:
            record["channel"] = channel
        record["updated_at"] = self._now()
        data["meta"]["last_changed_at"] = record["updated_at"]
        self._save_item(data, record)
        return record

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

    def get_summary(self, channel: str | None = None) -> dict[str, Any]:
        items = self.list_items(channel=channel)
        return {
            "blacklist_count": len(items),
            "channel": self._normalize_channel(channel) if channel else "",
            "last_updated_at": (self._read_state().get("meta") or {}).get("last_changed_at") or "",
        }

    def export_backup(self, *, account: dict[str, Any] | None = None) -> dict[str, Any]:
        items = self.list_items()
        payload = {
            "type": BACKUP_TYPE,
            "schema_version": BACKUP_SCHEMA_VERSION,
            "exported_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "items": items,
            "account": account or {},
        }
        username = str((account or {}).get("username") or "account")
        safe = "".join(ch for ch in username if ch.isalnum() or ch in "._-") or "account"
        return {
            "payload": payload,
            "filename": f"{safe}-blacklist-backup.json",
        }

    def export_csv(self) -> str:
        import csv
        import io

        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["企业名称", "拉黑原因", "渠道", "创建时间", "更新时间"])
        for item in self.list_items():
            writer.writerow(
                [
                    item.get("company_name") or "",
                    item.get("reason") or "",
                    self._item_channel(item),
                    item.get("created_at") or "",
                    item.get("updated_at") or "",
                ]
            )
        return buf.getvalue()

    def import_backup(self, text: str, *, overwrite: bool = False) -> dict[str, Any]:
        if not str(text or "").strip():
            raise ValueError("导入内容不能为空")
        try:
            payload = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError("黑名单备份必须是 JSON") from exc

        if isinstance(payload, dict) and payload.get("type") and payload.get("type") != BACKUP_TYPE:
            raise ValueError("不是有效的黑名单备份文件")

        if isinstance(payload, list):
            raw_items = payload
        elif isinstance(payload, dict):
            raw_items = payload.get("items") or payload.get("companies") or []
        else:
            raise ValueError("黑名单备份格式无效")

        if not isinstance(raw_items, list):
            raise ValueError("黑名单备份缺少 items")

        normalized: list[dict[str, Any]] = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            name = self._clean_text(item.get("company_name"), FIELD_LIMITS["company_name"])
            if not name:
                continue
            now = self._now()
            normalized.append(
                {
                    "id": str(item.get("id") or uuid.uuid4()),
                    "company_name": name,
                    "channel": self._normalize_channel(item.get("channel")),
                    "reason": self._clean_text(item.get("reason"), FIELD_LIMITS["reason"]),
                    "created_at": str(item.get("created_at") or now),
                    "updated_at": str(item.get("updated_at") or now),
                }
            )

        data = self._read_state()
        if overwrite:
            base_ids = [str(item.get("id")) for item in data["items"] if item.get("id")]
            data["items"] = normalized
            data["meta"]["last_changed_at"] = self._now()
            self.storage.write(self._to_storage_shape(data), replace=True, base_ids=base_ids)
            return {
                "imported_count": len(normalized),
                "updated_count": 0,
                "skipped_count": 0,
                "items": self.list_items(),
                "summary": self.get_summary(),
            }

        imported_count = 0
        updated_count = 0
        skipped_count = 0
        now = self._now()
        for item in normalized:
            existing = self._find_by_name(data["items"], item["company_name"], channel=item["channel"])
            if existing:
                existing["reason"] = item["reason"]
                existing["channel"] = item["channel"]
                existing["updated_at"] = now
                updated_count += 1
                self._save_item(data, existing)
            else:
                record = dict(item)
                record["id"] = str(uuid.uuid4())
                record["created_at"] = now
                record["updated_at"] = now
                data["items"].append(record)
                imported_count += 1
                self._save_item(data, record)
        if not normalized:
            skipped_count = 1
        data["meta"]["last_changed_at"] = now
        return {
            "imported_count": imported_count,
            "updated_count": updated_count,
            "skipped_count": skipped_count,
            "items": self.list_items(),
            "summary": self.get_summary(),
        }

    def _save_item(self, data: dict[str, Any], record: dict[str, Any]) -> None:
        if hasattr(self.storage, "upsert_company"):
            self.storage.upsert_company(record, {"last_changed_at": data["meta"].get("last_changed_at") or self._now()})
            return
        self.storage.write(self._to_storage_shape(data))

    def _read_state(self) -> dict[str, Any]:
        raw = self.storage.read()
        companies = list(raw.get("companies") or [])
        # 兼容存储层固定的 companies 字段，业务上叫 items
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

    @classmethod
    def _find_by_name(
        cls, items: list[dict[str, Any]], company_name: str, channel: str | None = None
    ) -> dict[str, Any] | None:
        key = company_name.casefold()
        channel_id = cls._normalize_channel(channel) if channel is not None else None
        for item in items:
            if str(item.get("company_name") or "").casefold() != key:
                continue
            if channel_id is not None and cls._item_channel(item) != channel_id:
                continue
            return item
        return None

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

    @staticmethod
    def _now() -> str:
        return str(int(datetime.now(timezone.utc).timestamp()))
