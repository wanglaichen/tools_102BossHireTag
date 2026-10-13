#!/usr/bin/env python3
"""将「真实岗位」写入本系统 boss 渠道（与「更新企业 → boss」同一存储）。

本脚本不再生成假公司/假简介，也不爬取 BOSS 直聘。
真数据需由你方采集器（浏览器插件、已授权导出、人工整理等）产出 JSON，再交给本脚本入库。

唯一键：channel + 企业名 + 岗位名
  - 新组合 → 新增
  - 已存在 → 覆盖字段（默认不刷新 updated_at，便于识别「首次发现时间」）

JSON 格式（文件或 stdin）：
{
  "channel": "boss",
  "items": [
    {
      "company_name": "真实公司名",
      "job_title": "真实岗位名",
      "salary_min": 20,
      "salary_max": 40,
      "location": "上海·浦东新区",
      "job_summary": "岗位原文简介，多行用真实换行即可，入库会存成 \\n"
    }
  ]
}

用法：
  python fetch_boss_jobs.py --from-json jobs.json
  python fetch_boss_jobs.py --from-json - < jobs.json
  python fetch_boss_jobs.py --purge-demo          # 删除历史演示假公司记录
  python fetch_boss_jobs.py --from-json jobs.json --touch-updated-at
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from config import AppConfig  # noqa: E402
from services.account_factory import job_updates_for_account  # noqa: E402
from services.auth_service import AuthService  # noqa: E402

# 历史脚本造过的假企业名；--purge-demo 时删除
DEMO_COMPANY_NAMES = frozenset(
    {
        "星火互娱",
        "青柠互动",
        "云途网络",
        "北辰游戏",
        "森罗科技",
        "极光数娱",
        "澜海工作室",
        "幻象互动",
        "拾光互娱",
        "零一游戏",
        "示例科技有限公司",
        "星云互娱",
    }
)


def build_auth() -> AuthService:
    return AuthService(
        redis_url=AppConfig.REDIS_URL,
        key_prefix=AppConfig.REDIS_KEY_PREFIX,
        timeout_seconds=AppConfig.REDIS_TIMEOUT_SECONDS,
        secret_key=AppConfig.SECRET_KEY,
        wechat_appid=AppConfig.WECHAT_APPID,
        wechat_secret=AppConfig.WECHAT_SECRET,
        session_ttl_seconds=AppConfig.AUTH_SESSION_TTL_SECONDS,
        dev_token=AppConfig.MINIAPP_DEV_TOKEN,
        admin_username=AppConfig.ADMIN_USERNAME,
        admin_password=AppConfig.ADMIN_PASSWORD,
    )


def resolve_user(auth: AuthService, username: str) -> dict[str, Any]:
    name = (username or AppConfig.ADMIN_USERNAME or "admin").strip()
    user = auth.find_user_by_username(name)
    if not user:
        raise SystemExit(f"找不到用户「{name}」，请确认账号已存在")
    return user


def load_items_from_json(source: str) -> tuple[str, list[dict[str, Any]]]:
    if source == "-":
        raw_text = sys.stdin.read()
    else:
        path = Path(source)
        if not path.is_file():
            raise SystemExit(f"找不到 JSON 文件：{path}")
        raw_text = path.read_text(encoding="utf-8")
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"JSON 解析失败：{exc}") from exc

    channel = "boss"
    items: list[Any]
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        channel = str(payload.get("channel") or "boss").strip() or "boss"
        if isinstance(payload.get("items"), list):
            items = payload["items"]
        elif isinstance(payload.get("data"), list):
            items = payload["data"]
        else:
            raise SystemExit("JSON 需包含 items 数组，或直接是岗位对象数组")
    else:
        raise SystemExit("JSON 根节点必须是对象或数组")

    cleaned: list[dict[str, Any]] = []
    for raw in items:
        if not isinstance(raw, dict):
            continue
        company = str(raw.get("company_name") or "").strip()
        title = str(raw.get("job_title") or "").strip()
        if not company or not title:
            continue
        item = {
            "company_name": company,
            "job_title": title,
            "location": str(raw.get("location") or "").strip(),
            "job_summary": str(raw.get("job_summary") or ""),
        }
        if "salary_min" in raw:
            item["salary_min"] = raw.get("salary_min")
        if "salary_max" in raw:
            item["salary_max"] = raw.get("salary_max")
        if "channel" in raw and raw.get("channel"):
            item["channel"] = raw.get("channel")
        cleaned.append(item)

    if not cleaned:
        raise SystemExit("没有有效岗位（需要 company_name + job_title）")
    return channel, cleaned


def dedupe_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """同企业同岗位只留最后一条，与系统唯一键一致。"""
    dedup: dict[tuple[str, str, str], dict[str, Any]] = {}
    for item in items:
        channel = str(item.get("channel") or "boss").strip().casefold() or "boss"
        key = (
            channel,
            str(item.get("company_name") or "").casefold(),
            str(item.get("job_title") or "").casefold(),
        )
        dedup[key] = item
    return list(dedup.values())


def purge_demo_companies(svc: Any, *, channel: str) -> int:
    """删除历史演示假公司，以及「企业名-数字」假后缀记录。"""
    import re

    numbered = re.compile(r"^.+-\d+$")
    removed = 0
    for item in list(svc.list_items(channel=channel)):
        name = str(item.get("company_name") or "").strip()
        base = name.rsplit("-", 1)[0] if numbered.match(name) else name
        if name not in DEMO_COMPANY_NAMES and base not in DEMO_COMPANY_NAMES and not numbered.match(name):
            continue
        item_id = item.get("id")
        if not item_id:
            continue
        try:
            svc.delete_item(str(item_id))
            removed += 1
        except ValueError:
            continue
    return removed


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="导入真实岗位 JSON 到 boss 渠道（不生成假数据、不爬站）",
    )
    parser.add_argument(
        "--from-json",
        default="",
        help="真实岗位 JSON 路径；传 - 表示从 stdin 读",
    )
    parser.add_argument(
        "--purge-demo",
        action="store_true",
        help="删除历史演示假公司记录后退出（或与 --from-json 联用先清再导）",
    )
    parser.add_argument(
        "-u",
        "--username",
        default="",
        help="写入到哪个账号（默认 ADMIN_USERNAME / admin）",
    )
    parser.add_argument(
        "--channel",
        default="",
        help="覆盖 JSON 内 channel，默认 boss",
    )
    parser.add_argument(
        "--touch-updated-at",
        action="store_true",
        help="重复覆盖时刷新 updated_at（默认不刷新）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只校验/打印，不写库",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if not args.from_json and not args.purge_demo:
        raise SystemExit(
            "已停用假数据生成。\n"
            "请提供真实岗位 JSON：\n"
            "  python fetch_boss_jobs.py --from-json jobs.json\n"
            "或清理历史演示数据：\n"
            "  python fetch_boss_jobs.py --purge-demo\n"
            "说明：本工具不爬取 BOSS；真公司/真职位/真简介需由外部采集后导入。"
        )

    print("[1/4] 连接账号…")
    auth = build_auth()
    user = resolve_user(auth, args.username)
    print(f"      user_id={user.get('id')} username={user.get('username')}")
    svc = job_updates_for_account(user)

    channel_for_purge = (args.channel or "boss").strip() or "boss"
    if args.purge_demo:
        if args.dry_run:
            print(f"[dry-run] 将清理渠道 {channel_for_purge!r} 下的演示假公司")
        else:
            n = purge_demo_companies(svc, channel=channel_for_purge)
            print(f"[purge] 已删除演示/假后缀记录 {n} 条（channel={channel_for_purge}）")
        if not args.from_json:
            return 0

    print("[2/4] 读取真实岗位 JSON…")
    file_channel, items = load_items_from_json(args.from_json)
    channel = (args.channel or file_channel or "boss").strip() or "boss"
    items = dedupe_items(items)
    print(f"      channel={channel!r} 有效去重后={len(items)}")

    if args.dry_run:
        print("[dry-run] 将写入：")
        print(json.dumps({"channel": channel, "items": items}, ensure_ascii=False, indent=2))
        return 0

    print("[3/4] upsert_batch…")
    preserve = not args.touch_updated_at
    for item in items:
        item["preserve_updated_at"] = preserve
    result = svc.upsert_batch(items, channel=channel, preserve_updated_at=preserve)

    print(
        f"[4/4] 完成：新增 {result.get('created_count')}，"
        f"更新 {result.get('updated_count')}，跳过 {result.get('skipped_count')}"
        + ("（重复不刷新 updated_at）" if preserve else "（已刷新 updated_at）")
    )
    for it in (result.get("touched") or [])[:10]:
        print(
            f"      - {it.get('company_name')} | {it.get('job_title')} | "
            f"{it.get('location')} | upd={it.get('updated_at')}"
        )
        summary = str(it.get("job_summary") or "")
        if summary:
            print(f"        简介: {summary[:120]}{'…' if len(summary) > 120 else ''}")
    print("请在页面「更新企业 → boss」刷新查看。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
