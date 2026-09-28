"""Restore Redis keys from a tools_102BossHireTag JSON backup archive."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import redis

ROOT = Path(__file__).resolve().parent.parent
ENV_PATH = ROOT / ".env"


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


def restore_item(client: redis.Redis, item: dict, *, replace: bool) -> None:
    key = item["key"]
    key_type = item["type"]
    value = item.get("value")
    ttl = item.get("ttl")

    if replace and client.exists(key):
        client.delete(key)

    if key_type == "string":
        if value is None:
            return
        client.set(key, value)
    elif key_type == "hash":
        if not value:
            return
        client.hset(key, mapping=value)
    elif key_type == "zset":
        if not value:
            return
        mapping = {row["member"]: float(row["score"]) for row in value}
        client.zadd(key, mapping)
    elif key_type == "set":
        if not value:
            return
        client.sadd(key, *value)
    elif key_type == "list":
        if not value:
            return
        client.rpush(key, *value)
    else:
        raise ValueError(f"unsupported type for {key}: {key_type}")

    if isinstance(ttl, int) and ttl > 0:
        client.expire(key, ttl)


def main() -> None:
    parser = argparse.ArgumentParser(description="Restore Redis backup JSON")
    parser.add_argument("backup", type=Path, help="Path to redis-backup-*.json")
    parser.add_argument("--replace", action="store_true", help="Delete existing keys before restore")
    args = parser.parse_args()

    env = load_env(ENV_PATH)
    url = env.get("REDIS_URL") or os.getenv("REDIS_URL", "")
    if not url:
        raise SystemExit("REDIS_URL missing")

    payload = json.loads(args.backup.read_text(encoding="utf-8"))
    if payload.get("type") != "tools102-boss-hire-tag-redis-backup":
        raise SystemExit("not a redis backup for this project")

    client = redis.Redis.from_url(
        url,
        decode_responses=True,
        socket_connect_timeout=15,
        socket_timeout=60,
    )
    client.ping()

    restored = 0
    for item in payload.get("keys") or []:
        restore_item(client, item, replace=args.replace)
        restored += 1
    print(f"restored_keys={restored}")
    print(f"from={args.backup}")


if __name__ == "__main__":
    main()
