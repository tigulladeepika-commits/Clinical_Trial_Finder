"""
Rate limiting service for FastAPI endpoints.
Uses an in-memory, thread-safe limiter and path-based rate limits.
"""

import logging
import threading
import time
from typing import Callable

from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.status import HTTP_429_TOO_MANY_REQUESTS

from core.config import cfg
from core.helpers import RateLimiter

logger = logging.getLogger(__name__)

_rate_limiter = RateLimiter()


def start_rate_limiter_purge() -> None:
    """Start a background thread that periodically purges expired rate limit entries."""
    def _run_rl_purge() -> None:
        while True:
            time.sleep(300)
            try:
                _rate_limiter.purge_old()
            except Exception as exc:
                logger.warning("Rate limiter purge failed: %s", exc)

    threading.Thread(target=_run_rl_purge, daemon=True, name="rl-purge").start()


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _route_key(path: str) -> str:
    if path.startswith("/api/leads"):
        return "api_leads"
    if path.startswith("/api/trials"):
        return "api_trials"
    if path.startswith("/api/physicians"):
        return "api_physicians"
    if path.startswith("/api/apollo"):
        return "api_apollo"
    return "api_other"


def _limit_for_route(route_key: str) -> int:
    if route_key == "api_leads":
        return cfg.RATE_LIMIT_LEAD
    if route_key in ("api_trials", "api_physicians"):
        return cfg.RATE_LIMIT_SEARCH
    if route_key == "api_apollo":
        return cfg.RATE_LIMIT_AC
    return cfg.RATE_LIMIT_SEARCH


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable):
        ip = _get_client_ip(request)
        route_key = _route_key(request.url.path)
        limit = _limit_for_route(route_key)

        if not _rate_limiter.is_allowed((ip, route_key), limit, cfg.RATE_LIMIT_WINDOW):
            logger.warning(
                "Rate limit exceeded | ip=%s route=%s limit=%d window=%ds",
                ip,
                route_key,
                limit,
                cfg.RATE_LIMIT_WINDOW,
            )
            return JSONResponse(
                status_code=HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": "Too many requests. Please slow down.",
                    "code": "RATE_LIMITED",
                },
                headers={"Retry-After": str(cfg.RATE_LIMIT_WINDOW)},
            )

        response = await call_next(request)
        return response


def register_rate_limiter(app: FastAPI) -> None:
    app.add_middleware(RateLimitMiddleware)
    logger.info("Rate limiting middleware registered")
