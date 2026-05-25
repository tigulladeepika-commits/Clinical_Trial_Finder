"""
api/apollo.py
POST /api/apollo/find-email

Accepts physician details, runs the Apollo search → enrich pipeline,
and returns the result. The frontend calls this when the user clicks
"Add as Lead" on the PhysicianDetailPanel.

Response shapes
---------------
  { found: true,  email: "jane@hospital.org", apollo_name: "Jane Smith" }
  { found: true,  email: null,                apollo_name: "Jane Smith" }   ← person found, no email
  { found: false, email: null,                apollo_name: null         }   ← no match
  { found: false, email: null, error: "..." }                               ← config / network error
"""

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from services.apollo import find_physician_email

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request / Response models ─────────────────────────────────────────────────

class EmailLookupRequest(BaseModel):
    name:         str
    address:      str = ""   # full address string — city/state extracted server-side
    organization: str = ""   # facility / place of work (optional)


class EmailLookupResponse(BaseModel):
    found:       bool
    email:       str | None  = None
    apollo_name: str | None  = None
    error:       str | None  = None


# ── Route ─────────────────────────────────────────────────────────────────────

@router.post("", response_model=EmailLookupResponse)
async def lookup_physician_email(body: EmailLookupRequest):
    """
    Run the Apollo search → enrich pipeline for a single physician.

    - Always returns HTTP 200 so the frontend can read the JSON body.
    - found=False means no match (not an error).
    - found=True, email=None means person found but email unavailable.
    - error is set only on hard failures (missing API key, network down).
    """
    if not body.name.strip():
        return JSONResponse(
            status_code=400,
            content={"found": False, "email": None, "error": "name is required"},
        )

    logger.info(
        "Apollo lookup | name='%s' | org='%s'",
        body.name, body.organization or "-",
    )

    result = await find_physician_email(
        name=         body.name,
        address=      body.address,
        organization= body.organization,
    )

    return EmailLookupResponse(
        found=       result.found,
        email=       result.email,
        apollo_name= result.apollo_name,
        error=       result.error,
    )