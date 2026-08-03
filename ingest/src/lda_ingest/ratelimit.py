"""Token-bucket rate limiter. Sized from config to whatever the API permits.
Thread-safe: one bucket is shared by all partition-worker threads, so the aggregate
request rate stays under the per-user quota no matter the concurrency."""

from __future__ import annotations

import threading
import time


class TokenBucket:
    def __init__(self, rate_per_sec: float, capacity: float = 5.0) -> None:
        self.rate = rate_per_sec
        self.capacity = capacity
        self._tokens = capacity
        self._last = time.monotonic()
        self._lock = threading.Lock()

    def _refill(self) -> None:
        now = time.monotonic()
        self._tokens = min(self.capacity, self._tokens + (now - self._last) * self.rate)
        self._last = now

    def acquire(self) -> None:
        """Block until one token is available, then consume it."""
        while True:
            with self._lock:
                self._refill()
                if self._tokens >= 1.0:
                    self._tokens -= 1.0
                    return
                wait = (1.0 - self._tokens) / self.rate
            time.sleep(wait)

    def drain(self) -> None:
        """Empty the bucket (called after a 429 so we restart slowly)."""
        with self._lock:
            self._refill()
            self._tokens = 0.0
