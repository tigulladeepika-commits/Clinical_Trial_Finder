"""
api/physicians.py
GET /api/physicians/search

Accepts a trial site's lat/lng (from ClinicalTrials.gov geoPoint),
a search radius in miles, and an optional specialty filter.
Returns up to MAX_DISPLAY physicians geocoded and sorted by distance.

Flow:
  1. Validate lat / lng / radius
  2. Resolve nearby ZIP codes from zip_database
  3. Fan out NPPES queries per ZIP (+ optional taxonomy filter)
  4. Parse, deduplicate, geocode, jitter, distance-filter
  5. Return top MAX_DISPLAY results with full address + coords
"""

import logging
import math
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

from core.config import cfg
from core.validation import validate_lat_lng, validate_radius, validate_descriptions
from core.helpers import sanitise
from services import nppes, zip_database, taxonomy as tax_service

logger = logging.getLogger(__name__)

router = APIRouter()


def _haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in miles between two lat/lng points."""
    R = 3958.8  # Earth radius in miles
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


@router.get("/search")
async def search_physicians(
    request: Request,
    lat: float = Query(..., description="Latitude of trial site"),
    lng: float = Query(..., description="Longitude of trial site"),
    radius: float = Query(25.0, description="Search radius in miles (1–100)"),
    specialty: Optional[str] = Query(None, description="Taxonomy / specialty filter"),
):
    """
    Search for physicians near a clinical trial site.

    Returns up to 10 physicians sorted by distance from the site,
    with full address, NPI, specialty, phone, and map coordinates.
    """
    # ── 1. Validate inputs ────────────────────────────────────────────────────
    try:
        lat, lng = validate_lat_lng(lat, lng)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    try:
        radius = validate_radius(radius)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    descriptions: list[str] = []
    if specialty:
        clean_specialty = sanitise(specialty, cfg.MAX_DESC_LEN)
        if clean_specialty:
            # Resolve free-text specialty to NUCC taxonomy display string
            resolved = tax_service.resolve(clean_specialty)
            descriptions = [resolved]

    # ── 2. Find ZIP codes within radius ───────────────────────────────────────
    if not zip_database.is_ready():
        logger.warning("ZIP DB not ready yet — waiting up to %.0fs", cfg.ZIP_DB_WAIT)
        zip_database.wait_until_ready(cfg.ZIP_DB_WAIT)

    nearby_zips = zip_database.get_zips_in_radius(lat, lng, radius)

    if not nearby_zips:
        logger.info("No ZIPs found within %.1f miles of (%.4f, %.4f)", radius, lat, lng)
        return {
            "physicians": [],
            "total": 0,
            "radius_miles": radius,
            "zips_searched": 0,
        }

    logger.info(
        "Physician search | lat=%.4f lng=%.4f radius=%.1fmi zips=%d specialty=%s",
        lat, lng, radius, len(nearby_zips), specialty or "any",
    )

    # ── 3. Fan-out NPPES queries ──────────────────────────────────────────────
    seen_npis: set[str] = set()
    raw_physicians: list[dict] = []

    zip_batch = nearby_zips[: cfg.MAX_ZIP_QUERIES]

    for zipcode in zip_batch:
        if len(raw_physicians) >= 200:
            break

        if descriptions:
            for desc in descriptions[: cfg.MAX_TAX_QUERIES]:
                rows, _ = nppes.fetch_with_retry({
                    "postal_code": zipcode,
                    "taxonomy_description": desc,
                    "limit": 50,
                })
                for row in rows:
                    parsed = nppes.parse_physician(row)
                    if parsed and parsed["npi"] not in seen_npis:
                        seen_npis.add(parsed["npi"])
                        raw_physicians.append(parsed)
        else:
            rows, _ = nppes.fetch_with_retry({
                "postal_code": zipcode,
                "limit": 50,
            })
            for row in rows:
                parsed = nppes.parse_physician(row)
                if parsed and parsed["npi"] not in seen_npis:
                    seen_npis.add(parsed["npi"])
                    raw_physicians.append(parsed)

    if not raw_physicians:
        return {
            "physicians": [],
            "total": 0,
            "radius_miles": radius,
            "zips_searched": len(zip_batch),
        }

    # ── 4. Assign ZIP centroid coords for distance pre-filter ─────────────────
    for p in raw_physicians:
        if p["lat"] is None:
            z_lat, z_lng = zip_database.get_zip_coords(p["zip"])
            if z_lat is not None:
                p["lat"] = z_lat
                p["lng"] = z_lng

    # Pre-filter by radius using ZIP centroids (fast, rough)
    in_radius = [
        p for p in raw_physicians
        if p["lat"] is not None
        and _haversine_miles(lat, lng, p["lat"], p["lng"]) <= radius
    ]

    # ── 5. Geocode addresses for precise coords ───────────────────────────────
    nppes.batch_geocode_for_display(in_radius)

    # Final distance calculation with address-level coords
    for p in in_radius:
        if p["lat"] is not None:
            p["distance_miles"] = round(
                _haversine_miles(lat, lng, p["lat"], p["lng"]), 1
            )

    # Filter again with precise coords, sort by distance
    precise = [p for p in in_radius if p.get("distance_miles") is not None]
    precise.sort(key=lambda p: p["distance_miles"])

    # Jitter overlapping markers
    nppes.apply_coord_jitter(precise)

    top = precise[: cfg.MAX_DISPLAY]

    # Strip internal flags before returning
    for p in top:
        p.pop("_geocoded", None)

    return {
        "physicians": top,
        "total": len(precise),
        "radius_miles": radius,
        "zips_searched": len(zip_batch),
    }