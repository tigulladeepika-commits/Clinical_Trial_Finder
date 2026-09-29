from __future__ import annotations

import threading
import time
from typing import Any, Optional

_TTL_SECONDS = 30 * 60

_cache: dict[tuple[str, str], tuple[dict[str, Any], float]] = {}
_lock = threading.Lock()


def _is_expired(timestamp: float) -> bool:
    return (time.monotonic() - timestamp) > _TTL_SECONDS


def get(npi: str, disease: str) -> Optional[dict[str, Any]]:
    entry = _cache.get((npi, disease or ""))
    if entry is None:
        return None
    data, timestamp = entry
    if _is_expired(timestamp):
        with _lock:
            _cache.pop((npi, disease or ""), None)
        return None
    return data


def exists(npi: str, disease: str) -> bool:
    return get(npi, disease) is not None


def set(npi: str, disease: str, data: dict[str, Any]) -> None:
    if not npi:
        return
    with _lock:
        _cache[(npi, disease or "")] = (data, time.monotonic())


def invalidate(npi: str, disease: str) -> None:
    """Remove a specific cache entry so the next request triggers a fresh enrichment."""
    with _lock:
        _cache.pop((npi, disease or ""), None)


def invalidate_all(npi: str) -> None:
    """Remove ALL cache entries for a given NPI (all disease keys)."""
    with _lock:
        keys_to_remove = [k for k in _cache if k[0] == npi]
        for k in keys_to_remove:
            _cache.pop(k, None)


def is_from_background(npi: str, disease: str) -> bool:
    """
    Return True if the cached result was written by background enrichment
    (i.e. it is older than 5 seconds — direct hits are always fresh).
    Used by the insights endpoint to decide whether to re-enrich.
    """
    entry = _cache.get((npi, disease or ""))
    if entry is None:
        return False
    _, timestamp = entry
    # Background results are written ~3s after the search page loads.
    # A direct insights click arrives at least 5s later in practice.
    # If the entry is older than 5s it was almost certainly from background.
    age = time.monotonic() - timestamp
    return age > 5.0


def size() -> int:
    return len(_cache)
