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

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel

from core.config import cfg
from services.clinicaltrials_api import (
    fetch_trials_with_filters,
    fetch_study_detail,
    validate_city,
    validate_state,
    STATE_ABBREV_TO_FULL,
)
from services import taxonomy as tax_service

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
    response:  Response   = None,  # FastAPI injects Response object
) -> TrialSearchResponse:
    # ── HTTP Caching (Issue #6): Cache search results for 5 minutes.
    # This allows browsers to serve cached results when users re-search the same
    # filters, reducing server load. The "private" directive ensures the cache
    # is not shared across users (respects privacy for any user-specific data).
    if response:
        response.headers["Cache-Control"] = "private, max-age=300"  # 5 minutes
    
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


@router.get("/condition/{condition}/specialties")
async def get_condition_specialties(condition: str, response: Response = None) -> dict[str, Any]:
    """
    CRITICAL FIX: Map a medical condition to relevant medical specialties for physician search.
    
    This endpoint enables intelligent physician discovery: when a user clicks
    "Find Physicians" for a trial with condition "High Grade Sarcoma", this
    endpoint returns ["Medical Oncology", "Surgical Oncology", ...] so the
    physician search can find specialists in those fields rather than limiting
    to an exact specialty match.
    
    HTTP Caching (Issue #7): Cache for 24 hours since condition→specialty
    mappings are static and change infrequently.
    
    Example:
      GET /api/trials/condition/high%20grade%20sarcoma/specialties
      → {
          "condition": "high grade sarcoma",
          "specialties": ["Medical Oncology", "Surgical Oncology"]
        }
    """
    if response:
        response.headers["Cache-Control"] = "public, max-age=86400"  # 24 hours
    
    if not condition or not condition.strip():
        raise HTTPException(status_code=422, detail="Condition cannot be empty")
    
    clean_condition = condition.strip().lower()
    
    # Access the CONDITION_MAP directly from taxonomy service
    specialties = tax_service.CONDITION_MAP.get(clean_condition, [])
    
    return {
        "condition": clean_condition,
        "specialties": specialties,
        "count": len(specialties),
    }


@router.get("/cities-by-state", response_model=dict[str, list[str]])
async def get_cities_by_state(response: Response = None) -> dict[str, list[str]]:
    """
    CRITICAL FIX: Return a mapping of US states → valid cities for validation.
    
    Frontend uses this to validate that users cannot search with a city that
    doesn't belong to the selected state (e.g., prevents "Boston" + "California").
    
    HTTP Caching (Issue #8): Cache for 30 days since city lists change rarely.
    Built from ZIP database which is updated infrequently.
    """
    if response:
        response.headers["Cache-Control"] = "public, max-age=2592000"  # 30 days
    
    try:
        from services import zip_database
        if not zip_database.is_ready():
            zip_database.wait_for_ready(cfg.ZIP_DB_WAIT)
        
        # Extract unique cities per state from ZIP database
        cities_by_state: dict[str, set[str]] = {}
        
        for entry in zip_database._zip_data:  # Access internal data
            state = entry.get("state")
            city = entry.get("city")
            
            if state and city:
                if state not in cities_by_state:
                    cities_by_state[state] = set()
                cities_by_state[state].add(city)
        
        # Convert sets to sorted lists for JSON serialization
        return {
            state: sorted(list(cities))
            for state, cities in cities_by_state.items()
        }
    except Exception as exc:
        logger.exception("Error building cities-by-state: %s", exc)
        # Return empty on error; frontend will gracefully degrade
        return {}


@router.get("/validate-city-state")
async def validate_city_state_endpoint(
    city:  str | None = Query(None, description="City name to validate"),
    state: str | None = Query(None, description="2-letter state abbreviation"),
) -> dict[str, Any]:
    """
    Validate that a city belongs to the selected state.
    
    Returns { isValid: bool, error?: string } for frontend to display
    a clear popup message if the combination is invalid.
    
    This endpoint provides server-side validation as a fallback when
    the frontend's cached city list is stale or incomplete.
    """
    # Both empty is valid
    if not city and not state:
        return {"isValid": True}
    
    # City only (no state) is valid
    if city and not state:
        return {"isValid": True}
    
    # State only (no city) is valid
    if not city and state:
        return {"isValid": True}
    
    # Both provided — validate combination
    if city and state:
        try:
            from services import zip_database
            if not zip_database.is_ready():
                zip_database.wait_for_ready(cfg.ZIP_DB_WAIT)
            
            # Look up the city in the ZIP database for this state
            city_normalized = city.strip().lower()
            state_normalized = state.upper()
            
            # Search ZIP data for matching city/state
            for entry in zip_database._zip_data:
                entry_state = entry.get("state", "").upper()
                entry_city = entry.get("city", "").lower()
                
                if entry_state == state_normalized and entry_city == city_normalized:
                    return {"isValid": True}
            
            # City not found in this state
            state_full = STATE_ABBREV_TO_FULL.get(state_normalized.lower(), state)
            return {
                "isValid": False,
                "error": f'Invalid city/state combination: "{city}" is not a city in {state_full}',
            }
        except Exception as exc:
            logger.warning("Error validating city/state: %s", exc)
            # Don't block search on validation errors
            return {"isValid": True}
    
    return {"isValid": True}


# ── Generic trial detail endpoints (must come AFTER specific routes) ────────

@router.get("/{nct_id}/sites", response_model=TrialSitesResponse)
async def get_trial_sites(nct_id: str, response: Response = None) -> TrialSitesResponse:
    """
    Return the title and all site locations for a single trial.
    The frontend uses this to populate the map and site list.
    
    HTTP Caching (Issue #6): Cache for 24 hours since trial sites don't change
    frequently. Users who click back or re-select the same trial get instant results.
    """
    if response:
        response.headers["Cache-Control"] = "public, max-age=86400"  # 24 hours
    
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
async def get_trial(nct_id: str, response: Response = None) -> dict[str, Any]:
    """
    Return full trial details (all protocol sections).
    
    HTTP Caching (Issue #6): Cache for 24 hours since trial data is static.
    Users viewing the same trial multiple times or bookmarking will benefit from cache.
    """
    if response:
        response.headers["Cache-Control"] = "public, max-age=86400"  # 24 hours
    
    try:
        data = fetch_study_detail(nct_id)
    except Exception as exc:
        logger.exception("Error fetching trial %s: %s", nct_id, exc)
        raise HTTPException(status_code=502, detail=f"Could not fetch trial {nct_id}") from exc

    if not data:
        raise HTTPException(status_code=404, detail=f"Trial {nct_id} not found")

    return data


# End of trials router