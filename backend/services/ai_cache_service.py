from __future__ import annotations

import threading
from typing import Any, Optional

_cache: dict[tuple[str, str], dict[str, Any]] = {}
_lock = threading.Lock()


def get(npi: str, disease: str) -> Optional[dict[str, Any]]:
    return _cache.get((npi, disease or ""))


def exists(npi: str, disease: str) -> bool:
    return (npi, disease or "") in _cache


def set(npi: str, disease: str, data: dict[str, Any]) -> None:
    if not npi:
        return
    with _lock:
        _cache[(npi, disease or "")] = data


def size() -> int:
    return len(_cache)
