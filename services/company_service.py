import csv
import io
import json
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

BACKUP_TYPE = "tools102-boss-hire-tag-backup"
BACKUP_SCHEMA_VERSION = 1

HEADER_ALIASES = {
    "企业名称": "company_name",
    "公司名称": "company_name",
    "交流状态": "effect_status",
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

    def list_companies(self, time_filter: str = "all") -> list[dict[str, Any]]:
        all_items = self._read_state()["companies"]

        if time_filter == "all":
            return sorted(all_items, key=lambda item: item.get("updated_at") or "", reverse=True)

        # Use the storage's time index if available
        if hasattr(self.storage, "primary") and hasattr(self.storage.primary, "get_companies_by_time_filter"):
            try:
                ids = self.storage.primary.get_companies_by_time_filter(time_filter)
                id_set = set(ids)
                filtered = [c for c in all_items if str(c.get("id", "")) in id_set]
                return sorted(filtered, key=lambda item: item.get("updated_at") or "", reverse=True)
            except Exception:
                pass

        # Fallback: filter manually by created_at timestamp
        import time
        now = int(time.time())
        today_start = now - (now % 86400)

        filtered = []
        for item in all_items:
            created_at = item.get("created_at", "")
            if not created_at:
                continue
            try:
                ts = int(created_at) if created_at.isdigit() else 0
                if time_filter == "today" and ts >= today_start:
                    filtered.append(item)
                elif time_filter == "yesterday" and today_start - 86400 <= ts < today_start:
                    filtered.append(item)
                elif time_filter == "before_yesterday" and ts < today_start - 86400:
                    filtered.append(item)
            except (ValueError, TypeError):
                pass

        return sorted(filtered, key=lambda item: item.get("updated_at") or "", reverse=True)

    def fix_history_timestamps(self) -> dict[str, Any]:
        """Rebuild the timestamps index from existing company data."""
        if hasattr(self.storage, "primary") and hasattr(self.storage.primary, "rebuild_timestamps_index"):
            count = self.storage.primary.rebuild_timestamps_index()
            return {"message": f"已为 {count} 条记录建立时间索引", "count": count}
        return {"message": "当前存储不支持此功能", "count": 0}

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
        self._save_record(data, record)
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
        self._save_record(data, record)
        return record

    def delete_company(self, company_id: str) -> dict[str, Any]:
        data = self._read_state()
        before_count = len(data["companies"])
        data["companies"] = [item for item in data["companies"] if item.get("id") != company_id]
        if len(data["companies"]) == before_count:
            raise ValueError("记录不存在")

        data["meta"]["last_changed_at"] = self._now()
        if hasattr(self.storage, "delete_company_record"):
            self.storage.delete_company_record(company_id, {"last_changed_at": data["meta"]["last_changed_at"]})
        else:
            self.storage.write(data)
        return {"deleted": True, "id": company_id}

    def clear_companies(self) -> dict[str, Any]:
        """清空当前账号全部公司记录，保留交流状态/行业等自定义标签。"""
        data = self._read_state()
        companies = list(data.get("companies") or [])
        cleared_count = len(companies)
        base_ids = [str(item.get("id")) for item in companies if item.get("id")]
        now = self._now()
        data["companies"] = []
        meta = data.setdefault("meta", {})
        if not isinstance(meta, dict):
            meta = {}
            data["meta"] = meta
        meta["last_changed_at"] = now
        meta["cleared_at"] = now
        # 故意不改 settings / status_options / industry_options
        self.storage.write(data, replace=True, base_ids=base_ids)
        if hasattr(self.storage, "primary") and hasattr(self.storage.primary, "rebuild_timestamps_index"):
            try:
                self.storage.primary.rebuild_timestamps_index()
            except Exception:
                pass
        elif hasattr(self.storage, "rebuild_timestamps_index"):
            try:
                self.storage.rebuild_timestamps_index()
            except Exception:
                pass
        return {
            "cleared_count": cleared_count,
            "items": self.list_companies(),
            "summary": self.get_summary(),
        }

    def _save_record(self, data: dict[str, Any], record: dict[str, Any]) -> None:
        if hasattr(self.storage, "upsert_company"):
            self.storage.upsert_company(record, {"last_changed_at": data["meta"].get("last_changed_at") or self._now()})
            return
        self.storage.write(data)

    def import_rows(self, text: str, overwrite: bool = False) -> dict[str, Any]:
        if not text.strip():
            raise ValueError("导入内容不能为空")

        backup_payload = self._try_parse_structured_payload(text)
        if backup_payload is not None:
            if overwrite:
                # 下载备份 + 导入并覆盖：完整替换当前账号公司与设置
                restored = self.restore_backup(backup_payload)
                return {
                    "imported_count": restored["restored_count"],
                    "updated_count": 0,
                    "skipped_count": restored["skipped_count"],
                    "items": restored["items"],
                    "summary": restored["summary"],
                }
            return self._merge_backup_companies(backup_payload)

        text = self._coerce_import_text(text)
        data = self._read_state()
        rows = self._parse_rows(text)

        if overwrite:
            # 导入并覆盖：用新数据替换读取快照里的记录。快照之后新增的由 Lua 保留。
            base_ids = [str(item.get("id")) for item in data["companies"] if item.get("id")]
            existing_map = {c["company_name"]: c for c in data["companies"]}
            now = self._now()
            new_companies = []
            imported_count = 0

            for row in rows:
                normalized = self._normalize_import_row(row)
                if not normalized:
                    continue

                existing = existing_map.get(normalized["company_name"])
                if existing:
                    existing.update(normalized)
                    existing["updated_at"] = now
                    new_companies.append(existing)
                else:
                    new_companies.append({
                        "id": str(uuid.uuid4()),
                        **normalized,
                        "created_at": now,
                        "updated_at": now,
                    })
                    imported_count += 1

            data["companies"] = new_companies
            data["meta"]["last_changed_at"] = self._now()
            self.storage.write(data, replace=True, base_ids=base_ids)
            self._ensure_imported_option_tags(None, new_companies)
            return {
                "imported_count": imported_count,
                "updated_count": len(new_companies) - imported_count,
                "skipped_count": 0,
                "items": self.list_companies(),
                "summary": self.get_summary(),
            }

        # 普通导入：合并（存在则更新，不存在则新增）
        imported_count = 0
        updated_count = 0
        skipped_count = 0
        touched: list[dict[str, Any]] = []
        now = self._now()

        for row in rows:
            normalized = self._normalize_import_row(row)
            if not normalized:
                skipped_count += 1
                continue

            existing = self._find_by_name(data["companies"], normalized["company_name"])
            if existing:
                existing.update(normalized)
                existing["updated_at"] = now
                touched.append(existing)
                updated_count += 1
            else:
                record = {
                    "id": str(uuid.uuid4()),
                    **normalized,
                    "created_at": now,
                    "updated_at": now,
                }
                data["companies"].append(record)
                touched.append(record)
                imported_count += 1

        data["meta"]["last_changed_at"] = now
        if hasattr(self.storage, "upsert_company"):
            for item in touched:
                self.storage.upsert_company(item, {"last_changed_at": now})
        else:
            self.storage.write(data)
        self._ensure_imported_option_tags(None, touched)
        return {
            "imported_count": imported_count,
            "updated_count": updated_count,
            "skipped_count": skipped_count,
            "items": self.list_companies(),
            "summary": self.get_summary(),
        }

    def _try_parse_structured_payload(self, text: str) -> Any | None:
        stripped = text.strip()
        if not stripped.startswith("{") and not stripped.startswith("["):
            return None
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            return None
        if isinstance(payload, list):
            return payload if payload else None
        if not isinstance(payload, dict):
            return None
        if payload.get("type") == BACKUP_TYPE:
            return payload
        if isinstance(payload.get("companies"), list) or isinstance(payload.get("items"), list):
            return payload
        return None

    def _merge_backup_companies(self, payload: Any) -> dict[str, Any]:
        companies_raw, settings_raw, _schema = self._extract_backup_parts(payload)
        data = self._read_state()
        imported_count = 0
        updated_count = 0
        skipped_count = 0
        touched: list[dict[str, Any]] = []
        now = self._now()
        merged_records: list[dict[str, Any]] = []

        for item in companies_raw:
            record = self._normalize_backup_company(item)
            if not record:
                skipped_count += 1
                continue
            existing = self._find_by_name(data["companies"], record["company_name"])
            if existing:
                keep_id = existing["id"]
                keep_created = existing.get("created_at") or record.get("created_at") or now
                existing.update(record)
                existing["id"] = keep_id
                existing["created_at"] = keep_created
                existing["updated_at"] = now
                touched.append(existing)
                merged_records.append(existing)
                updated_count += 1
            else:
                data["companies"].append(record)
                touched.append(record)
                merged_records.append(record)
                imported_count += 1

        data["meta"]["last_changed_at"] = now
        if hasattr(self.storage, "upsert_company"):
            for item in touched:
                self.storage.upsert_company(item, {"last_changed_at": now})
        else:
            self.storage.write(data)

        # 增量导入：先把备份里的自定义标签补进当前账号
        self._ensure_imported_option_tags(settings_raw, merged_records)

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
            ["企业名称", "交流状态", "行业", "是否是猎头", "是否是外包", "是否已面试", "备注", "创建时间", "更新时间"]
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

    def create_backup(
        self,
        backup_dir: str,
        keep_count: int = 20,
        app_version: str = "",
        account: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Create a portable full JSON backup on disk and return metadata + payload."""
        from pathlib import Path

        state = self._read_state()
        companies = list(state.get("companies") or [])
        settings = self._build_backup_settings(companies)
        created_at = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        version_tag = "".join(ch for ch in (app_version or "unknown") if ch.isalnum() or ch in "._-") or "unknown"
        account_info = None
        if isinstance(account, dict) and account.get("id"):
            account_info = {
                "id": str(account.get("id") or ""),
                "username": str(account.get("username") or ""),
                "displayName": str(account.get("displayName") or account.get("username") or ""),
            }
        account_tag = ""
        if account_info and account_info["username"]:
            safe = "".join(ch for ch in account_info["username"] if ch.isalnum() or ch in "._-") or "account"
            account_tag = f"_{safe}"
        filename = f"backup_{version_tag}{account_tag}_{created_at}.json"
        payload = {
            "type": BACKUP_TYPE,
            "schema_version": BACKUP_SCHEMA_VERSION,
            "version": BACKUP_SCHEMA_VERSION,
            "app_version": app_version or "",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "company_count": len(companies),
            "account": account_info,
            "companies": companies,
            "settings": settings,
            # 单独列出标签数组，方便跨账号导入时直接补选项
            "status_options": list(settings.get("status_options") or []),
            "industry_options": list(settings.get("industry_options") or []),
            "meta": state.get("meta") or {},
        }

        root = Path(backup_dir)
        root.mkdir(parents=True, exist_ok=True)
        file_path = root / filename
        file_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        # Keep only the newest keep_count backups
        backups = sorted(root.glob("backup_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        for old in backups[max(keep_count, 1) :]:
            try:
                old.unlink()
            except OSError:
                pass

        return {
            "message": f"备份完成，共 {len(companies)} 条公司记录"
            + (f"（账号 {account_info['username']}）" if account_info and account_info.get("username") else ""),
            "filename": filename,
            "path": str(file_path),
            "company_count": len(companies),
            "created_at": payload["created_at"],
            "payload": payload,
        }

    def list_backups(self, backup_dir: str) -> list[dict[str, Any]]:
        from pathlib import Path

        root = Path(backup_dir)
        if not root.exists():
            return []
        items = []
        for path in sorted(root.glob("backup_*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
            items.append(
                {
                    "filename": path.name,
                    "size": path.stat().st_size,
                    "mtime": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(),
                }
            )
        return items

    def restore_backup(self, payload: Any) -> dict[str, Any]:
        """Replace companies and settings from a portable backup.

        Accepts the current backup file, older backups, and the previous
        JSON export shape so a file can move between release versions.
        """
        companies_raw, settings_raw, source_schema = self._extract_backup_parts(payload)
        records: list[dict[str, Any]] = []
        seen_names: set[str] = set()
        seen_ids: set[str] = set()
        skipped = 0

        for item in companies_raw:
            record = self._normalize_backup_company(item)
            if not record:
                skipped += 1
                continue
            name_key = record["company_name"].casefold()
            if name_key in seen_names:
                skipped += 1
                continue
            if record["id"] in seen_ids:
                record["id"] = str(uuid.uuid4())
            seen_names.add(name_key)
            seen_ids.add(record["id"])
            records.append(record)

        data = self._read_state()
        base_ids = [str(item.get("id")) for item in data.get("companies") or [] if item.get("id")]
        now = self._now()
        data["companies"] = records
        meta = data.setdefault("meta", {})
        if not isinstance(meta, dict):
            meta = {}
            data["meta"] = meta
        meta["last_changed_at"] = now
        meta["restored_at"] = now
        meta["restored_from_schema"] = source_schema
        self.storage.write(data, replace=True, base_ids=base_ids)

        if settings_raw is not None:
            # 覆盖时以备份标签为主，并补上公司记录里出现过的自定义值
            self._apply_imported_option_tags(settings_raw, records, replace=True)
        else:
            self._ensure_imported_option_tags(None, records)

        if hasattr(self.storage, "primary") and hasattr(self.storage.primary, "rebuild_timestamps_index"):
            self.storage.primary.rebuild_timestamps_index()
        elif hasattr(self.storage, "rebuild_timestamps_index"):
            self.storage.rebuild_timestamps_index()

        compatible = source_schema <= BACKUP_SCHEMA_VERSION
        message = f"已还原 {len(records)} 条公司记录"
        if not compatible:
            message += "（来自更高版本备份，已按当前版本兼容字段写入）"
        return {
            "message": message,
            "restored_count": len(records),
            "skipped_count": skipped,
            "schema_version": source_schema,
            "items": self.list_companies(),
            "summary": self.get_summary(),
        }

    def _extract_backup_parts(self, payload: Any) -> tuple[list[Any], dict[str, Any] | None, int]:
        if isinstance(payload, dict) and isinstance(payload.get("backup"), dict):
            payload = payload["backup"]

        if isinstance(payload, list):
            return payload, None, 0

        if not isinstance(payload, dict):
            raise ValueError("备份文件格式不正确")

        backup_type = str(payload.get("type") or "")
        if backup_type and backup_type != BACKUP_TYPE:
            raise ValueError("不是本系统的备份文件")

        companies = payload.get("companies")
        if companies is None and isinstance(payload.get("items"), list):
            companies = payload.get("items")
        if not isinstance(companies, list):
            raise ValueError("备份文件里没有公司数据")

        raw_version = payload.get("schema_version", payload.get("version", 0))
        try:
            schema_version = int(raw_version or 0)
        except (TypeError, ValueError):
            schema_version = 0

        settings = payload.get("settings")
        if settings is not None and not isinstance(settings, dict):
            settings = None
        if settings is None:
            settings = {}
        # 兼容顶层单独写出的标签数组
        if isinstance(payload.get("status_options"), list):
            settings = dict(settings)
            settings["status_options"] = payload.get("status_options")
        if isinstance(payload.get("industry_options"), list):
            settings = dict(settings)
            settings["industry_options"] = payload.get("industry_options")
        if not settings:
            settings = None
        return companies, settings, schema_version

    def _build_backup_settings(self, companies: list[dict[str, Any]]) -> dict[str, list[str]]:
        current = self.get_settings()
        status_tags, industry_tags = self._collect_option_tags(companies)
        return {
            "status_options": self._union_options(current.get("status_options"), status_tags),
            "industry_options": self._union_options(current.get("industry_options"), industry_tags),
        }

    def _collect_option_tags(self, companies: list[dict[str, Any]] | None) -> tuple[list[str], list[str]]:
        statuses: list[str] = []
        industries: list[str] = []
        for item in companies or []:
            if not isinstance(item, dict):
                continue
            for part in str(item.get("effect_status") or "").split(","):
                text = part.strip()
                if text:
                    statuses.append(text)
            for part in str(item.get("industry") or "").split(","):
                text = part.strip()
                if text:
                    industries.append(text)
        return statuses, industries

    @staticmethod
    def _union_options(*groups: Any) -> list[str]:
        seen: set[str] = set()
        ordered: list[str] = []
        for group in groups:
            if not isinstance(group, list):
                continue
            for item in group:
                text = str(item or "").strip()
                if not text:
                    continue
                key = text.casefold()
                if key in seen:
                    continue
                seen.add(key)
                ordered.append(text)
                if len(ordered) >= 50:
                    return ordered
        return ordered

    def _ensure_imported_option_tags(
        self,
        settings_raw: dict[str, Any] | None,
        companies: list[dict[str, Any]] | None,
    ) -> dict[str, list[str]]:
        """增量导入：把备份标签和记录里的自定义值合并进当前账号配置。"""
        return self._apply_imported_option_tags(settings_raw, companies, replace=False)

    def _apply_imported_option_tags(
        self,
        settings_raw: dict[str, Any] | None,
        companies: list[dict[str, Any]] | None,
        *,
        replace: bool,
    ) -> dict[str, list[str]]:
        current = self.get_settings()
        incoming = self._normalize_settings(settings_raw or {})
        status_tags, industry_tags = self._collect_option_tags(companies)
        if replace:
            next_settings = {
                "status_options": self._union_options(
                    incoming.get("status_options"),
                    status_tags,
                    DEFAULT_SETTINGS["status_options"],
                ),
                "industry_options": self._union_options(
                    incoming.get("industry_options"),
                    industry_tags,
                    DEFAULT_SETTINGS["industry_options"],
                ),
            }
        else:
            next_settings = {
                "status_options": self._union_options(
                    current.get("status_options"),
                    incoming.get("status_options"),
                    status_tags,
                ),
                "industry_options": self._union_options(
                    current.get("industry_options"),
                    incoming.get("industry_options"),
                    industry_tags,
                ),
            }
        return self.update_settings(next_settings)

    def _normalize_backup_company(self, item: Any) -> dict[str, Any] | None:
        if not isinstance(item, dict):
            return None
        company_name = self._clean_text(item.get("company_name"), FIELD_LIMITS["company_name"])
        if not company_name:
            return None

        now = self._now()
        record_id = str(item.get("id") or "").strip() or str(uuid.uuid4())
        created_at = str(item.get("created_at") or "").strip() or now
        updated_at = str(item.get("updated_at") or "").strip() or created_at

        record: dict[str, Any] = {}
        for key, value in item.items():
            if key in {
                "id",
                "company_name",
                "effect_status",
                "industry",
                "is_hunter",
                "is_outsourced",
                "is_interviewed",
                "note",
                "created_at",
                "updated_at",
            }:
                continue
            if isinstance(value, (str, int, float, bool)) or value is None:
                record[key] = value

        record.update(
            {
                "id": record_id,
                "company_name": company_name,
                "effect_status": self._clean_text(item.get("effect_status"), FIELD_LIMITS["effect_status"]),
                "industry": self._clean_text(item.get("industry"), FIELD_LIMITS["industry"]),
                "is_hunter": self._normalize_flag(item.get("is_hunter")),
                "is_outsourced": self._normalize_flag(item.get("is_outsourced")),
                "is_interviewed": self._normalize_flag(item.get("is_interviewed")),
                "note": self._clean_text(item.get("note"), FIELD_LIMITS["note"]),
                "created_at": created_at,
                "updated_at": updated_at,
            }
        )
        return record

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

    def _coerce_import_text(self, text: str) -> str:
        """把本账号导出的 JSON 转成表格文本。写入目标始终是当前账号，不看文件里的账号字段。"""
        stripped = text.strip()
        if not stripped.startswith("{") and not stripped.startswith("["):
            return text
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            return text
        items = payload if isinstance(payload, list) else payload.get("items") or payload.get("companies") or []
        if not isinstance(items, list) or not items:
            return text
        flag = {"yes": "是", "no": "否", "unknown": ""}
        lines = ["企业名称\t交流状态\t行业\t是否是猎头\t是否是外包\t是否已面试\t备注"]
        for item in items:
            if not isinstance(item, dict):
                continue
            lines.append(
                "\t".join(
                    [
                        str(item.get("company_name") or ""),
                        str(item.get("effect_status") or ""),
                        str(item.get("industry") or ""),
                        flag.get(str(item.get("is_hunter") or ""), str(item.get("is_hunter") or "")),
                        flag.get(str(item.get("is_outsourced") or ""), str(item.get("is_outsourced") or "")),
                        flag.get(str(item.get("is_interviewed") or ""), str(item.get("is_interviewed") or "")),
                        str(item.get("note") or ""),
                    ]
                )
            )
        return "\n".join(lines)

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
        return str(int(datetime.now(timezone.utc).timestamp()))
