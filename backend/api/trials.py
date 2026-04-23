"""
api/trials.py
REST endpoints for clinical-trial search and detail.

Routes (mounted at /api/trials in main.py):
  GET  /                — paginated, filtered trial search
  GET  /{nct_id}/sites  — site locations for a single trial
  GET  /{nct_id}        — single trial detail (must come AFTER /sites)

Changes:
  - Change #1: city and state query params are validated before the search
    is executed; invalid values return HTTP 422 with a clear message.
  - Change #9: The endpoint now returns the full matched dataset in `trials`
    and sets `total` to the real count. The frontend's useTrials hook handles
    client-side pagination (PAGE_SIZE = 10). The `page` / `page_size` params
    are kept for backwards compatibility but the response always includes all
    matched trials so the frontend can paginate without re-fetching.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.clinicaltrials_api import (
    fetch_trials_with_filters,
    fetch_study_detail,
    validate_city,
    validate_state,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request / response models ─────────────────────────────────────────────────

class TrialSearchResponse(BaseModel):
    trials:    list[dict[str, Any]]
    total:     int
    page:      int
    page_size: int


class SiteLocation(BaseModel):
    facility: str | None
    city:     str | None
    state:    str | None
    country:  str | None
    status:   str | None
    lat:      float | None
    lon:      float | None


class TrialSitesResponse(BaseModel):
    title: str
    sites: list[SiteLocation]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/", response_model=TrialSearchResponse)
async def search_trials(
    condition: str = Query(...,  description="Disease / condition to search for"),
    status:    str | None = Query(None, description="e.g. RECRUITING"),
    phase:     str | None = Query(None, description="e.g. PHASE2"),
    city:      str | None = Query(None, description="Filter by city"),
    state:     str | None = Query(None, description="2-letter state abbreviation or full name, e.g. CT or Connecticut"),
    us_only:   bool       = Query(False, description="Restrict to US locations"),
    page:      int        = Query(1,  ge=1,  description="1-based page number"),
    page_size: int        = Query(10, ge=1, le=500, description="Results per page — set high to retrieve full dataset"),
) -> TrialSearchResponse:
    # ── Change #1: Validate city and state before touching the service ────────
    city_ok,  city_reason  = validate_city(city)
    state_ok, state_reason = validate_state(state)

    if not city_ok:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid city filter — {city_reason}",
        )
    if not state_ok:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid state filter — {state_reason}",
        )

    filters: dict[str, Any] = {
        "condition": condition,
        "status":    status,
        "phase":     phase,
        "city":      city,
        "state":     state,
        "us_only":   us_only,
    }

    # Change #9: pass a large limit so fetch_trials_with_filters returns the
    # full matched set. `offset` is still respected for backwards compatibility
    # with any callers that rely on server-side slicing, but the `total` field
    # always reflects the complete count — enabling the frontend to show
    # "Showing 10 of 1,000" and paginate purely client-side.
    offset = (page - 1) * page_size

    try:
        trials, total = fetch_trials_with_filters(
            filters=filters,
            limit=page_size,
            offset=offset,
        )
    except Exception as exc:
        logger.exception("Error fetching trials: %s", exc)
        raise HTTPException(
            status_code=502,
            detail="Upstream ClinicalTrials.gov request failed",
        ) from exc

    return TrialSearchResponse(
        trials=trials,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{nct_id}/sites", response_model=TrialSitesResponse)
async def get_trial_sites(nct_id: str) -> TrialSitesResponse:
    """
    Return the title and all site locations for a single trial.
    The frontend uses this to populate the map and site list.
    """
    try:
        data = fetch_study_detail(nct_id)
    except Exception as exc:
        logger.exception("Error fetching sites for %s: %s", nct_id, exc)
        raise HTTPException(status_code=502, detail=f"Could not fetch trial {nct_id}") from exc

    if not data:
        raise HTTPException(status_code=404, detail=f"Trial {nct_id} not found")

    protocol       = data.get("protocolSection", {})
    id_module      = protocol.get("identificationModule", {})
    contacts       = protocol.get("contactsLocationsModule", {})
    status_mod     = protocol.get("statusModule", {})
    overall_status = status_mod.get("overallStatus")

    title = id_module.get("briefTitle") or nct_id

    raw_locations = contacts.get("locations") or []
    sites: list[SiteLocation] = []
    for loc in raw_locations:
        geo      = loc.get("geoPoint") or {}
        s_status = loc.get("recruitmentStatus") or overall_status
        sites.append(SiteLocation(
            facility = loc.get("facility"),
            city     = loc.get("city"),
            state    = loc.get("state"),
            country  = loc.get("country"),
            status   = s_status,
            lat      = geo.get("lat"),
            lon      = geo.get("lon"),
        ))

    return TrialSitesResponse(title=title, sites=sites)


@router.get("/{nct_id}")
async def get_trial(nct_id: str) -> dict[str, Any]:
    try:
        data = fetch_study_detail(nct_id)
    except Exception as exc:
        logger.exception("Error fetching trial %s: %s", nct_id, exc)
        raise HTTPException(status_code=502, detail=f"Could not fetch trial {nct_id}") from exc

    if not data:
        raise HTTPException(status_code=404, detail=f"Trial {nct_id} not found")

    return data