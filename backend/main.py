"""
main.py
Clintrial Navigator V3 — FastAPI application entry point.

Mounts:
  /api/trials           — ClinicalTrials.gov search + detail (V2)
  /api/physicians       — NPPES physician search (V5)
  /api/leads            — Lead capture
  /api/physicians       — PubMed publications (/{npi}/publications)

Startup:
  - Validates configuration
  - Initialises taxonomy (background thread)
  - Initialises ZIP database

CORS v3:
  - Always apply regex-based CORS regardless of IS_RENDER flag.
  - FRONTEND_URL env var adds an exact origin on top of the regex (additive,
    not exclusive) so custom domains work without breaking preview deploys.
  - Local dev origins always included.
  - Removed the exclusive FRONTEND_URL branch that was silently blocking
    all other origins (the root cause of the CORS failure in production).
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Load .env before importing anything that reads cfg
load_dotenv(Path(__file__).with_name(".env"))

from core.config import cfg, validate_configuration  # noqa: E402
from api import physicians as physicians_router_module  # noqa: E402
from api import leads as leads_router_module            # noqa: E402
from api import publications as publications_router_module  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


# ── Startup / shutdown ────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # --- startup ---
    missing = validate_configuration()
    if missing:
        logger.warning("Missing env vars: %s", ", ".join(missing))

    from services import taxonomy
    taxonomy.initialize()
    logger.info("Taxonomy initializing (seed ready immediately)")

    from services import zip_database
    zip_database.initialize(background=not cfg.ZIP_LOAD_SYNC)
    logger.info("ZIP DB initializing (sync=%s)", cfg.ZIP_LOAD_SYNC)

    logger.info("Clintrial Navigator V3 ready on port %d", cfg.PORT)
    yield
    # --- shutdown ---


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Clintrial Navigator API",
    version="3.0.0",
    description="Clinical trial discovery + physician search",
    lifespan=lifespan,
)


# ── CORS ──────────────────────────────────────────────────────────────────────
#
# Strategy (v3 — always-on regex, no exclusive branch):
#
#   allow_origins  — explicit list covering:
#     • FRONTEND_URL env var (if set — e.g. a custom production domain)
#     • The known Vercel production URL (belt-and-suspenders)
#     • Local dev ports
#
#   allow_origin_regex — covers ALL dynamic/preview origins:
#     • Any Vercel preview deploy:  https://clinical-trial-finder-*.vercel.app
#     • Salesforce Experience Cloud, my.site.com, force.com, lightning.force.com
#
#   Both lists are evaluated — a request passes if it matches EITHER.
#   This means adding FRONTEND_URL never accidentally blocks other origins.
#
# Why the old code broke:
#   When FRONTEND_URL was set, the middleware was configured with ONLY that
#   one exact origin and the regex was never applied, so every other origin
#   (including Vercel preview URLs) was rejected with a CORS error.

_EXPLICIT_ORIGINS: list[str] = [
    # Local development
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:8080",
    # Known production Vercel URL (hard-coded as safety net)
    "https://clinical-trial-finder-chi.vercel.app",
]

# Add FRONTEND_URL from env if present (custom domain, staging URL, etc.)
_frontend_url = os.getenv("FRONTEND_URL", "").strip().rstrip("/")
if _frontend_url and _frontend_url not in _EXPLICIT_ORIGINS:
    _EXPLICIT_ORIGINS.append(_frontend_url)
    logger.info("CORS: added FRONTEND_URL origin → %s", _frontend_url)

# Regex covers dynamic Vercel preview deploys + Salesforce platforms
_CORS_REGEX = (
    # All Vercel deploys for this project (production + any preview slug)
    r"https://clinical-trial-finder[a-z0-9\-]*\.vercel\.app"
    # Salesforce Experience Cloud
    r"|https://[a-zA-Z0-9\-]+\.preview\.salesforce-experience\.com"
    r"|https://[a-zA-Z0-9\-]+\.salesforce-experience\.com"
    # Salesforce custom domain / legacy domains
    r"|https://[a-zA-Z0-9\-]+\.my\.site\.com"
    r"|https://[a-zA-Z0-9\-]+\.force\.com"
    r"|https://[a-zA-Z0-9\-]+\.lightning\.force\.com"
)

logger.info("CORS: explicit origins=%s", _EXPLICIT_ORIGINS)
logger.info("CORS: regex=%s", _CORS_REGEX)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_EXPLICIT_ORIGINS,
    allow_origin_regex=_CORS_REGEX,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
    expose_headers=["X-Total-Count"],   # useful for pagination headers
    max_age=600,                         # cache preflight for 10 min
)


# ── Validation error handler ──────────────────────────────────────────────────

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    body_bytes = await request.body()
    try:
        body_text = body_bytes.decode("utf-8")
    except Exception:
        body_text = repr(body_bytes)

    errors = exc.errors()
    logger.error(
        "422 Validation error | path=%s | body=%s | errors=%s",
        request.url.path,
        body_text,
        errors,
    )
    return JSONResponse(
        status_code=422,
        content={"detail": errors},
    )


# ── Routers ───────────────────────────────────────────────────────────────────

try:
    from api.trials import router as trials_router
except ImportError:
    from trials import router as trials_router  # type: ignore[no-redef]

app.include_router(trials_router,                        prefix="/api/trials",      tags=["trials"])
app.include_router(physicians_router_module.router,       prefix="/api/physicians",  tags=["physicians"])
app.include_router(leads_router_module.router,            prefix="/api/leads",       tags=["leads"])
# Publications router mounted under /api/physicians so the URL is
# /api/physicians/{npi}/publications — consistent with the physician resource
app.include_router(publications_router_module.router,     prefix="/api/physicians",  tags=["publications"])


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["meta"])
async def health() -> dict:
    from services import taxonomy, zip_database
    return {
        "status":           "ok",
        "taxonomy_source":  taxonomy.source(),
        "taxonomy_count":   taxonomy.count(),
        "zip_db_ready":     zip_database.is_ready(),
        "cors_origins":     _EXPLICIT_ORIGINS,
    }