from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

try:
    import redis
except ImportError:  # pragma: no cover
    redis = None


class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 401) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class AuthService:
    """WeChat mini-program login + bearer token sessions stored in Redis (or memory)."""

    def __init__(
        self,
        *,
        redis_url: str,
        key_prefix: str,
        timeout_seconds: float,
        secret_key: str,
        wechat_appid: str,
        wechat_secret: str,
        session_ttl_seconds: int = 7 * 24 * 3600,
        dev_token: str = "",
        admin_username: str = "",
        admin_password: str = "",
    ) -> None:
        self.redis_url = (redis_url or "").strip()
        self.key_prefix = (key_prefix or "jjob:tools102-boss-hire-tag:state").rstrip(":")
        self.timeout_seconds = timeout_seconds
        self.secret_key = secret_key or "tools102-boss-hire-tag-dev"
        self.wechat_appid = (wechat_appid or "").strip()
        self.wechat_secret = (wechat_secret or "").strip()
        self.session_ttl_seconds = max(24 * 3600, int(session_ttl_seconds or 0))
        self.dev_token = (dev_token or "").strip()
        self.admin_username = (admin_username or "").strip().lower()
        self.admin_password = admin_password or ""
        self._client: Any = None
        self._memory: dict[str, dict[str, Any]] = {}

    @property
    def _sessions_key(self) -> str:
        return f"{self.key_prefix}:auth:sessions"

    @property
    def client(self):
        if not self.redis_url or redis is None:
            return None
        if self._client is None:
            self._client = redis.Redis.from_url(
                self.redis_url,
                decode_responses=True,
                socket_connect_timeout=self.timeout_seconds,
                socket_timeout=self.timeout_seconds,
            )
        return self._client

    def login_with_code(self, code: str) -> dict[str, Any]:
        code = (code or "").strip()
        if not code:
            raise AuthError("缺少 code", 400)

        if code == "dev" and self.dev_token:
            token = self._issue_token(openid="dev-user", source="dev-code")
            return {"token": token, "user": {"openid": "dev-user", "source": "dev-code"}}

        openid = self._exchange_code_for_openid(code)
        token = self._issue_token(openid=openid, source="wechat")
        return {"token": token, "user": {"openid": openid, "source": "wechat"}}

    def resolve_bearer(self, authorization_header: str | None) -> dict[str, Any] | None:
        if not authorization_header:
            return None
        parts = authorization_header.strip().split(None, 1)
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return None
        token = parts[1].strip()
        if not token:
            return None

        if self.dev_token and hmac.compare_digest(token, self.dev_token):
            return {"openid": "dev-token", "source": "dev-token", "token": token}

        session = self._get_session(token)
        if not session:
            return None
        return session

    def require_user(self, authorization_header: str | None) -> dict[str, Any]:
        user = self.resolve_bearer(authorization_header)
        if not user:
            raise AuthError("未登录或 Token 无效")
        return user

    def _exchange_code_for_openid(self, code: str) -> str:
        if not self.wechat_appid or not self.wechat_secret:
            raise AuthError("服务端未配置 WECHAT_APPID / WECHAT_SECRET", 500)

        query = urllib.parse.urlencode(
            {
                "appid": self.wechat_appid,
                "secret": self.wechat_secret,
                "js_code": code,
                "grant_type": "authorization_code",
            }
        )
        url = f"https://api.weixin.qq.com/sns/jscode2session?{query}"
        try:
            with urllib.request.urlopen(url, timeout=8) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise AuthError(f"微信登录失败: {exc}", 502) from exc

        openid = payload.get("openid")
        if not openid:
            errcode = payload.get("errcode")
            errmsg = payload.get("errmsg") or "未知错误"
            raise AuthError(f"微信登录失败({errcode}): {errmsg}", 401)
        return str(openid)

    def _issue_token(self, *, openid: str, source: str) -> str:
        raw = f"{openid}:{time.time()}:{secrets.token_urlsafe(24)}"
        digest = hmac.new(self.secret_key.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
        token = f"mp_{digest[:40]}_{secrets.token_urlsafe(12)}"
        session = {
            "openid": openid,
            "source": source,
            "token": token,
            "created_at": int(time.time()),
        }
        self._save_session(token, session)
        return token

    def _save_session(self, token: str, session: dict[str, Any]) -> None:
        client = self.client
        if client is None:
            self._memory[token] = session
            return
        try:
            client.hset(self._sessions_key, token, json.dumps(session, ensure_ascii=False))
            client.expire(self._sessions_key, self.session_ttl_seconds)
        except Exception:
            self._memory[token] = session

    def _get_session(self, token: str) -> dict[str, Any] | None:
        client = self.client
        if client is not None:
            try:
                raw = client.hget(self._sessions_key, token)
                if raw:
                    data = json.loads(raw)
                    if isinstance(data, dict):
                        try:
                            client.expire(self._sessions_key, self.session_ttl_seconds)
                        except Exception:
                            pass
                        return data
            except Exception:
                pass
        return self._memory.get(token)

    def ensure_default_admin(self) -> dict[str, Any] | None:
        import re

        name = self.admin_username
        password = self.admin_password
        if not re.fullmatch(r"[a-zA-Z0-9_.-]{2,32}", name or ""):
            raise ValueError("ADMIN_USERNAME 无效，仅支持 2-32 位字母、数字、下划线、点、横线")
        if len(password) < 2:
            raise ValueError("ADMIN_PASSWORD 至少 2 个字符")

        admin = self.find_user_by_username(name)
        if not admin:
            admin = self.create_user(
                username=name,
                password=password,
                display_name="管理员",
                role="admin",
                source="system",
                legacy_store=True,
            )
            return admin

        changed = False
        if admin.get("role") != "admin":
            admin["role"] = "admin"
            changed = True
        if not admin.get("legacyStore"):
            admin["legacyStore"] = True
            changed = True
        if admin.get("locked"):
            admin["locked"] = False
            changed = True
        if not self.verify_password(password, admin.get("passwordHash")):
            admin["passwordHash"] = self.hash_password(password)
            changed = True
        if changed:
            admin["updatedAt"] = self._now_iso()
            self.write_user(admin)
        return admin

    def create_user(
        self,
        *,
        username: str,
        password: str,
        display_name: str | None = None,
        role: str = "user",
        source: str = "admin",
        legacy_store: bool = False,
    ) -> dict[str, Any]:
        import re
        from uuid import uuid4

        name = str(username or "").strip().lower()
        if not re.fullmatch(r"[a-zA-Z0-9_.-]{2,32}", name):
            raise ValueError("用户名仅支持 2-32 位字母、数字、下划线、点、横线")
        if len(str(password or "")) < 2:
            raise ValueError("密码至少 2 个字符")
        if self.find_user_by_username(name):
            raise ValueError("用户名已存在")

        now = self._now_iso()
        user = {
            "id": str(uuid4()),
            "username": name,
            "passwordHash": self.hash_password(str(password)),
            "displayName": str(display_name or name).strip() or name,
            "role": "admin" if role == "admin" else "user",
            "source": source if source in {"system", "admin", "self", "wechat"} else "admin",
            "locked": False,
            "legacyStore": bool(legacy_store),
            "createdAt": now,
            "updatedAt": now,
        }
        self.write_user(user)
        client = self.client
        if client is not None:
            try:
                client.sadd(self._user_index_key(), user["id"])
            except Exception:
                pass
        else:
            ids = self._memory_user_ids()
            if user["id"] not in ids:
                ids.append(user["id"])
                self._memory["__user_ids__"] = ids
        return user

    def register_account(self, username: str, password: str, display_name: str | None = None) -> dict[str, Any]:
        user = self.create_user(
            username=username,
            password=password,
            display_name=display_name,
            role="user",
            source="self",
        )
        session = self.create_session(user["id"])
        return {"token": session["token"], "expiresAt": session["expiresAt"], "user": self.public_user(user)}

    def login_with_password(self, username: str, password: str) -> dict[str, Any]:
        name = str(username or "").strip().lower()
        user = self.find_user_by_username(name)
        if not user or not self.verify_password(str(password or ""), user.get("passwordHash")):
            raise AuthError("用户名或密码错误", 401)
        if self._is_locked(user):
            raise AuthError("账号已锁定，请联系管理员", 403)
        session = self.create_session(user["id"])
        return {"token": session["token"], "expiresAt": session["expiresAt"], "user": self.public_user(user)}

    def require_account(self, authorization_header: str | None) -> dict[str, Any]:
        token = self._bearer_token(authorization_header)
        if not token:
            raise AuthError("未登录")
        user_id = self.resolve_session(token)
        user = self.read_user(user_id) if user_id else None
        if not user:
            wechat = self.resolve_bearer(authorization_header)
            openid = (wechat or {}).get("openid")
            if openid:
                user = self.ensure_wechat_user(str(openid))
        if not user:
            raise AuthError("未登录或 Token 无效")
        if self._is_locked(user):
            raise AuthError("账号已锁定，请联系管理员", 403)
        return user

    def change_password(self, user_id: str, old_password: str, new_password: str) -> dict[str, Any]:
        user = self.read_user(user_id)
        if not user:
            raise AuthError("用户不存在", 404)
        if not self.verify_password(str(old_password or ""), user.get("passwordHash")):
            raise AuthError("旧密码错误", 400)
        if len(str(new_password or "")) < 2:
            raise ValueError("新密码至少 2 个字符")
        user["passwordHash"] = self.hash_password(str(new_password))
        user["updatedAt"] = self._now_iso()
        self.write_user(user)
        return self.public_user(user)

    def update_user(self, actor: dict[str, Any], user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        target = self.read_user(user_id)
        if not target:
            raise AuthError("用户不存在", 404)
        is_admin = actor.get("role") == "admin"
        is_self = actor.get("id") == user_id
        if not is_admin and not is_self:
            raise AuthError("无权修改该用户", 403)
        if payload.get("password"):
            # 参考 ChenLab：管理员可直接重置任意账号密码；本人仍建议走 change-password
            if not is_admin and not is_self:
                raise AuthError("无权修改该用户密码", 403)
            if not is_admin and is_self:
                raise AuthError("请使用修改密码接口并提供旧密码", 400)
            if len(str(payload["password"])) < 2:
                raise ValueError("密码至少 2 个字符")
            target["passwordHash"] = self.hash_password(str(payload["password"]))
        if "displayName" in payload:
            target["displayName"] = str(payload.get("displayName") or "").strip() or target["username"]
        if "role" in payload and is_admin and user_id != actor.get("id"):
            target["role"] = "admin" if payload.get("role") == "admin" else "user"
            if target["role"] == "admin":
                target["locked"] = False
        if "locked" in payload:
            if not is_admin:
                raise AuthError("仅管理员可锁定账号", 403)
            if target.get("role") == "admin" or user_id == actor.get("id"):
                raise ValueError("不能锁定管理员或当前登录账号")
            target["locked"] = bool(payload.get("locked"))
        target["updatedAt"] = self._now_iso()
        self.write_user(target)
        return self.public_user(target)

    def delete_user(self, actor: dict[str, Any], user_id: str) -> None:
        if actor.get("role") != "admin":
            raise AuthError("仅管理员可删除账号", 403)
        if user_id == actor.get("id"):
            raise ValueError("不能删除当前登录账号")
        target = self.read_user(user_id)
        if not target:
            raise AuthError("用户不存在", 404)
        if target.get("legacyStore"):
            raise ValueError("不能删除默认管理员账号")
        client = self.client
        if client is not None:
            client.hdel(self._users_key(), user_id)
            client.hdel(self._users_by_name_key(), target["username"])
            client.srem(self._user_index_key(), user_id)
            return
        self._memory.pop(f"user:{user_id}", None)
        by_name = self._memory.setdefault("__byname__", {})
        by_name.pop(target["username"], None)
        self._memory["__user_ids__"] = [item for item in self._memory_user_ids() if item != user_id]

    def list_users(self) -> list[dict[str, Any]]:
        users = []
        for user_id in self.read_user_ids():
            user = self.read_user(user_id)
            if user:
                users.append(self.public_user(user))
        users.sort(key=lambda item: item["username"])
        return users

    def public_user(self, user: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": user["id"],
            "username": user["username"],
            "displayName": user.get("displayName") or user["username"],
            "role": user.get("role") or "user",
            "source": user.get("source") or "admin",
            "locked": self._is_locked(user),
            "legacyStore": bool(user.get("legacyStore")),
            "createdAt": user.get("createdAt"),
            "updatedAt": user.get("updatedAt"),
        }

    def find_user_by_username(self, username: str) -> dict[str, Any] | None:
        client = self.client
        if client is not None:
            try:
                user_id = client.hget(self._users_by_name_key(), username)
                return self.read_user(user_id) if user_id else None
            except Exception:
                pass
        user_id = self._memory.get("__byname__", {}).get(username)
        return self.read_user(user_id) if user_id else None

    def read_user(self, user_id: str | None) -> dict[str, Any] | None:
        if not user_id:
            return None
        client = self.client
        if client is not None:
            try:
                raw = client.hget(self._users_key(), user_id)
                if raw:
                    data = json.loads(raw)
                    if isinstance(data, dict):
                        return data
            except Exception:
                pass
        data = self._memory.get(f"user:{user_id}")
        return data if isinstance(data, dict) else None

    def write_user(self, user: dict[str, Any]) -> None:
        client = self.client
        payload = json.dumps(user, ensure_ascii=False)
        if client is not None:
            try:
                client.hset(self._users_key(), user["id"], payload)
                client.hset(self._users_by_name_key(), user["username"], user["id"])
                return
            except Exception:
                pass
        self._memory[f"user:{user['id']}"] = user
        by_name = self._memory.setdefault("__byname__", {})
        by_name[user["username"]] = user["id"]

    def read_user_ids(self) -> list[str]:
        client = self.client
        if client is not None:
            try:
                return [str(item) for item in client.smembers(self._user_index_key())]
            except Exception:
                pass
        return list(self._memory_user_ids())

    def create_session(self, user_id: str) -> dict[str, Any]:
        token = secrets.token_hex(32)
        expires_at = int(time.time()) + self.session_ttl_seconds
        client = self.client
        if client is not None:
            try:
                client.set(self._account_session_key(token), user_id, ex=self.session_ttl_seconds)
            except Exception:
                self._memory[f"session:{token}"] = {"userId": user_id, "expiresAt": expires_at}
        else:
            self._memory[f"session:{token}"] = {"userId": user_id, "expiresAt": expires_at}
        return {"token": token, "expiresAt": expires_at}

    def resolve_session(self, token: str | None) -> str | None:
        if not token:
            return None
        client = self.client
        if client is not None:
            try:
                key = self._account_session_key(token)
                user_id = client.get(key)
                if user_id:
                    # 滑动续期：有有效请求就重新计时，闲置满一天也不应半途掉线
                    try:
                        client.expire(key, self.session_ttl_seconds)
                    except Exception:
                        pass
                    return str(user_id)
            except Exception:
                pass
        cached = self._memory.get(f"session:{token}")
        if isinstance(cached, dict) and cached.get("expiresAt", 0) > int(time.time()):
            cached["expiresAt"] = int(time.time()) + self.session_ttl_seconds
            self._memory[f"session:{token}"] = cached
            return str(cached.get("userId") or "")
        return None

    def delete_session(self, token: str | None) -> None:
        if not token:
            return
        client = self.client
        if client is not None:
            try:
                client.delete(self._account_session_key(token))
            except Exception:
                pass
        self._memory.pop(f"session:{token}", None)

    def ensure_wechat_user(self, openid: str) -> dict[str, Any]:
        import hashlib

        digest = hashlib.sha256(openid.encode("utf-8")).hexdigest()[:20]
        username = f"wx_{digest}"
        existing = self.find_user_by_username(username)
        if existing:
            return existing
        return self.create_user(
            username=username,
            password=secrets.token_urlsafe(18),
            display_name="微信用户",
            role="user",
            source="wechat",
        )

    def _users_key(self) -> str:
        return f"{self.key_prefix}:users"

    def _users_by_name_key(self) -> str:
        return f"{self.key_prefix}:users:byname"

    def _user_index_key(self) -> str:
        return f"{self.key_prefix}:user:index"

    def _account_session_key(self, token: str) -> str:
        return f"{self.key_prefix}:session:{token}"

    def _memory_user_ids(self) -> list[str]:
        value = self._memory.get("__user_ids__")
        return list(value) if isinstance(value, list) else []

    @staticmethod
    def hash_password(password: str, salt: str | None = None) -> str:
        import hashlib

        if salt is None:
            salt = secrets.token_hex(16)
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt.encode("utf-8"),
            n=16384,
            r=8,
            p=1,
            dklen=64,
            maxmem=64 * 1024 * 1024,
        )
        return f"{salt}:{digest.hex()}"

    @classmethod
    def verify_password(cls, password: str, stored: str | None) -> bool:
        if not stored or ":" not in stored:
            return False
        salt, expected = stored.split(":", 1)
        if not salt or not expected:
            return False
        try:
            _, actual = cls.hash_password(password, salt).split(":", 1)
            return secrets.compare_digest(actual, expected)
        except Exception:
            return False

    @staticmethod
    def _is_locked(user: dict[str, Any] | None) -> bool:
        value = (user or {}).get("locked")
        return value is True or value in {1, "1", "true", "yes"}

    @staticmethod
    def _now_iso() -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    @staticmethod
    def _bearer_token(authorization_header: str | None) -> str:
        if not authorization_header:
            return ""
        parts = authorization_header.strip().split(None, 1)
        if len(parts) != 2 or parts[0].lower() != "bearer":
            return ""
        return parts[1].strip()
