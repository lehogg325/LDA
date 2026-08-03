"""Token-bucket rate limiter. Sized from config to whatever the API permits."""

from __future__ import annotations

import time


class TokenBucket:
    def __init__(self, rate_per_sec: float, capacity: float = 5.0) -> None:
        self.rate = rate_per_sec
        self.capacity = capacity
        self._tokens = capacity
        self._last = time.monotonic()

    def _refill(self) -> None:
        now = time.monotonic()
        self._tokens = min(self.capacity, self._tokens + (now - self._last) * self.rate)
        self._last = now

    def acquire(self) -> None:
        """Block until one token is available, then consume it."""
        self._refill()
        if self._tokens < 1.0:
            time.sleep((1.0 - self._tokens) / self.rate)
            self._refill()
        self._tokens -= 1.0

    def drain(self) -> None:
        """Empty the bucket (called after a 429 so we restart slowly)."""
        self._refill()
        self._tokens = 0.0
