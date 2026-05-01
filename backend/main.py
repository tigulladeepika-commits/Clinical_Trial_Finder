"""
main.py
Clintrial Navigator V3 — FastAPI application entry point.

Mounts:
  /api/trials       — ClinicalTrials.gov search + detail (V2)
  /api/physicians   — NPPES physician search (V1 → V3)
  /api/leads        — Lead capture (new in V3)

Startup:
  - Validates configuration
  - Initialises taxonomy (background thread — seeds immediately, upgrades async)
  - Initialises ZIP database (sync on Render, background locally)

CORS v2:
  - Added Salesforce Experience Cloud origin pattern so the app works when
    embedded in an SF Experience site (*.salesforce-experience.com).
  - Kept Vercel pattern for direct web access.
  - Set FRONTEND_URL env var to lock down to a specific origin in production.
"""

from __future__ import annotations

import logging
import os
import re
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

    # Taxonomy: seeds synchronously in background thread, then upgrades from NUCC CSV
    from services import taxonomy
    taxonomy.initialize()
    logger.info("Taxonomy initializing (seed ready immediately)")

    # ZIP database: sync on Render (blocks until ready), async locally
    from services import zip_database
    zip_database.initialize(background=not cfg.ZIP_LOAD_SYNC)
    logger.info("ZIP DB initializing (sync=%s)", cfg.ZIP_LOAD_SYNC)

    logger.info("Clintrial Navigator V3 ready on port %d", cfg.PORT)
    yield
    # --- shutdown (nothing to clean up) ---


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Clintrial Navigator API",
    version="3.0.0",
    description="Clinical trial discovery + physician search",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
#
# Priority order:
#  1. FRONTEND_URL env var set → allow only that exact origin (most secure).
#  2. IS_RENDER=True and no FRONTEND_URL → allow all known deployment patterns
#     via regex (Vercel previews + Salesforce Experience Cloud).
#  3. Local dev (IS_RENDER=False) → allow all origins for convenience.
#
# Regex breakdown:
#   Vercel:     https://clinical-trial-finder[slug].vercel.app
#   Salesforce: https://[org].preview.salesforce-experience.com
#               https://[org].salesforce-experience.com
#               https://[org].my.site.com  (custom domain on SF)
#               https://[org].force.com    (legacy SF domain)

_CORS_REGEX = (
    r"https://clinical-trial-finder[a-z0-9\-]*\.vercel\.app"
    r"|https://[a-zA-Z0-9\-]+\.preview\.salesforce-experience\.com"
    r"|https://[a-zA-Z0-9\-]+\.salesforce-experience\.com"
    r"|https://[a-zA-Z0-9\-]+\.my\.site\.com"
    r"|https://[a-zA-Z0-9\-]+\.force\.com"
    r"|https://[a-zA-Z0-9\-]+\.lightning\.force\.com"
)

if cfg.IS_RENDER:
    if cfg.FRONTEND_URL:
        # Exact origin from env var — most locked-down option
        logger.info("CORS: allowing exact origin %s", cfg.FRONTEND_URL)
        app.add_middleware(
            CORSMiddleware,
            allow_origins=[cfg.FRONTEND_URL],
            allow_credentials=False,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Content-Type", "Authorization"],
        )
    else:
        # Regex covers all known deployment patterns
        logger.info("CORS: using deployment regex (Vercel + Salesforce)")
        app.add_middleware(
            CORSMiddleware,
            allow_origin_regex=_CORS_REGEX,
            allow_credentials=False,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Content-Type", "Authorization"],
        )
else:
    # Local development — open to all
    logger.info("CORS: open (local dev)")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
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

# V2 — clinical trials
try:
    from api.trials import router as trials_router
except ImportError:
    from trials import router as trials_router  # type: ignore[no-redef]

app.include_router(trials_router,                          prefix="/api/trials",      tags=["trials"])
app.include_router(physicians_router_module.router,        prefix="/api/physicians",  tags=["physicians"])
app.include_router(leads_router_module.router,             prefix="/api/leads",       tags=["leads"])


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["meta"])
async def health() -> dict:
    from services import taxonomy, zip_database
    return {
        "status": "ok",
        "taxonomy_source": taxonomy.source(),
        "taxonomy_count": taxonomy.count(),
        "zip_db_ready": zip_database.is_ready(),
    }