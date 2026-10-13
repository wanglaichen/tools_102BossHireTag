"""企业全称跨名单补全同步（空值不同步；仅写入目标侧为空的记录）。"""
from __future__ import annotations

from typing import Any, Callable, Iterator

from services.blacklist_service import BlacklistService
from services.blocklist_service import BlocklistService
from services.company_service import CompanyService
from services.watchlist_service import WatchlistService

StepKeyFn = Callable[[dict[str, Any]], str]
PatchFn = Callable[[dict[str, str]], int]

STEPS: list[dict[str, str]] = [
    {
        "id": "ignored_to_hire",
        "label": "忽略企业 → 投递登记",
        "source": "ignored",
        "target": "hire",
        "match": "channel_name",
    },
    {
        "id": "hire_to_ignored",
        "label": "投递登记 → 忽略企业",
        "source": "hire",
        "target": "ignored",
        "match": "channel_name",
    },
    {
        "id": "ignored_to_blocklist",
        "label": "忽略企业 → 黑名单企业",
        "source": "ignored",
        "target": "blocklist",
        "match": "name",
    },
    {
        "id": "blocklist_to_ignored",
        "label": "黑名单企业 → 忽略企业",
        "source": "blocklist",
        "target": "ignored",
        "match": "name",
    },
    {
        "id": "ignored_to_watchlist",
        "label": "忽略企业 → 持续关注",
        "source": "ignored",
        "target": "watchlist",
        "match": "name",
    },
    {
        "id": "watchlist_to_ignored",
        "label": "持续关注 → 忽略企业",
        "source": "watchlist",
        "target": "ignored",
        "match": "name",
    },
]


class FullNameSyncService:
    def __init__(
        self,
        companies: CompanyService,
        ignored: BlacklistService,
        blocklist: BlocklistService,
        watchlist: WatchlistService,
    ) -> None:
        self.companies = companies
        self.ignored = ignored
        self.blocklist = blocklist
        self.watchlist = watchlist

    def iter_events(self) -> Iterator[dict[str, Any]]:
        bags: dict[str, list[dict[str, Any]]] = {
            "hire": list(self.companies.list_companies()),
            "ignored": list(self.ignored.list_items()),
            "blocklist": list(self.blocklist.list_items()),
            "watchlist": list(self.watchlist.list_items()),
        }
        patchers: dict[str, PatchFn] = {
            "hire": self.companies.patch_company_full_names,
            "ignored": self.ignored.patch_company_full_names,
            "blocklist": self.blocklist.patch_company_full_names,
            "watchlist": self.watchlist.patch_company_full_names,
        }

        total = sum(len(bags[step["target"]]) for step in STEPS)
        yield {
            "type": "start",
            "total": total,
            "steps": len(STEPS),
            "message": f"开始同步企业全称，共 {len(STEPS)} 步、扫描 {total} 条目标记录",
        }

        total_done = 0
        total_updated = 0
        step_results: list[dict[str, Any]] = []

        for index, step in enumerate(STEPS, start=1):
            source_items = bags[step["source"]]
            target_items = bags[step["target"]]
            key_fn = self._key_fn(step["match"])
            source_map = self._build_source_map(source_items, key_fn)
            step_total = len(target_items)

            yield {
                "type": "step_start",
                "step": index,
                "steps": len(STEPS),
                "stepId": step["id"],
                "label": step["label"],
                "stepTotal": step_total,
                "total": total,
                "totalDone": total_done,
                "updated": total_updated,
                "message": f"第 {index}/{len(STEPS)} 步：{step['label']}",
            }

            patches: dict[str, str] = {}
            step_scanned = 0
            step_updated = 0
            report_every = max(1, step_total // 40) if step_total else 1

            for item in target_items:
                step_scanned += 1
                total_done += 1
                item_id = str(item.get("id") or "")
                if item_id and not self._full_name(item):
                    key = key_fn(item)
                    full = source_map.get(key) if key else None
                    if full:
                        patches[item_id] = full
                        item["company_full_name"] = full
                        step_updated += 1
                        total_updated += 1

                if step_scanned == step_total or step_scanned % report_every == 0:
                    yield {
                        "type": "progress",
                        "step": index,
                        "steps": len(STEPS),
                        "stepId": step["id"],
                        "label": step["label"],
                        "stepDone": step_scanned,
                        "stepTotal": step_total,
                        "stepUpdated": step_updated,
                        "totalDone": total_done,
                        "total": total,
                        "updated": total_updated,
                        "message": (
                            f"{step['label']}：{step_scanned}/{step_total}"
                            f"（已写入 {step_updated}）"
                        ),
                    }

            written = patchers[step["target"]](patches) if patches else 0
            # 以实际落盘数为准（与内存计数应一致）
            if written != step_updated:
                delta = written - step_updated
                total_updated += delta
                step_updated = written

            result = {
                "stepId": step["id"],
                "label": step["label"],
                "scanned": step_scanned,
                "updated": step_updated,
            }
            step_results.append(result)
            yield {
                "type": "step_done",
                "step": index,
                "steps": len(STEPS),
                "stepId": step["id"],
                "label": step["label"],
                "stepDone": step_scanned,
                "stepTotal": step_total,
                "stepUpdated": step_updated,
                "totalDone": total_done,
                "total": total,
                "updated": total_updated,
                "message": f"完成 {step['label']}：扫描 {step_scanned}，写入 {step_updated}",
            }

        yield {
            "type": "done",
            "totalDone": total_done,
            "total": total,
            "updated": total_updated,
            "steps": step_results,
            "message": f"企业全称同步完成：共写入 {total_updated} 条",
        }

    @staticmethod
    def _full_name(item: dict[str, Any] | None) -> str:
        return str((item or {}).get("company_full_name") or "").strip()

    @staticmethod
    def _name_key(item: dict[str, Any]) -> str:
        return str(item.get("company_name") or "").strip().casefold()

    @classmethod
    def _channel_name_key(cls, item: dict[str, Any]) -> str:
        channel = str(item.get("channel") or "boss").strip().casefold() or "boss"
        name = cls._name_key(item)
        if not name:
            return ""
        return f"{channel}::{name}"

    @classmethod
    def _key_fn(cls, match: str) -> StepKeyFn:
        if match == "channel_name":
            return cls._channel_name_key
        return cls._name_key

    @classmethod
    def _build_source_map(cls, items: list[dict[str, Any]], key_fn: StepKeyFn) -> dict[str, str]:
        result: dict[str, tuple[str, str]] = {}
        for item in items:
            full = cls._full_name(item)
            if not full:
                continue
            key = key_fn(item)
            if not key:
                continue
            stamp = str(item.get("updated_at") or "")
            prev = result.get(key)
            if prev is None or stamp >= prev[1]:
                result[key] = (full, stamp)
        return {key: value[0] for key, value in result.items()}
