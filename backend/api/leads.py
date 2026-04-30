"""
api/leads.py
POST /api/leads
"""

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from core.config import cfg
from core.helpers import sanitise

logger = logging.getLogger(__name__)
router = APIRouter()

_FALSY_STRINGS = {"", "undefined", "null", "none", "n/a"}

# Accepts standard emails AND .local / internal hostnames
_EMAIL_RE = re.compile(
    r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$"
    r"|^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.local$"
    r"|^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9\-]+$",
    re.IGNORECASE,
)


def _is_valid_email(value: str) -> bool:
    return bool(_EMAIL_RE.match(value.strip()))


class LeadRequest(BaseModel):
    name:           str
    email:          str   # plain str — NOT EmailStr (EmailStr rejects .local domains)
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
        Validates email without EmailStr so .local domains are accepted.
        Rejects blank / undefined / null values from JS.
        """
        raw = str(v).strip() if v is not None else ""
        if raw.lower() in _FALSY_STRINGS:
            raise ValueError("A valid email address is required.")
        if not _is_valid_email(raw):
            raise ValueError(f"'{raw}' is not a valid email address.")
        return raw


class LeadResponse(BaseModel):
    success: bool
    id:      str


def _append_lead(lead: dict) -> None:
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
    path.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding="utf-8")


def _push_to_salesforce(lead: dict) -> None:
    if not cfg.SF_OID:
        return
    try:
        from services.salesforce import push_lead
        push_lead(lead)
        logger.info("Lead %s pushed to Salesforce", lead["id"])
    except Exception as exc:
        logger.warning("Salesforce push failed for lead %s: %s", lead["id"], exc)


# ---------------------------------------------------------------------------
# Validation-error handler — logs the raw body + Pydantic errors so 422s
# are visible in Render logs instead of being silent.
# Register this on the FastAPI app instance in main.py:
#
#   from api.leads import lead_validation_error_handler
#   from fastapi.exceptions import RequestValidationError
#   app.add_exception_handler(RequestValidationError, lead_validation_error_handler)
# ---------------------------------------------------------------------------

async def lead_validation_error_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    body_bytes = await request.body()
    try:
        body_text = body_bytes.decode("utf-8")
    except Exception:
        body_text = repr(body_bytes)
    logger.error(
        "422 Validation error on %s %s | body=%s | errors=%s",
        request.method,
        request.url.path,
        body_text,
        exc.errors(),
    )
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@router.post("", response_model=LeadResponse, status_code=201)
async def capture_lead(request: Request, body: LeadRequest):
    lead_id    = str(uuid.uuid4())
    name_parts = body.name.strip().split(" ", 1)
    first_name = name_parts[0]
    last_name  = name_parts[1] if len(name_parts) > 1 else ""

    lead = {
        "id":             lead_id,
        "created_at":     datetime.now(timezone.utc).isoformat(),
        "name":           body.name,
        "first_name":     first_name,
        "last_name":      last_name,
        "email":          body.email,
        "phone":          body.phone,
        "lead_source":    body.lead_source,
        "company":        body.company,
        "title":          body.title,
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
        raise HTTPException(status_code=500, detail="Could not save lead. Please try again.")

    _push_to_salesforce(lead)
    logger.info(
        "Lead captured | id=%s auto=%s name=%s email=%s npi=%s nct_id=%s",
        lead_id, body.auto, body.name, body.email,
        body.npi or "-", body.nct_id or "-",
    )
    return LeadResponse(success=True, id=lead_id)