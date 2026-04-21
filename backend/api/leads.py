"""
api/leads.py
POST /api/leads

Captures contact details from a user interested in a physician
near a clinical trial site. Stores to data/leads.json and
optionally pushes to Salesforce if SF_OID is configured.

Request body (JSON):
    name        str   required
    email       str   required
    phone       str   optional
    npi         str   optional  — physician NPI the user is enquiring about
    nct_id      str   optional  — trial NCT ID context
    site        str   optional  — trial site name
    message     str   optional

Response:
    { "success": true, "id": "<uuid>" }
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, field_validator

from core.config import cfg
from core.helpers import sanitise

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Request / Response models ─────────────────────────────────────────────────

class LeadRequest(BaseModel):
    name:    str
    email:   EmailStr
    phone:   str = ""
    npi:     str = ""
    nct_id:  str = ""
    site:    str = ""
    message: str = ""

    @field_validator("name", "phone", "npi", "nct_id", "site", "message", mode="before")
    @classmethod
    def sanitize_fields(cls, v: str) -> str:
        return sanitise(str(v or ""), 500)

    @field_validator("name")
    @classmethod
    def name_required(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name is required")
        return v


class LeadResponse(BaseModel):
    success: bool
    id: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _append_lead(lead: dict) -> None:
    """Append lead dict to data/leads.json (creates file if missing)."""
    path: Path = cfg.LEADS_PATH
    path.parent.mkdir(parents=True, exist_ok=True)

    existing: list[dict] = []
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(existing, list):
                existing = []
        except (json.JSONDecodeError, OSError):
            existing = []

    existing.append(lead)
    path.write_text(
        json.dumps(existing, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _push_to_salesforce(lead: dict) -> None:
    """
    Optional: push lead to Salesforce Web-to-Lead.
    Only runs if SF_OID is configured.
    Failures are logged but never bubble up to the caller.
    """
    if not cfg.SF_OID:
        return
    try:
        from services.salesforce import push_lead
        push_lead(lead)
        logger.info("Lead %s pushed to Salesforce", lead["id"])
    except Exception as exc:
        logger.warning("Salesforce push failed for lead %s: %s", lead["id"], exc)


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post("", response_model=LeadResponse, status_code=201)
async def capture_lead(request: Request, body: LeadRequest):
    """
    Capture a contact lead from the physician discovery UI.
    Persists to data/leads.json and optionally forwards to Salesforce.
    """
    lead_id = str(uuid.uuid4())
    lead = {
        "id": lead_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "name": body.name,
        "email": str(body.email),
        "phone": body.phone,
        "npi": body.npi,
        "nct_id": body.nct_id,
        "site": body.site,
        "message": body.message,
    }

    try:
        _append_lead(lead)
    except OSError as exc:
        logger.error("Failed to persist lead %s: %s", lead_id, exc)
        raise HTTPException(status_code=500, detail="Could not save lead. Please try again.")

    _push_to_salesforce(lead)

    logger.info(
        "Lead captured | id=%s name=%s email=%s npi=%s nct_id=%s",
        lead_id, body.name, str(body.email), body.npi or "—", body.nct_id or "—",
    )

    return LeadResponse(success=True, id=lead_id)