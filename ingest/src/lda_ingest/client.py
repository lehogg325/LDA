"""HTTP client for the LDA API: auth, token-bucket pacing, retry with backoff.

Retry policy (per spec: exponential backoff with jitter on 429 and 5xx, log every retry):
- 429: sleep the server's Retry-After (however large) plus 0-5s jitter, drain the bucket,
  and retry without counting against the failure budget.
- 5xx / connect / timeout: exponential backoff min(120, 2*2^attempt) with full jitter,
  max 8 attempts, then PermanentFetchError.
- 404 with an "Invalid page." detail on page>1 raises PageGone: the caller treats it as
  end-of-partition (the result set shrank under us) rather than a failure.
- Other 4xx are programming errors: raise immediately.
"""

from __future__ import annotations

import logging
import random
import time
from typing import Any, Callable

import httpx

from .config import Config
from .ratelimit import TokenBucket

log = logging.getLogger("lda_ingest")

MAX_ATTEMPTS = 8

# Called with (url, http_status, attempt, slept_seconds, note) on every retry/anomaly.
RetryLogger = Callable[[str, int, int, float, str], None]


class PermanentFetchError(Exception):
    pass


class PageGone(Exception):
    """Requested page no longer exists (result set shrank)."""


class LdaClient:
    def __init__(self, config: Config, retry_logger: RetryLogger | None = None) -> None:
        headers = {"Accept": "application/json"}
        if config.api_key:
            headers["Authorization"] = f"Token {config.api_key}"
        self._http = httpx.Client(
            base_url=config.base_url, headers=headers, timeout=30.0, follow_redirects=True
        )
        self._bucket = TokenBucket(config.rate_per_sec)
        self._retry_logger = retry_logger or (lambda *a: None)
        self.authenticated = bool(config.api_key)

    def close(self) -> None:
        self._http.close()

    def get_json(self, path: str, params: dict[str, Any] | None = None) -> tuple[dict, str]:
        """Return (parsed_body, final_url). Blocks as long as needed to succeed."""
        attempt = 0
        while True:
            self._bucket.acquire()
            url = ""
            try:
                resp = self._http.get(path, params=params)
                url = str(resp.request.url)
                status = resp.status_code
            except httpx.HTTPError as exc:
                attempt += 1
                if attempt >= MAX_ATTEMPTS:
                    raise PermanentFetchError(f"{path}: {exc!r} after {attempt} attempts") from exc
                slept = min(120.0, 2.0 * 2**attempt) * random.random()
                self._retry_logger(path, 0, attempt, slept, f"network: {exc!r}")
                log.warning("network error on %s (attempt %d): %r; sleeping %.1fs", path, attempt, exc, slept)
                time.sleep(slept)
                continue

            if status == 200:
                return resp.json(), url

            if status == 429:
                retry_after = float(resp.headers.get("Retry-After", 60))
                slept = retry_after + random.uniform(0, 5)
                self._retry_logger(url, status, attempt, slept, "throttled")
                log.warning("429 on %s; honoring Retry-After=%.0fs (+jitter)", url, retry_after)
                time.sleep(slept)
                self._bucket.drain()
                continue  # 429 does not consume an attempt

            if status >= 500:
                attempt += 1
                if attempt >= MAX_ATTEMPTS:
                    raise PermanentFetchError(f"{url}: HTTP {status} after {attempt} attempts")
                slept = min(120.0, 2.0 * 2**attempt) * random.random()
                self._retry_logger(url, status, attempt, slept, "server error")
                log.warning("HTTP %d on %s (attempt %d); sleeping %.1fs", status, url, attempt, slept)
                time.sleep(slept)
                continue

            if status == 404 and params and int(params.get("page", 1)) > 1:
                raise PageGone(url)

            raise PermanentFetchError(f"{url}: unexpected HTTP {status}: {resp.text[:300]}")
