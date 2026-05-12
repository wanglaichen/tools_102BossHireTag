import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"


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


def apply_process_proxy() -> None:
    proxy_url = os.getenv("APP_PROXY_URL", "").strip()
    if not proxy_url:
        return

    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        os.environ.setdefault(name, proxy_url)
        os.environ.setdefault(name.lower(), proxy_url)


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
    SECRET_KEY = os.getenv("SECRET_KEY", "tools102-boss-hire-tag-dev")
    APP_HOST = os.getenv("APP_HOST", "0.0.0.0")
    APP_PORT = int(os.getenv("APP_PORT", os.getenv("PORT", "9212")))
    DATA_DIR = str(DATA_PATH)
    STORAGE_FILE = str(DATA_PATH / "companies.json")
    REDIS_URL = os.getenv("REDIS_URL", "")
    REDIS_KEY_PREFIX = os.getenv("REDIS_KEY_PREFIX", "jjob/tools102-boss-hire-tag")
    APP_PROXY_URL = os.getenv("APP_PROXY_URL", "")
