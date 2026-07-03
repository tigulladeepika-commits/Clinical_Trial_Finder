"""Backfill missing `gender_identity` values in backend/data/leads.json.

Usage:
  python -m backend.scripts.backfill_lead_genders

The script will create a timestamped backup of the existing leads file
before updating any records.
"""
from __future__ import annotations

import json
import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# Ensure imports work whether the script is run as a module or as a standalone
# script from the repository root. This prepends `backend/` and the repo root
# to sys.path so both `core.*` and `backend.core.*` import forms resolve.
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))

try:  # support running from repo root or from package
    from core.config import cfg
    from services import nppes as nppes_service
except Exception:  # pragma: no cover - runtime helper for dev env
    from backend.core.config import cfg
    from backend.services import nppes as nppes_service

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


def backup_path(p: Path) -> Path:
    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    return p.with_name(f"{p.name}.backup.{ts}")


def main() -> int:
    path: Path = cfg.LEADS_PATH
    if not path.exists():
        logger.error("Leads file not found: %s", path)
        return 1

    raw = path.read_text(encoding="utf-8")
    leads = json.loads(raw or "[]")
    if not isinstance(leads, list):
        logger.error("Unexpected leads file format (expected list)")
        return 1

    backup = backup_path(path)
    backup.write_text(json.dumps(leads, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info("Backup written to %s", backup)

    updated = 0
    total = 0
    for lead in leads:
        total += 1
        gender = (lead.get("gender_identity") or "").strip()
        npi = (lead.get("npi") or lead.get("npi_number") or "").strip()
        if gender:
            continue
        if not npi:
            continue

        # Query NPPES for this NPI
        try:
            rows, _ = nppes_service.fetch_with_retry({"number": npi}, retries=2)
            if rows:
                parsed = nppes_service.parse_physician(rows[0])
                found_gender = parsed.get("gender") if isinstance(parsed, dict) else None
                if found_gender:
                    lead["gender_identity"] = found_gender
                    updated += 1
                    logger.info("Updated lead %s gender -> %s", lead.get("id"), found_gender)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Failed to fetch NPPES for npi=%s: %s", npi, exc)

    if updated:
        path.write_text(json.dumps(leads, indent=2, ensure_ascii=False), encoding="utf-8")
        logger.info("Wrote %d updated leads to %s (out of %d processed)", updated, total)
    else:
        logger.info("No updates required (checked %d leads)", total)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
