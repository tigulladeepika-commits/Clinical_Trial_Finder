"""
api/leads.py
POST /api/leads

Captures contact details from a user interested in a physician
near a clinical trial site. Stores to data/leads.json and
optionally pushes to Salesforce if SF_OID is configured.

Request body (JSON):
    name            str   required
    email           str   required
    phone           str   optional
    npi             str   optional  — physician NPI
    nct_id          str   optional  — trial NCT ID context
    site            str   optional  — trial site name
    message         str   optional
    lead_source     str   optional  — defaults to "Clinical Trial"
    company         str   optional  — defaults to "Individual Physicians"
    title           str   optional  — physician taxonomy / specialty
    physician_name  str   optional  — physician full name (for auto-leads)
    auto            bool  optional  — if true, lead was auto-generated (no user form)

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

# Placeholder used by submitAutoLead() when no real user email is provided.
# Pydantic's EmailStr accepts it, and Salesforce receives it as-is.
_AUTO_LEAD_EMAIL = "lead@aquarient.local"

# Values that JS may serialize for missing/undefined fields — all rejected.
_FALSY_STRINGS = {"", "undefined", "null", "none", "n/a"}


# ── Request / Response models ─────────────────────────────────────────────────

class LeadRequest(BaseModel):
    name:           str
    email:          EmailStr
    phone:          str  = ""
    npi:            str  = ""
    nct_id:         str  = ""
    site:           str  = ""
    message:        str  = ""
    lead_source:    str  = "Clinical Trial"
    company:        str  = "Individual Physicians"
    title:          str  = ""
    physician_name: str  = ""
    auto:           bool = False

    @field_validator(
        "name", "phone", "npi", "nct_id", "site", "message",
        "lead_source", "company", "title", "physician_name",
        mode="before",
    )
    @classmethod
    def sanitize_str_fields(cls, v: object) -> str:
        """
        Coerce to string, strip HTML/control chars, cap length.
        Converts JS undefined → "" (None arrives as Python None here).
        """
        return sanitise(str(v) if v is not None else "", 500)

    @field_validator("name")
    @classmethod
    def name_required(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name is required and cannot be blank")
        return v

    @field_validator("email", mode="before")
    @classmethod
    def clean_email(cls, v: object) -> str:
        """
        Reject blank / JS-undefined / null values before EmailStr validates.
        Also accepts the auto-lead placeholder so submitAutoLead() always works.
        """
        raw = str(v).strip().lower() if v is not None else ""
        if raw in _FALSY_STRINGS:
            raise ValueError(
                "A valid email address is required. "
                "Received an empty or invalid value."
            )
        return str(v).strip()  # return original casing for storage


class LeadResponse(BaseModel):
    success: bool
    id:      str


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

    Two modes:
      auto=false (default) — user filled in the Load More form
      auto=true            — physician "Add as Lead" auto-generated lead
    """
    lead_id = str(uuid.uuid4())

    # Split name into first / last for Salesforce
    name_parts = body.name.strip().split(" ", 1)
    first_name = name_parts[0]
    last_name  = name_parts[1] if len(name_parts) > 1 else ""

    lead = {
        "id":             lead_id,
        "created_at":     datetime.now(timezone.utc).isoformat(),
        # Core identity
        "name":           body.name,
        "first_name":     first_name,
        "last_name":      last_name,
        "email":          str(body.email),
        "phone":          body.phone,
        # Salesforce fields
        "lead_source":    body.lead_source,
        "company":        body.company,
        "title":          body.title,
        # Physician context
        "physician_name": body.physician_name,
        "npi":            body.npi,
        "nct_id":         body.nct_id,
        "site":           body.site,
        "message":        body.message,
        "auto":           body.auto,
    }

    try:
        _append_lead(lead)
    except OSError as exc:
        logger.error("Failed to persist lead %s: %s", lead_id, exc)
        raise HTTPException(
            status_code=500,
            detail="Could not save lead. Please try again.",
        )

    _push_to_salesforce(lead)

    logger.info(
        "Lead captured | id=%s auto=%s name=%s email=%s npi=%s nct_id=%s",
        lead_id, body.auto, body.name, str(body.email),
        body.npi or "—", body.nct_id or "—",
    )

    return LeadResponse(success=True, id=lead_id)