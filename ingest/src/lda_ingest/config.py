"""Environment-driven configuration. Reads .env from the current directory if present;
real environment variables take precedence. The API key is never stored in code or git."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BASE_URL = "https://lda.gov/api/v1/"
PAGE_SIZE = 25  # hard API maximum, verified 2026-08-03

KEYED_RATE_PER_SEC = 1.9  # 5% headroom under 120/min
ANON_RATE_PER_SEC = 0.23  # headroom under 15/min
PAGES_PER_PART = 40  # commit unit: ~1,000 records, ~3 MB uncompressed


def _read_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip("'\"")
    return values


@dataclass
class Config:
    api_key: str | None
    data_dir: Path
    base_url: str = BASE_URL
    pages_per_part: int = PAGES_PER_PART

    raw_dir: Path = field(init=False)
    manifest_path: Path = field(init=False)
    log_dir: Path = field(init=False)

    def __post_init__(self) -> None:
        self.raw_dir = self.data_dir / "raw"
        self.manifest_path = self.data_dir / "manifest.sqlite"
        self.log_dir = self.data_dir / "logs"

    @property
    def rate_per_sec(self) -> float:
        return KEYED_RATE_PER_SEC if self.api_key else ANON_RATE_PER_SEC


def load_config() -> Config:
    dotenv = _read_dotenv(Path.cwd() / ".env")
    env = {**dotenv, **os.environ}
    api_key = env.get("LDA_API_KEY") or None
    data_dir = Path(env.get("LDA_DATA_DIR", "./data")).resolve()
    return Config(api_key=api_key, data_dir=data_dir)
