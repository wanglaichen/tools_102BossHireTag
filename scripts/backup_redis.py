"""Backup all Redis keys for tools_102BossHireTag into a JSON archive."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

import redis

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"
OUT_DIR = ROOT / "data" / "redis-backups"


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def dump_key(client: redis.Redis, key: str) -> dict:
    key_type = client.type(key)
    ttl = client.ttl(key)
    item: dict = {"key": key, "type": key_type, "ttl": ttl}
    if key_type == "string":
        item["value"] = client.get(key)
    elif key_type == "hash":
        item["value"] = client.hgetall(key)
    elif key_type == "zset":
        item["value"] = [
            {"member": member, "score": score}
            for member, score in client.zrange(key, 0, -1, withscores=True)
        ]
    elif key_type == "set":
        item["value"] = sorted(client.smembers(key))
    elif key_type == "list":
        item["value"] = client.lrange(key, 0, -1)
    else:
        item["value"] = None
        item["warning"] = f"unsupported type: {key_type}"
    return item


def main() -> None:
    env = load_env(ENV_PATH)
    url = env.get("REDIS_URL") or os.getenv("REDIS_URL", "")
    if not url:
        raise SystemExit("REDIS_URL missing")

    prefix = (env.get("REDIS_KEY_PREFIX") or "jjob:tools102-boss-hire-tag:state").rstrip(":")
    roots = {
        prefix,
        env.get("REDIS_SETTINGS_KEY") or "jjob:tools102-boss-hire-tag:settings",
        env.get("REDIS_PROXY_KEY") or "jjob:tools102-boss-hire-tag:proxy",
        env.get("REDIS_CHANNELS_KEY") or "jjob:tools102-boss-hire-tag:channels",
        "jjob:tools102-boss-hire-tag",
        "jjob/tools102-boss-hire-tag",
    }

    client = redis.Redis.from_url(
        url,
        decode_responses=True,
        socket_connect_timeout=15,
        socket_timeout=30,
    )
    client.ping()

    keys: set[str] = set()
    for root in roots:
        if not root:
            continue
        for pattern in (root, f"{root}:*", f"{root}/*"):
            for key in client.scan_iter(match=pattern, count=200):
                keys.add(key)

    dumped = [dump_key(client, key) for key in sorted(keys)]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"redis-backup-{stamp}.json"
    payload = {
        "type": "tools102-boss-hire-tag-redis-backup",
        "schema_version": 1,
        "exported_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "prefix": prefix,
        "key_count": len(dumped),
        "keys": dumped,
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    # summary counts
    hire_companies = 0
    users = 0
    for item in dumped:
        if item["key"].endswith(":companies") and item["type"] == "hash" and isinstance(item.get("value"), dict):
            if ":ignored:" in item["key"] or ":blacklist:" in item["key"]:
                continue
            hire_companies += len(item["value"])
        if item["key"].endswith(":users") and item["type"] == "hash" and isinstance(item.get("value"), dict):
            users = len(item["value"])

    print(f"backup={out_path}")
    print(f"keys={len(dumped)}")
    print(f"users={users}")
    print(f"hire_company_hashes_records≈{hire_companies}")


if __name__ == "__main__":
    main()
