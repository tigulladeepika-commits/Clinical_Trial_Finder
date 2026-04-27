"""
core/config.py
Central configuration for Clintrial Navigator V3.
Merges V1 Config class with V2 environment setup.
All modules import from here — never from os.environ directly.
"""

import os
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Resolve the backend root so data/ paths work regardless of cwd
BACKEND_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_ROOT / "data"


class Config:
    # ── API Keys ──────────────────────────────────────────────────────────────
    MAPQUEST_API_KEY: str = os.environ.get("MAPQUEST_API_KEY", "")
    GEOAPIFY_API_KEY: str = os.environ.get("GEOAPIFY_API_KEY", "")

    # ── Salesforce ────────────────────────────────────────────────────────────
    SF_OID:        str = os.environ.get("SF_OID", "")
    SF_RET_URL:    str = os.environ.get("SF_RET_URL", "")
    SF_DEBUG_EMAIL: str = os.environ.get("SF_DEBUG_EMAIL", "")

    # ── CORS / Server ─────────────────────────────────────────────────────────
    FRONTEND_URL: str = os.environ.get("FRONTEND_URL", "")
    PORT:         int = int(os.environ.get("PORT", 8000))
    DEBUG_SECRET: str = os.environ.get("DEBUG_SECRET", "")

    # ── Data paths ────────────────────────────────────────────────────────────
    ZIP_DB_PATH: Path = DATA_DIR / "us_zip_db.json"
    LEADS_PATH:  Path = DATA_DIR / "leads.json"

    # ── Physician search limits ───────────────────────────────────────────────
    MAX_DISPLAY:     int   = 10      # physicians returned per search
    # CRITICAL FIX: Reduced from 20 to 12. Each ZIP requires retries + geocoding,
    # so 20 ZIPs × 3 specialties × retries was creating 100+ API calls per search.
    # With 12 ZIPs and early stopping logic, we still get good coverage in typical
    # radii (25 miles) while cutting API load by 40%.
    MAX_ZIP_QUERIES: int   = 12      # ZIP codes queried per physician search
    MAX_TAX_QUERIES: int   = 3       # taxonomy descriptions fanned out per ZIP
    # FIX: MAX_DESC_COUNT now used as a cap on the descriptions list built in
    # physicians.py, preventing runaway fan-out when a specialty resolves to
    # many taxonomy entries. Value kept at 5 (same as before).
    MAX_DESC_COUNT:  int   = 5       # max taxonomy descriptions per search
    MAX_DESC_LEN:    int   = 120     # max specialty string length (chars)
    MAX_RADIUS:      float = 100.0
    GEOCODE_CACHE_SIZE: int = 2000

    # ── Timeouts (seconds) ────────────────────────────────────────────────────
    # FIX: comment previously said "(ms)" — requests/httpx timeouts are in
    # seconds, not milliseconds. Values unchanged; only the comment is fixed.
    # Keep all outbound calls well under Render's 30 s proxy hard-kill.
    REQUEST_TIMEOUT: int = 25    # NPPES, Salesforce, taxonomy CSV — 25 s
    AC_TIMEOUT:      int = 8     # Geoapify autocomplete / geocode — 8 s
    ZIP_DL_TIMEOUT:  int = 90    # one-time GeoNames ZIP file download — 90 s

    # ── Clinical trials ───────────────────────────────────────────────────────
    CT_DEFAULT_PAGE_SIZE: int = 100
    CT_MAX_PAGES:         int = 10

    # ── Deployment ────────────────────────────────────────────────────────────
    IS_RENDER: bool = bool(os.environ.get("RENDER", ""))
    # When True, zip_database.initialize() blocks until ZIP DB is ready
    # before the first worker accepts traffic — eliminates cold-start races.
    ZIP_LOAD_SYNC: bool = bool(os.environ.get("ZIP_LOAD_SYNC", "")) or bool(
        os.environ.get("RENDER", "")
    )
    ZIP_DB_WAIT: float = 30.0

    # ── Rate limiting (per-IP, in-process) ───────────────────────────────────
    RATE_LIMIT_WINDOW:  int = 60
    RATE_LIMIT_SEARCH:  int = 30    # physician searches per window
    RATE_LIMIT_LEAD:    int = 5     # lead submissions per window
    RATE_LIMIT_AC:      int = 120   # autocomplete hits per window


cfg = Config()


def validate_configuration() -> list[str]:
    """
    Validate required env vars at startup.
    Returns list of missing variable names (empty = all good).
    """
    missing = []

    for value, label in [
        (cfg.MAPQUEST_API_KEY, "MAPQUEST_API_KEY"),
        (cfg.GEOAPIFY_API_KEY, "GEOAPIFY_API_KEY"),
    ]:
        if not value:
            missing.append(label)
            logger.warning("Environment variable %s is not set", label)

    if not cfg.FRONTEND_URL:
        logger.warning(
            "FRONTEND_URL is not set — CORS is open to ALL origins. "
            "Set this to your Vercel/frontend URL in production."
        )

    if not cfg.SF_OID:
        logger.info("SF_OID not set — Salesforce lead push is disabled")

    if not cfg.DEBUG_SECRET:
        logger.warning(
            "DEBUG_SECRET not set — debug endpoints are UNPROTECTED. "
            "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
        )

    logger.info(
        "Config loaded | IS_RENDER=%s ZIP_LOAD_SYNC=%s PORT=%d",
        cfg.IS_RENDER, cfg.ZIP_LOAD_SYNC, cfg.PORT,
    )
    logger.info("Data dir: %s", DATA_DIR)

    return missing