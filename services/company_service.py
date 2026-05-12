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


class CompanyService:
    def __init__(self, storage: JsonStorage | RedisStorage) -> None:
        self.storage = storage

    @classmethod
    def from_app_config(cls, config: dict[str, Any]) -> "CompanyService":
        return cls(create_storage(config))

    def list_companies(self) -> list[dict[str, Any]]:
        items = self.storage.read()["companies"]
        return sorted(items, key=lambda item: item.get("updated_at") or "", reverse=True)

    def get_summary(self) -> dict[str, Any]:
        items = self.list_companies()
        statuses = sorted({item.get("effect_status", "") for item in items if item.get("effect_status")})
        industries = sorted({item.get("industry", "") for item in items if item.get("industry")})
        rejected_count = sum(1 for item in items if "拒绝" in item.get("effect_status", ""))
        hunter_count = sum(1 for item in items if item.get("is_hunter") == "yes")
        follow_up_count = sum(
            1
            for item in items
            if item.get("effect_status") and "拒绝" not in item.get("effect_status", "")
        )

        return {
            "company_count": len(items),
            "rejected_count": rejected_count,
            "hunter_count": hunter_count,
            "follow_up_count": follow_up_count,
            "statuses": statuses,
            "industries": industries,
            "last_updated_at": max((item.get("updated_at") or "" for item in items), default=""),
        }

    def create_company(self, payload: dict[str, Any]) -> dict[str, Any]:
        data = self.storage.read()
        company_name = self._clean_text(payload.get("company_name"), FIELD_LIMITS["company_name"])
        if not company_name:
            raise ValueError("企业名称不能为空")
        if self._find_by_name(data["companies"], company_name):
            raise ValueError("企业名称已存在，请编辑原记录")

        now = self._now()
        record = {
            "id": str(uuid.uuid4()),
            "company_name": company_name,
            "effect_status": self._clean_text(payload.get("effect_status"), FIELD_LIMITS["effect_status"]),
            "industry": self._clean_text(payload.get("industry"), FIELD_LIMITS["industry"]),
            "is_hunter": self._normalize_hunter(payload.get("is_hunter")),
            "note": self._clean_text(payload.get("note"), FIELD_LIMITS["note"]),
            "created_at": now,
            "updated_at": now,
        }
        data["companies"].append(record)
        data["meta"]["last_changed_at"] = now
        self.storage.write(data)
        return record

    def update_company(self, company_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        data = self.storage.read()
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

        if "is_hunter" in payload:
            record["is_hunter"] = self._normalize_hunter(payload.get("is_hunter"))

        now = self._now()
        record["updated_at"] = now
        data["meta"]["last_changed_at"] = now
        self.storage.write(data)
        return record

    def delete_company(self, company_id: str) -> dict[str, Any]:
        data = self.storage.read()
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

        data = self.storage.read()
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
        writer.writerow(["企业名称", "效果状态", "行业", "是否是猎头", "备注", "创建时间", "更新时间"])
        for item in self.list_companies():
            writer.writerow(
                [
                    item.get("company_name", ""),
                    item.get("effect_status", ""),
                    item.get("industry", ""),
                    self._display_hunter(item.get("is_hunter")),
                    item.get("note", ""),
                    item.get("created_at", ""),
                    item.get("updated_at", ""),
                ]
            )
        return output.getvalue()

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

        return {
            "company_name": company_name,
            "effect_status": self._clean_text(row[1] if len(row) > 1 else "", FIELD_LIMITS["effect_status"]),
            "industry": self._clean_text(row[2] if len(row) > 2 else "", FIELD_LIMITS["industry"]),
            "is_hunter": self._normalize_hunter(row[3] if len(row) > 3 else ""),
            "note": self._clean_text(row[4] if len(row) > 4 else "", FIELD_LIMITS["note"]),
        }

    @staticmethod
    def _clean_text(value: Any, max_length: int) -> str:
        if value is None:
            return ""
        return str(value).strip()[:max_length]

    @staticmethod
    def _normalize_hunter(value: Any) -> str:
        text = str(value or "").strip().lower()
        if text in {"yes", "y", "true", "1", "是", "猎头"}:
            return "yes"
        if text in {"no", "n", "false", "0", "否", "不是", "非猎头"}:
            return "no"
        return "unknown"

    @staticmethod
    def _display_hunter(value: str | None) -> str:
        if value == "yes":
            return "是"
        if value == "no":
            return "否"
        return ""

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
