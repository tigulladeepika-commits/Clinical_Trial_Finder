"""
api/trials.py
REST endpoints for clinical-trial search and detail.

Routes (mounted at /api/trials in main.py):
  GET  /          — paginated, filtered trial search
  GET  /{nct_id}  — single trial detail
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.clinicaltrials_api import fetch_trials_with_filters, fetch_study_detail

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request / response models ─────────────────────────────────────────────────

class TrialSearchResponse(BaseModel):
    trials: list[dict[str, Any]]
    total: int
    page: int
    page_size: int


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/", response_model=TrialSearchResponse)
async def search_trials(
    condition: str = Query(..., description="Disease / condition to search for"),
    status: str | None = Query(None, description="e.g. RECRUITING"),
    phase: str | None = Query(None, description="e.g. PHASE2"),
    city: str | None = Query(None, description="Filter by city"),
    state: str | None = Query(None, description="2-letter state abbreviation, e.g. CT"),
    us_only: bool = Query(False, description="Restrict to US locations"),
    page: int = Query(1, ge=1, description="1-based page number"),
    page_size: int = Query(10, ge=1, le=100, description="Results per page"),
) -> TrialSearchResponse:
    filters: dict[str, Any] = {
        "condition": condition,
        "status": status,
        "phase": phase,
        "city": city,
        "state": state,
        "us_only": us_only,
    }
    offset = (page - 1) * page_size

    try:
        trials, total = fetch_trials_with_filters(
            filters=filters,
            limit=page_size,
            offset=offset,
        )
    except Exception as exc:
        logger.exception("Error fetching trials: %s", exc)
        raise HTTPException(status_code=502, detail="Upstream ClinicalTrials.gov request failed") from exc

    return TrialSearchResponse(
        trials=trials,
        total=total,
        page=page,
        page_size=page_size,
    )


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