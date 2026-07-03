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
    def __init__(self) -> None:
        # ── API Keys ──────────────────────────────────────────────────────────
        self.MAPQUEST_API_KEY: str = os.environ.get("MAPQUEST_API_KEY", "")
        self.GEOAPIFY_API_KEY: str = os.environ.get("GEOAPIFY_API_KEY", "")
        self.APOLLO_API_KEY:   str = os.environ.get("APOLLO_API_KEY", "")
        self.GROQ_API_KEY:    str = os.environ.get("GROQ_API_KEY", "")
        self.GROQ_API_URL:    str = os.environ.get("GROQ_API_URL", "")

        # ── Salesforce ────────────────────────────────────────────────────────
        self.SF_OID:                    str = os.environ.get("SF_OID", "")
        self.SF_RET_URL:                str = os.environ.get("SF_RET_URL", "")
        self.SF_DEBUG_EMAIL:            str = os.environ.get("SF_DEBUG_EMAIL", "")
        self.SF_NPI_FIELD:              str = os.environ.get("SF_NPI_FIELD", "")
        self.SF_SPECIALIZATION_FIELD:   str = os.environ.get("SF_SPECIALIZATION_FIELD", "")
        self.SF_GENDER_FIELD:           str = os.environ.get("SF_GENDER_FIELD", "")
        self.SF_GENDER_IDENTITY_FIELD:  str = os.environ.get("SF_GENDER_IDENTITY_FIELD", "")

        # ── CORS / Server ─────────────────────────────────────────────────────
        self.FRONTEND_URL: str = os.environ.get("FRONTEND_URL", "")
        self.PORT:         int = int(os.environ.get("PORT", 8000))
        self.DEBUG_SECRET: str = os.environ.get("DEBUG_SECRET", "")

        # ── Data paths ────────────────────────────────────────────────────────
        self.ZIP_DB_PATH: Path = DATA_DIR / "us_zip_db.json"
        self.LEADS_PATH:  Path = DATA_DIR / "leads.json"

        # ── Physician search limits ───────────────────────────────────────────
        self.MAX_DISPLAY:     int   = 10
        self.MAX_ZIP_QUERIES: int   = 12
        self.MAX_TAX_QUERIES: int   = 3
        self.MAX_DESC_COUNT:  int   = 5
        self.MAX_DESC_LEN:    int   = 120
        self.MAX_RADIUS:      float = 100.0
        self.GEOCODE_CACHE_SIZE: int = 2000

        # ── Timeouts (seconds) ────────────────────────────────────────────────
        self.REQUEST_TIMEOUT: int = 25
        self.AC_TIMEOUT:      int = 8
        self.ZIP_DL_TIMEOUT:  int = 90

        # ── Clinical trials ───────────────────────────────────────────────────
        self.CT_DEFAULT_PAGE_SIZE: int = 100
        self.CT_MAX_PAGES:         int = 10

        # ── Deployment ────────────────────────────────────────────────────────
        self.IS_RENDER: bool = bool(os.environ.get("RENDER", ""))
        self.ZIP_LOAD_SYNC: bool = (
            bool(os.environ.get("ZIP_LOAD_SYNC", ""))
            or bool(os.environ.get("RENDER", ""))
        )
        self.ZIP_DB_WAIT: float = 30.0

        # ── Rate limiting (per-IP, in-process) ───────────────────────────────
        self.RATE_LIMIT_WINDOW:  int = 60
        self.RATE_LIMIT_SEARCH:  int = 30
        self.RATE_LIMIT_LEAD:    int = 5
        self.RATE_LIMIT_AC:      int = 120


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
    else:
        logger.info("SF_OID configured — Salesforce lead push enabled")

    if not cfg.DEBUG_SECRET:
        logger.warning(
            "DEBUG_SECRET not set — debug endpoints are UNPROTECTED. "
            "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(32))\""
        )

    logger.info(
        "Config loaded | IS_RENDER=%s ZIP_LOAD_SYNC=%s PORT=%d SF_OID_set=%s",
        cfg.IS_RENDER, cfg.ZIP_LOAD_SYNC, cfg.PORT, bool(cfg.SF_OID),
    )
    logger.info("Data dir: %s", DATA_DIR)

    return missing