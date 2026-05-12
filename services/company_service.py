import csv
import io
import uuid
from datetime import datetime, timezone
from typing import Any

from services.storage import JsonStorage, RedisStorage, create_storage


FIELD_LIMITS = {
    "company_name": 120,
    "effect_status": 160,
    "industry": 80,
    "note": 500,
}

DEFAULT_SETTINGS = {
    "status_options": ["拒绝", "加微信", "在考虑"],
    "industry_options": ["棋牌", "游戏", "互联网"],
}

HEADER_ALIASES = {
    "企业名称": "company_name",
    "公司名称": "company_name",
    "效果状态": "effect_status",
    "行业": "industry",
    "是否是猎头": "is_hunter",
    "是否是外包": "is_outsourced",
    "是否已面试": "is_interviewed",
    "备注": "note",
    "company_name": "company_name",
    "effect_status": "effect_status",
    "industry": "industry",
    "is_hunter": "is_hunter",
    "is_outsourced": "is_outsourced",
    "is_interviewed": "is_interviewed",
    "note": "note",
}


class CompanyService:
    def __init__(self, storage: JsonStorage | RedisStorage, settings_store: Any | None = None) -> None:
        self.storage = storage
        self.settings_store = settings_store

    @classmethod
    def from_app_config(cls, config: dict[str, Any]) -> "CompanyService":
        return cls(create_storage(config))

    def list_companies(self) -> list[dict[str, Any]]:
        items = self._read_state()["companies"]
        return sorted(items, key=lambda item: item.get("updated_at") or "", reverse=True)

    def get_settings(self) -> dict[str, Any]:
        if self.settings_store is not None:
            return self._normalize_settings(self.settings_store.get_settings())

        data = self._read_state()
        settings = self._normalize_settings(data.get("settings", {}))
        if data.get("settings") != settings:
            data["settings"] = settings
            data["meta"]["last_changed_at"] = self._now()
            self.storage.write(data)
        return settings

    def update_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self.settings_store is not None:
            current = self.get_settings()
            next_settings = {
                "status_options": self._normalize_options(payload.get("status_options"), current["status_options"]),
                "industry_options": self._normalize_options(payload.get("industry_options"), current["industry_options"]),
            }
            self.settings_store.save_settings(next_settings)
            return next_settings

        data = self._read_state()
        current = self._normalize_settings(data.get("settings", {}))
        next_settings = {
            "status_options": self._normalize_options(payload.get("status_options"), current["status_options"]),
            "industry_options": self._normalize_options(payload.get("industry_options"), current["industry_options"]),
        }
        data["settings"] = next_settings
        data["meta"]["last_changed_at"] = self._now()
        self.storage.write(data)
        return next_settings

    def get_summary(self) -> dict[str, Any]:
        items = self.list_companies()
        statuses = set()
        industries = set()
        for item in items:
            for s in (item.get("effect_status") or "").split(","):
                s = s.strip()
                if s:
                    statuses.add(s)
            for i in (item.get("industry") or "").split(","):
                i = i.strip()
                if i:
                    industries.add(i)

        settings = self.get_settings()
        rejected_count = sum(1 for item in items if any("拒绝" in s for s in (item.get("effect_status") or "").split(",")))
        hunter_count = sum(1 for item in items if item.get("is_hunter") == "yes")
        outsourced_count = sum(1 for item in items if item.get("is_outsourced") == "yes")
        interviewed_count = sum(1 for item in items if item.get("is_interviewed") == "yes")
        follow_up_count = sum(
            1
            for item in items
            if item.get("effect_status") and not any("拒绝" in s for s in (item.get("effect_status") or "").split(","))
        )

        return {
            "company_count": len(items),
            "rejected_count": rejected_count,
            "hunter_count": hunter_count,
            "outsourced_count": outsourced_count,
            "interviewed_count": interviewed_count,
            "follow_up_count": follow_up_count,
            "statuses": sorted(set(settings["status_options"]) | statuses),
            "industries": sorted(set(settings["industry_options"]) | industries),
            "settings": settings,
            "last_updated_at": max((item.get("updated_at") or "" for item in items), default=""),
        }

    def create_company(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = self._read_state()
        company_name = self._clean_text(payload.get("company_name"), FIELD_LIMITS["company_name"])
        if not company_name:
            raise ValueError("企业名称不能为空")
        if self._find_by_name(data["companies"], company_name):
            raise ValueError("企业名称已存在，请编辑原记录")

        now = self._now()
        record = self._build_record(payload, company_name=company_name, now=now)
        data["companies"].append(record)
        data["meta"]["last_changed_at"] = now
        self.storage.write(data)
        return record

    def update_company(self, company_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        data = self._read_state()
        record = self._find_by_id(data["companies"], company_id)
        if not record:
            raise ValueError("记录不存在")

        if "company_name" in payload:
            company_name = self._clean_text(payload.get("company_name"), FIELD_LIMITS["company_name"])
            if not company_name:
                raise ValueError("企业名称不能为空")
            duplicate = self._find_by_name(data["companies"], company_name)
            if duplicate and duplicate["id"] != company_id:
                raise ValueError("企业名称已存在，请编辑原记录")
            record["company_name"] = company_name

        for field in ("effect_status", "industry", "note"):
            if field in payload:
                record[field] = self._clean_text(payload.get(field), FIELD_LIMITS[field])

        for field in ("is_hunter", "is_outsourced", "is_interviewed"):
            if field in payload:
                record[field] = self._normalize_flag(payload.get(field))

        now = self._now()
        record["updated_at"] = now
        data["meta"]["last_changed_at"] = now
        self.storage.write(data)
        return record

    def delete_company(self, company_id: str) -> dict[str, Any]:
        data = self._read_state()
        before_count = len(data["companies"])
        data["companies"] = [item for item in data["companies"] if item.get("id") != company_id]
        if len(data["companies"]) == before_count:
            raise ValueError("记录不存在")

        data["meta"]["last_changed_at"] = self._now()
        self.storage.write(data)
        return {"deleted": True, "id": company_id}

    def import_rows(self, text: str) -> dict[str, Any]:
        if not text.strip():
            raise ValueError("导入内容不能为空")

        data = self._read_state()
        rows = self._parse_rows(text)
        imported_count = 0
        updated_count = 0
        skipped_count = 0

        for row in rows:
            normalized = self._normalize_import_row(row)
            if not normalized:
                skipped_count += 1
                continue

            existing = self._find_by_name(data["companies"], normalized["company_name"])
            now = self._now()
            if existing:
                existing.update(normalized)
                existing["updated_at"] = now
                updated_count += 1
            else:
                data["companies"].append(
                    {
                        "id": str(uuid.uuid4()),
                        **normalized,
                        "created_at": now,
                        "updated_at": now,
                    }
                )
                imported_count += 1

        data["meta"]["last_changed_at"] = self._now()
        self.storage.write(data)
        return {
            "imported_count": imported_count,
            "updated_count": updated_count,
            "skipped_count": skipped_count,
            "items": self.list_companies(),
            "summary": self.get_summary(),
        }

    def export_csv(self) -> str:
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(
            ["企业名称", "效果状态", "行业", "是否是猎头", "是否是外包", "是否已面试", "备注", "创建时间", "更新时间"]
        )
        for item in self.list_companies():
            writer.writerow(
                [
                    item.get("company_name", ""),
                    item.get("effect_status", ""),
                    item.get("industry", ""),
                    self._display_flag(item.get("is_hunter")),
                    self._display_flag(item.get("is_outsourced")),
                    self._display_flag(item.get("is_interviewed")),
                    item.get("note", ""),
                    item.get("created_at", ""),
                    item.get("updated_at", ""),
                ]
            )
        return output.getvalue()

    def _read_state(self) -> dict[str, Any]:
        data = self.storage.read()
        data.setdefault("companies", [])
        data.setdefault("meta", {})
        data.setdefault("settings", {})
        return data

    def _build_record(self, payload: dict[str, Any], company_name: str, now: str) -> dict[str, Any]:
        return {
            "id": str(uuid.uuid4()),
            "company_name": company_name,
            "effect_status": self._clean_text(payload.get("effect_status"), FIELD_LIMITS["effect_status"]),
            "industry": self._clean_text(payload.get("industry"), FIELD_LIMITS["industry"]),
            "is_hunter": self._normalize_flag(payload.get("is_hunter")),
            "is_outsourced": self._normalize_flag(payload.get("is_outsourced")),
            "is_interviewed": self._normalize_flag(payload.get("is_interviewed")),
            "note": self._clean_text(payload.get("note"), FIELD_LIMITS["note"]),
            "created_at": now,
            "updated_at": now,
        }

    def _parse_rows(self, text: str) -> list[list[str]]:
        sample = text.strip()
        delimiter = "\t" if "\t" in sample else ","
        reader = csv.reader(io.StringIO(sample), delimiter=delimiter)
        rows = [[cell.strip() for cell in row] for row in reader]
        return [row for row in rows if any(row)]

    def _normalize_import_row(self, row: list[str]) -> dict[str, str] | None:
        if not row:
            return None
        first_cell = row[0].strip()
        if first_cell in {"企业名称", "公司名称", "company_name"}:
            return None

        company_name = self._clean_text(first_cell, FIELD_LIMITS["company_name"])
        if not company_name:
            return None

        effect_status = self._get_row_value(row, 1, None)
        industry = self._get_row_value(row, 2, None)
        is_hunter = self._get_row_value(row, 3, None)
        is_outsourced = self._get_row_value(row, 4, None)
        is_interviewed = self._get_row_value(row, 5, None)
        note = self._get_row_value(row, 6, None)

        if len(row) == 5:
            note = self._get_row_value(row, 4, "")
            is_outsourced = ""
            is_interviewed = ""
        elif len(row) == 6:
            note = self._get_row_value(row, 5, "")
            is_interviewed = ""

        return {
            "company_name": company_name,
            "effect_status": self._clean_text(effect_status, FIELD_LIMITS["effect_status"]),
            "industry": self._clean_text(industry, FIELD_LIMITS["industry"]),
            "is_hunter": self._normalize_flag(is_hunter),
            "is_outsourced": self._normalize_flag(is_outsourced),
            "is_interviewed": self._normalize_flag(is_interviewed),
            "note": self._clean_text(note, FIELD_LIMITS["note"]),
        }

    @staticmethod
    def _get_row_value(row: list[str], index: int, default: str | None = "") -> str:
        if index >= len(row):
            return "" if default is None else default
        return row[index].strip()

    @staticmethod
    def _clean_text(value: Any, max_length: int) -> str:
        if value is None:
            return ""
        return str(value).strip()[:max_length]

    @staticmethod
    def _normalize_flag(value: Any) -> str:
        text = str(value or "").strip().lower()
        if text in {"yes", "y", "true", "1", "是", "有", "已", "已是"}:
            return "yes"
        if text in {"no", "n", "false", "0", "否", "没有", "未", "不是"}:
            return "no"
        return "unknown"

    @staticmethod
    def _display_flag(value: str | None) -> str:
        if value == "yes":
            return "是"
        if value == "no":
            return "否"
        return ""

    @staticmethod
    def _normalize_options(value: Any, fallback: list[str]) -> list[str]:
        if isinstance(value, list):
            items = [str(item).strip() for item in value]
            items = [item for item in items if item]
            if items:
                seen: set[str] = set()
                ordered: list[str] = []
                for item in items:
                    key = item.casefold()
                    if key in seen:
                        continue
                    seen.add(key)
                    ordered.append(item)
                return ordered[:50]
        return list(fallback)

    def _normalize_settings(self, value: Any) -> dict[str, list[str]]:
        if not isinstance(value, dict):
            value = {}
        return {
            "status_options": self._normalize_options(value.get("status_options"), DEFAULT_SETTINGS["status_options"]),
            "industry_options": self._normalize_options(
                value.get("industry_options"), DEFAULT_SETTINGS["industry_options"]
            ),
        }

    @staticmethod
    def _find_by_id(items: list[dict[str, Any]], company_id: str) -> dict[str, Any] | None:
        return next((item for item in items if item.get("id") == company_id), None)

    @staticmethod
    def _find_by_name(items: list[dict[str, Any]], company_name: str) -> dict[str, Any] | None:
        normalized_name = company_name.casefold()
        return next(
            (item for item in items if item.get("company_name", "").casefold() == normalized_name),
            None,
        )

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()
