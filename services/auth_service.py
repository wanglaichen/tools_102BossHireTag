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
    ) -> None:
        self.redis_url = (redis_url or "").strip()
        self.key_prefix = (key_prefix or "jjob:tools102-boss-hire-tag:state").rstrip(":")
        self.timeout_seconds = timeout_seconds
        self.secret_key = secret_key or "tools102-boss-hire-tag-dev"
        self.wechat_appid = (wechat_appid or "").strip()
        self.wechat_secret = (wechat_secret or "").strip()
        self.session_ttl_seconds = session_ttl_seconds
        self.dev_token = (dev_token or "").strip()
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
                        return data
            except Exception:
                pass
        return self._memory.get(token)
