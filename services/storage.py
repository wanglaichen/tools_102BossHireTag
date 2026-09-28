import contextvars
import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable

# primary=本次已成功读到数据库；failed=读取失败，禁止把该结果写回。
_read_source: contextvars.ContextVar[str] = contextvars.ContextVar("boss_hire_read_source", default="primary")


def _reject_failed_read_write() -> None:
    if _read_source.get() == "failed":
        raise StorageUnavailable("读取数据库失败，已取消写入，避免用失败结果覆盖数据")


def _read_primary_or_raise(storage: "RedisStorage") -> dict[str, Any]:
    try:
        data = storage.read()
    except StorageUnavailable:
        _read_source.set("failed")
        raise
    except Exception as exc:
        _read_source.set("failed")
        raise StorageUnavailable("读取数据库失败，已取消本次操作，不会回写") from exc
    _read_source.set("primary")
    return data

try:
    import redis
except ImportError:  # pragma: no cover - allows local syntax checks before dependencies are installed.
    redis = None


class StorageUnavailable(RuntimeError):
    pass


class JsonStorage:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._lock = threading.RLock()

    def read(self) -> dict[str, Any]:
        with self._lock:
            if not self.path.exists():
                return self._default_data()

            with self.path.open("r", encoding="utf-8") as file:
                data = json.load(file)

            if not isinstance(data, dict):
                return self._default_data()
            data.setdefault("companies", [])
            data.setdefault("meta", {})
            data.setdefault("settings", {})
            return data

    def write(self, data: dict[str, Any], replace: bool = False, base_ids: list[str] | None = None) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = self.path.with_suffix(f"{self.path.suffix}.tmp")
            with tmp_path.open("w", encoding="utf-8") as file:
                json.dump(data, file, ensure_ascii=False, indent=2)
                file.write("\n")
            os.replace(tmp_path, self.path)

    @staticmethod
    def _default_data() -> dict[str, Any]:
        return {"companies": [], "meta": {}, "settings": {}}


class RedisStorage:
    def __init__(
        self,
        url: str,
        key_prefix: str,
        timeout_seconds: float = 15,
        *,
        data_hash_name: str = "companies",
    ) -> None:
        if redis is None:
            raise StorageUnavailable("redis 依赖未安装，请先执行 pip install -r requirements.txt")
        self.url = url
        self.key_prefix = key_prefix.rstrip(":")
        self.data_hash_name = (data_hash_name or "companies").strip() or "companies"
        self._timeout = max(float(timeout_seconds or 15), 5.0)
        self._client: redis.Redis | None = None
        self._scan_count = 200
        self._read_retries = 3
        self._blacklist_migrated = False

    @property
    def client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.Redis.from_url(
                self.url,
                decode_responses=True,
                socket_connect_timeout=self._timeout,
                socket_timeout=self._timeout,
                retry_on_timeout=True,
                health_check_interval=30,
            )
        return self._client

    def _reset_client(self) -> None:
        client = self._client
        self._client = None
        if client is not None:
            try:
                client.close()
            except Exception:
                pass

    def _is_transient_redis_error(self, exc: Exception) -> bool:
        names = {"TimeoutError", "ConnectionError", "BusyLoadingError", "ConnectionResetError", "OSError"}
        if type(exc).__name__ in names:
            return True
        if redis is not None:
            for attr in ("TimeoutError", "ConnectionError", "BusyLoadingError"):
                cls = getattr(redis, attr, None)
                if cls is not None and isinstance(exc, cls):
                    return True
        return False

    def _call_with_retry(self, fn: Callable[[], Any], *, attempts: int | None = None) -> Any:
        total = attempts or self._read_retries
        last_exc: Exception | None = None
        for index in range(total):
            try:
                return fn()
            except StorageUnavailable:
                raise
            except Exception as exc:
                last_exc = exc
                if not self._is_transient_redis_error(exc) or index >= total - 1:
                    raise
                self._reset_client()
                time.sleep(0.2 * (index + 1))
        if last_exc is not None:
            raise last_exc
        raise StorageUnavailable("读取数据库失败，已取消本次操作，不会回写")

    @property
    def _companies_key(self) -> str:
        return f"{self.key_prefix}:{self.data_hash_name}"

    @property
    def _legacy_companies_key(self) -> str:
        """忽略企业旧 key：…:blacklist:companies / …:ignored:companies；新 key：…:ignored:items。"""
        return f"{self.key_prefix}:companies"

    def _migrate_blacklist_hash_if_needed(self) -> None:
        if self.data_hash_name != "items" or self._blacklist_migrated:
            return
        self._blacklist_migrated = True
        items_key = self._companies_key
        legacy_key = self._legacy_companies_key
        try:
            if self._key_type(items_key) == "hash" and self.client.hlen(items_key) > 0:
                return
            if self._key_type(legacy_key) != "hash" or self.client.hlen(legacy_key) == 0:
                return
            pipeline = self.client.pipeline()
            for field, value in self.client.hscan_iter(legacy_key, count=self._scan_count):
                pipeline.hset(items_key, field, value)
            pipeline.delete(legacy_key)
            pipeline.execute()
        except Exception:
            # 迁移失败时仍可读旧 key（见 _read_company_hash）
            self._blacklist_migrated = False
            return

    @property
    def _meta_key(self) -> str:
        return f"{self.key_prefix}:meta"

    @property
    def _next_id_key(self) -> str:
        return f"{self.key_prefix}:next_id"

    @property
    def _timestamps_key(self) -> str:
        return f"{self.key_prefix}:timestamps"

    def _next_id(self) -> int:
        return self.client.incr(self._next_id_key)

    def _update_timestamps_index(self, companies: list[dict], pipeline: Any = None) -> None:
        """Update the sorted set index with company creation timestamps."""
        timestamp_members = []  # [(score, member), ...]
        for company in companies:
            company_id = str(company.get("id", ""))
            created_at = company.get("created_at")
            if company_id and created_at:
                try:
                    # Try parsing as Unix timestamp integer first
                    ts = int(created_at)
                    timestamp_members.append((float(ts), company_id))
                except (ValueError, TypeError):
                    # Fallback: try parsing ISO string datetime
                    try:
                        from datetime import datetime, timezone
                        dt = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
                        ts = int(dt.timestamp())
                        timestamp_members.append((float(ts), company_id))
                    except Exception:
                        pass

        if pipeline is None:
            p = self.client.pipeline()
        else:
            p = pipeline

        p.delete(self._timestamps_key)
        if timestamp_members:
            for score, member in timestamp_members:
                p.zadd(self._timestamps_key, {member: score})

        if pipeline is None:
            p.execute()

    def get_companies_by_time_filter(self, time_filter: str) -> list[str]:
        """Get company IDs by time filter. time_filter: all/today/yesterday/before_yesterday"""
        import time
        now = int(time.time())
        today_start = now - (now % 86400)

        if time_filter == "all":
            return [k.decode() if isinstance(k, bytes) else k for k in self.client.zrange(self._timestamps_key, 0, -1)]
        if time_filter == "today":
            return [k.decode() if isinstance(k, bytes) else k for k in self.client.zrangebyscore(self._timestamps_key, today_start, "+inf")]
        if time_filter == "yesterday":
            yesterday_start = today_start - 86400
            yesterday_end = today_start - 1
            return [k.decode() if isinstance(k, bytes) else k for k in self.client.zrangebyscore(self._timestamps_key, yesterday_start, yesterday_end)]
        if time_filter == "before_yesterday":
            before_yesterday_end = today_start - 1
            return [k.decode() if isinstance(k, bytes) else k for k in self.client.zrangebyscore(self._timestamps_key, 0, before_yesterday_end)]
        return []

    def rebuild_timestamps_index(self) -> int:
        """Rebuild the timestamps index from existing company hash data. Returns count."""
        companies = self._read_company_hash()
        if not companies:
            try:
                companies = self._read_legacy_state().get("companies", [])
            except Exception as exc:
                raise StorageUnavailable("读取公司记录失败，已取消重建时间索引") from exc
        if not companies and self._key_type(self._timestamps_key) == "zset" and self.client.zcard(self._timestamps_key):
            raise StorageUnavailable("没有读到公司记录，已取消重建时间索引")
        self._update_timestamps_index(companies)
        return len(companies)

    def read(self) -> dict[str, Any]:
        # Hash 用 HSCAN 分批读；有 Hash 数据时不再扫旧字符串键，避免远程 Redis 超时。
        companies = self._call_with_retry(self._read_company_hash)
        meta: dict[str, Any] = {}
        settings: dict[str, Any] = {}

        if companies:
            try:
                meta_raw = self._call_with_retry(lambda: self.client.hgetall(self._meta_key))
                meta = dict(meta_raw) if meta_raw else {}
            except Exception:
                meta = {}
        else:
            try:
                legacy_state = self._call_with_retry(self._read_legacy_state)
            except Exception:
                raise
            companies = list(legacy_state.get("companies") or [])
            meta = dict(legacy_state.get("meta") or {})
            settings = dict(legacy_state.get("settings") or {})
            if not meta:
                try:
                    meta_raw = self._call_with_retry(lambda: self.client.hgetall(self._meta_key))
                    meta = dict(meta_raw) if meta_raw else {}
                except Exception:
                    meta = {}

        return {
            "companies": sorted(companies, key=lambda x: x.get("updated_at") or "", reverse=True),
            "meta": meta,
            "settings": settings,
        }

    def upsert_company(self, record: dict[str, Any], meta_updates: dict[str, Any] | None = None) -> None:
        """写入单条公司，不删除 Hash 里的其他记录。"""
        self._migrate_blacklist_hash_if_needed()
        company_id = str(record.get("id") or "").strip()
        if not company_id:
            raise ValueError("记录缺少 id")

        pipeline = self.client.pipeline()
        pipeline.hset(self._companies_key, company_id, json.dumps(record, ensure_ascii=False))
        score = self._timestamp_score(record.get("created_at"))
        if score is not None:
            pipeline.zadd(self._timestamps_key, {company_id: score})
        if self.data_hash_name == "items":
            pipeline.delete(self._legacy_companies_key)
        if meta_updates:
            pipeline.hset(
                self._meta_key,
                mapping={key: str(value) for key, value in meta_updates.items() if value is not None},
            )
        pipeline.execute()

    def delete_company_record(self, company_id: str, meta_updates: dict[str, Any] | None = None) -> None:
        """只删除一条公司，避免读全量失败后把其余记录一起写掉。"""
        pipeline = self.client.pipeline()
        pipeline.hdel(self._companies_key, company_id)
        pipeline.zrem(self._timestamps_key, company_id)
        if meta_updates:
            pipeline.hset(
                self._meta_key,
                mapping={key: str(value) for key, value in meta_updates.items() if value is not None},
            )
        pipeline.execute()

    @staticmethod
    def _timestamp_score(created_at: Any) -> float | None:
        if created_at is None or created_at == "":
            return None
        try:
            return float(int(created_at))
        except (ValueError, TypeError):
            pass
        try:
            from datetime import datetime

            dt = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
            return float(int(dt.timestamp()))
        except (ValueError, TypeError):
            return None

    # 覆盖导入 / 还原备份：一次 Lua 内完成替换。
    # 只删除「读取快照里有、新数据里没有」的记录；快照之后新增的，以及旧字符串里没被读到的，都保留。
    _REPLACE_LUA = r"""
local function ktype(key)
  local t = redis.call("TYPE", key)
  if type(t) == "table" then
    return tostring(t["ok"] or t[1] or "none")
  end
  return tostring(t)
end

local function append_companies(raw, bucket)
  local ok, decoded = pcall(cjson.decode, raw)
  if not ok or type(decoded) ~= "table" then
    return false
  end
  local list = decoded
  if decoded.companies and type(decoded.companies) == "table" then
    list = decoded.companies
  end
  if #list == 0 and decoded.id ~= nil then
    list = {decoded}
  end
  local found = false
  for i = 1, #list do
    local item = list[i]
    if type(item) == "table" and item.id ~= nil then
      bucket[#bucket + 1] = {id = tostring(item.id), raw = cjson.encode(item), score = tonumber(item.created_at)}
      found = true
    end
  end
  return found
end

local companies_key = KEYS[1]
local ts_key = KEYS[2]
local meta_key = KEYS[3]
local slash_key = KEYS[4]
local incoming = cjson.decode(ARGV[1])
local base_ids = cjson.decode(ARGV[2])
local meta = cjson.decode(ARGV[3])
local legacy_pattern = ARGV[4]

local base = {}
for i = 1, #base_ids do
  base[tostring(base_ids[i])] = true
end

local newset = {}
for i = 1, #incoming do
  local item = incoming[i]
  newset[tostring(item.id)] = item
end

local protected = {}
local function consider_keep(id, raw, score)
  id = tostring(id)
  if newset[id] or base[id] or protected[id] then
    return
  end
  protected[id] = {raw = raw, score = score}
end

local main_type = ktype(companies_key)
local legacy_delete = {}

if main_type == "hash" then
  local fields = redis.call("HKEYS", companies_key)
  for i = 1, #fields do
    local field = tostring(fields[i])
    if not base[field] and not newset[field] then
      local raw = redis.call("HGET", companies_key, field)
      if raw then
        local score = nil
        local ok, item = pcall(cjson.decode, raw)
        if ok and type(item) == "table" then
          score = tonumber(item.created_at)
        end
        consider_keep(field, raw, score)
      end
    end
  end
elseif main_type == "string" then
  local raw = redis.call("GET", companies_key)
  local parsed = {}
  if raw and append_companies(raw, parsed) then
    for i = 1, #parsed do
      consider_keep(parsed[i].id, parsed[i].raw, parsed[i].score)
    end
  elseif raw then
    return redis.error_reply("legacy companies string is not readable")
  end
elseif main_type ~= "none" then
  return redis.error_reply("unsupported companies key type: " .. main_type)
end

if slash_key and slash_key ~= "" and slash_key ~= companies_key and ktype(slash_key) == "string" then
  local raw = redis.call("GET", slash_key)
  local parsed = {}
  if raw and append_companies(raw, parsed) then
    for i = 1, #parsed do
      consider_keep(parsed[i].id, parsed[i].raw, parsed[i].score)
    end
    legacy_delete[#legacy_delete + 1] = slash_key
  end
end

if legacy_pattern and legacy_pattern ~= "" then
  local cursor = "0"
  repeat
    local scanned = redis.call("SCAN", cursor, "MATCH", legacy_pattern, "COUNT", 200)
    cursor = tostring(scanned[1])
    local keys = scanned[2]
    for i = 1, #keys do
      local legacy_key = keys[i]
      if legacy_key ~= companies_key and ktype(legacy_key) == "string" then
        local raw = redis.call("GET", legacy_key)
        local parsed = {}
        if raw and append_companies(raw, parsed) then
          for j = 1, #parsed do
            consider_keep(parsed[j].id, parsed[j].raw, parsed[j].score)
          end
          legacy_delete[#legacy_delete + 1] = legacy_key
        end
      end
    end
  until cursor == "0"
end

if main_type == "string" then
  redis.call("DEL", companies_key)
end

local function zadd_score(id, score)
  if score ~= nil then
    redis.call("ZADD", ts_key, score, id)
  end
end

for id, item in pairs(newset) do
  redis.call("HSET", companies_key, id, item.body)
  if item.score ~= cjson.null then
    zadd_score(id, tonumber(item.score))
  end
end

for id, item in pairs(protected) do
  if redis.call("HEXISTS", companies_key, id) == 0 then
    redis.call("HSET", companies_key, id, item.raw)
  end
  zadd_score(id, item.score)
end

local deleted = 0
for id, _ in pairs(base) do
  if not newset[id] then
    redis.call("HDEL", companies_key, id)
    redis.call("ZREM", ts_key, id)
    deleted = deleted + 1
  end
end

redis.call("DEL", meta_key)
if type(meta) == "table" then
  for key, value in pairs(meta) do
    if type(value) ~= "table" then
      redis.call("HSET", meta_key, tostring(key), tostring(value))
    end
  end
end

for i = 1, #legacy_delete do
  if legacy_delete[i] ~= companies_key then
    redis.call("DEL", legacy_delete[i])
  end
end

local kept = 0
for _ in pairs(protected) do
  kept = kept + 1
end
return cjson.encode({deleted = deleted, kept = kept})
"""

    def _replace_with_lua(self, data: dict[str, Any], base_ids: list[str]) -> None:
        companies = data.get("companies", [])
        if any(not company.get("id") for company in companies):
            raise StorageUnavailable("有公司记录缺少 id，已取消写入")

        incoming = []
        for company in companies:
            incoming.append(
                {
                    "id": str(company["id"]),
                    "body": json.dumps(company, ensure_ascii=False),
                    "score": self._timestamp_score(company.get("created_at")),
                }
            )
        meta = {
            str(key): value
            for key, value in (data.get("meta") or {}).items()
            if not isinstance(value, (dict, list))
        }
        try:
            self.client.eval(
                self._REPLACE_LUA,
                4,
                self._companies_key,
                self._timestamps_key,
                self._meta_key,
                f"{self.key_prefix}/companies",
                json.dumps(incoming, ensure_ascii=False),
                json.dumps([str(item) for item in base_ids if item], ensure_ascii=False),
                json.dumps(meta, ensure_ascii=False),
                f"{self.key_prefix}:companies:*",
            )
        except Exception as exc:
            raise StorageUnavailable(f"覆盖写入已取消，没有改动现有数据: {exc}") from exc

    def write(self, data: dict[str, Any], replace: bool = False, base_ids: list[str] | None = None) -> None:
        self._migrate_blacklist_hash_if_needed()
        if replace:
            self._replace_with_lua(data, list(base_ids or []))
            return
        companies = data.get("companies", [])
        if any(not company.get("id") for company in companies):
            raise StorageUnavailable("有公司记录缺少 id，已取消写入")

        company_mapping = {
            str(company["id"]): json.dumps(company, ensure_ascii=False)
            for company in companies
        }

        company_key_type = self._key_type(self._companies_key)
        existing_fields = set(self.client.hkeys(self._companies_key)) if company_key_type == "hash" else set()
        if not replace and not existing_fields <= set(company_mapping):
            missing = len(existing_fields - set(company_mapping))
            raise StorageUnavailable(
                f"拒绝写入：还有 {missing} 条现有记录不在本次数据里，已取消以免覆盖"
            )
        if not replace and company_key_type not in {"none", "hash"}:
            raise StorageUnavailable("公司数据格式异常，已取消写入")

        stale_fields = existing_fields - set(company_mapping)

        pipeline = self.client.pipeline()
        if company_key_type not in {"none", "hash"}:
            pipeline.delete(self._companies_key)
        elif stale_fields:
            pipeline.hdel(self._companies_key, *stale_fields)

        if company_mapping:
            pipeline.hset(self._companies_key, mapping=company_mapping)
        else:
            pipeline.delete(self._companies_key)

        if self.data_hash_name == "items":
            pipeline.delete(self._legacy_companies_key)

        meta = data.get("meta", {})
        pipeline.delete(self._meta_key)
        if meta:
            pipeline.hset(self._meta_key, mapping={key: str(value) for key, value in meta.items()})

        # Update timestamps sorted set
        self._update_timestamps_index(companies, pipeline)

        pipeline.execute()

    def _read_company_hash(self) -> list[dict[str, Any]]:
        self._migrate_blacklist_hash_if_needed()
        keys_to_try = [self._companies_key]
        if self.data_hash_name == "items":
            keys_to_try.append(self._legacy_companies_key)

        companies: list[dict[str, Any]] = []
        skipped = 0
        found_hash = False
        for key in keys_to_try:
            if self._key_type(key) != "hash":
                continue
            found_hash = True
            # 用 HSCAN 分批拉取，避免 HGETALL 一次性超时（远程 Redis / 记录偏多时常见）
            for _field, raw in self.client.hscan_iter(key, count=self._scan_count):
                try:
                    item = json.loads(raw)
                except (TypeError, json.JSONDecodeError):
                    skipped += 1
                    continue
                if not isinstance(item, dict):
                    skipped += 1
                    continue
                companies.append(item)
            if companies:
                break
        if not found_hash:
            return []
        if skipped:
            raise StorageUnavailable(f"有 {skipped} 条公司记录无法解析，已停止操作，不会回写")
        return companies

    def _read_legacy_state(self) -> dict[str, Any]:
        for key in (self._companies_key, f"{self.key_prefix}/companies"):
            if self._key_type(key) != "string":
                continue
            try:
                raw_data = self.client.get(key)
                if not raw_data:
                    continue
                data = json.loads(raw_data)
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(data, dict):
                data.setdefault("companies", [])
                data.setdefault("meta", {})
                data.setdefault("settings", {})
                return data

        companies = []
        for key in self.client.scan_iter(f"{self.key_prefix}:companies:*"):
            try:
                if self._key_type(key) != "string":
                    continue
                raw_data = self.client.get(key)
                if not raw_data:
                    continue
                item = json.loads(raw_data)
            except Exception:
                continue
            if isinstance(item, dict):
                companies.append(item)

        return {
            "companies": companies,
            "meta": {},
            "settings": {},
        }

    def _key_type(self, key: str) -> str:
        key_type = self.client.type(key)
        if isinstance(key_type, bytes):
            return key_type.decode("utf-8")
        return str(key_type)

    @staticmethod
    def _default_data() -> dict[str, Any]:
        return {"companies": [], "meta": {}, "settings": {}}


class FallbackStorage:
    def __init__(self, primary: RedisStorage, fallback: JsonStorage) -> None:
        self.primary = primary
        self.fallback = fallback
        self._use_fallback = False
        self._tested = False
        self._last_probe_at = 0.0
        self._probe_interval_seconds = 30.0

    def _test_primary(self) -> bool:
        now = time.time()
        # 失败后定期再探测，避免一次超时后整进程永久不可用
        if self._tested and (now - self._last_probe_at) < self._probe_interval_seconds:
            return not self._use_fallback
        self._tested = True
        self._last_probe_at = now
        try:
            self.primary._call_with_retry(lambda: self.primary.client.ping())
            self._use_fallback = False
            return True
        except Exception:
            self._use_fallback = True
            return False

    def read(self) -> dict[str, Any]:
        try:
            if not self._test_primary():
                raise StorageUnavailable("读取数据库失败，已取消本次操作，不会回写")
            return _read_primary_or_raise(self.primary)
        except StorageUnavailable:
            _read_source.set("failed")
            # 允许下次请求重新探测 Redis
            self._last_probe_at = 0.0
            raise

    def write(self, data: dict[str, Any], replace: bool = False, base_ids: list[str] | None = None) -> None:
        _reject_failed_read_write()
        self.primary.write(data, replace=replace, base_ids=base_ids)

    def upsert_company(self, record: dict[str, Any], meta_updates: dict[str, Any] | None = None) -> None:
        _reject_failed_read_write()
        self.primary.upsert_company(record, meta_updates)

    def delete_company_record(self, company_id: str, meta_updates: dict[str, Any] | None = None) -> None:
        _reject_failed_read_write()
        self.primary.delete_company_record(company_id, meta_updates)

    @property
    def using_fallback(self) -> bool:
        return self._use_fallback


class QuickFallbackStorage:
    def __init__(self, primary: RedisStorage, fallback: JsonStorage) -> None:
        self.primary = primary
        self.fallback = fallback
        self._use_fallback = False

    def read(self) -> dict[str, Any]:
        try:
            data = _read_primary_or_raise(self.primary)
            self._use_fallback = False
            return data
        except StorageUnavailable:
            self._use_fallback = True
            raise

    def write(self, data: dict[str, Any], replace: bool = False, base_ids: list[str] | None = None) -> None:
        # 读失败得到的空数据/旧数据不能写回 Redis，也不能再当作本次保存的底稿。
        _reject_failed_read_write()
        self.primary.write(data, replace=replace, base_ids=base_ids)

    def upsert_company(self, record: dict[str, Any], meta_updates: dict[str, Any] | None = None) -> None:
        _reject_failed_read_write()
        self.primary.upsert_company(record, meta_updates)

    def delete_company_record(self, company_id: str, meta_updates: dict[str, Any] | None = None) -> None:
        _reject_failed_read_write()
        self.primary.delete_company_record(company_id, meta_updates)

    @property
    def using_fallback(self) -> bool:
        return self._use_fallback


def create_storage(
    config: dict[str, Any],
    *,
    data_hash_name: str = "companies",
) -> JsonStorage | RedisStorage | FallbackStorage:
    backend = config.get("STORAGE_BACKEND", "auto").strip().lower()
    if backend == "json":
        return JsonStorage(config["STORAGE_FILE"])

    redis_url = config.get("REDIS_URL", "").strip()
    json_path = config.get("STORAGE_FILE", "")

    if redis_url:
        redis_storage = RedisStorage(
            redis_url,
            config.get("REDIS_KEY_PREFIX", "jjob:tools102-boss-hire-tag:state"),
            float(config.get("REDIS_TIMEOUT_SECONDS", 5)),
            data_hash_name=data_hash_name,
        )
        if json_path:
            json_storage = JsonStorage(json_path)
            return QuickFallbackStorage(redis_storage, json_storage)
        return redis_storage

    if backend == "redis" and not redis_url:
        raise StorageUnavailable("STORAGE_BACKEND=redis 时必须配置 REDIS_URL")
    return JsonStorage(json_path or "data/companies.json")


class RedisProxyStore:
    def __init__(self, redis_url: str, proxy_key: str, timeout_seconds: float = 5) -> None:
        if redis is None:
            raise StorageUnavailable("redis 依赖未安装")
        self._client: redis.Redis | None = None
        self._url = redis_url
        self._key = proxy_key
        self._timeout = timeout_seconds

    @property
    def client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.Redis.from_url(
                self._url,
                decode_responses=True,
                socket_connect_timeout=self._timeout,
                socket_timeout=self._timeout,
            )
        return self._client

    def get_proxy(self) -> str:
        try:
            value = self.client.get(self._key)
            return value or ""
        except Exception:
            return ""

    def set_proxy(self, proxy_url: str) -> None:
        try:
            if proxy_url:
                self.client.set(self._key, proxy_url)
            else:
                self.client.delete(self._key)
        except Exception:
            pass


class RedisSettingsStore:
    def __init__(self, redis_url: str, settings_key: str, timeout_seconds: float = 5) -> None:
        if redis is None:
            raise StorageUnavailable("redis 依赖未安装")
        self._client: redis.Redis | None = None
        self._url = redis_url
        self._key = settings_key
        self._timeout = timeout_seconds
        self._cache: dict | None = None

    @property
    def client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.Redis.from_url(
                self._url,
                decode_responses=True,
                socket_connect_timeout=self._timeout,
                socket_timeout=self._timeout,
            )
        return self._client

    def get_settings(self) -> dict:
        if self._cache is not None:
            return self._cache
        try:
            raw = self.client.get(self._key)
            if raw:
                self._cache = json.loads(raw)
            else:
                self._cache = {"status_options": ["拒绝", "加微信", "在考虑"], "industry_options": ["棋牌", "游戏", "互联网"]}
        except Exception:
            self._cache = {"status_options": ["拒绝", "加微信", "在考虑"], "industry_options": ["棋牌", "游戏", "互联网"]}
        return self._cache

    def save_settings(self, settings: dict) -> dict:
        self._cache = settings
        try:
            self.client.set(self._key, json.dumps(settings, ensure_ascii=False))
        except Exception:
            pass
        return settings

    def clear_cache(self) -> None:
        self._cache = None
