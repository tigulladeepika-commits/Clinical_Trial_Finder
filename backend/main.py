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
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

# CORS — locked to FRONTEND_URL in production, open in dev
origins = [cfg.FRONTEND_URL] if cfg.FRONTEND_URL else ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
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