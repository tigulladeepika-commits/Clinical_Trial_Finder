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


def size() -> int:
    return len(_cache)
