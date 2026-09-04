import json
import os
import threading
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"
SETTINGS_FILE = BASE_DIR / "data" / "settings.json"


def load_env_file(path: Path = ENV_FILE) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


load_env_file()


def load_settings() -> dict:
    if not SETTINGS_FILE.exists():
        return {}
    try:
        with SETTINGS_FILE.open("r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_settings(settings: dict) -> None:
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with SETTINGS_FILE.open("w", encoding="utf-8") as f:
        json.dump(settings, f, ensure_ascii=False, indent=2)


def apply_process_proxy() -> None:
    proxy_url = os.getenv("APP_PROXY_URL", "").strip()
    if not proxy_url:
        return

    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        os.environ.setdefault(name, proxy_url)
        os.environ.setdefault(name.lower(), proxy_url)


def apply_proxy_from_settings() -> None:
    settings = load_settings()
    proxy_url = settings.get("proxy_url", "").strip()
    if proxy_url:
        os.environ["APP_PROXY_URL"] = proxy_url
        for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
            os.environ[name] = proxy_url
            os.environ[name.lower()] = proxy_url


apply_proxy_from_settings()
apply_process_proxy()


def resolve_data_path() -> Path:
    configured_path = os.getenv("DATA_DIR")
    if configured_path:
        return Path(configured_path)
    if os.getenv("VERCEL"):
        return Path("/tmp/tools102-boss-hire-tag")
    return BASE_DIR / "data"


DATA_PATH = resolve_data_path()


class AppConfig:
    APP_VERSION = os.getenv("APP_VERSION", "v1.0.39")
    SECRET_KEY = os.getenv("SECRET_KEY", "tools102-boss-hire-tag-dev")
    APP_HOST = os.getenv("APP_HOST", "0.0.0.0")
    APP_PORT = int(os.getenv("APP_PORT", os.getenv("PORT", "9212")))
    DATA_DIR = str(DATA_PATH)
    STORAGE_FILE = str(DATA_PATH / "companies.json")
    STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "auto")
    REDIS_URL = os.getenv("REDIS_URL", "")
    REDIS_KEY_PREFIX = os.getenv("REDIS_KEY_PREFIX", "jjob:tools102-boss-hire-tag:state")
    REDIS_PROXY_KEY = os.getenv("REDIS_PROXY_KEY", "jjob:tools102-boss-hire-tag:proxy")
    REDIS_SETTINGS_KEY = os.getenv("REDIS_SETTINGS_KEY", "jjob:tools102-boss-hire-tag:settings")
    REDIS_TIMEOUT_SECONDS = float(os.getenv("REDIS_TIMEOUT_SECONDS", "5"))
    APP_PROXY_URL = os.getenv("APP_PROXY_URL", "")
