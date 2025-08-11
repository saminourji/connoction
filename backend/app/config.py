import os
from typing import List
from pathlib import Path

from dotenv import load_dotenv

# Load only the single project-root .env
_here = Path(__file__).resolve()
_project_root = _here.parents[2]
load_dotenv(dotenv_path=_project_root / ".env", override=True)


def get_env_list(name: str, default: str = "") -> List[str]:
    raw = os.getenv(name, default)
    return [s.strip() for s in raw.split(",") if s.strip()]


NOTION_API_KEY: str | None = os.getenv("NOTION_API_KEY")
NOTION_DATABASE_ID: str | None = os.getenv("NOTION_DATABASE_ID")
OPENAI_API_KEY: str | None = os.getenv("OPENAI_API_KEY")
EMAIL_PROVIDER: str = os.getenv("EMAIL_PROVIDER", "").lower()

ALLOWED_ORIGINS: List[str] = get_env_list(
    "ALLOWED_ORIGINS", "http://127.0.0.1:8000,chrome-extension://*"
)

BACKEND_BASE_URL: str = os.getenv("BACKEND_BASE_URL", "http://127.0.0.1:8000") 