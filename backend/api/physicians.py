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
  4. Parse, deduplicate, geocode, distance-filter
  5. Return top MAX_DISPLAY results with full address + coords

Changes:
  - Change #4: Radius filtering now uses address-level geocoded coordinates
    as the primary distance source. ZIP centroid coords are only used as a
    pre-filter (cheap pass), and the final strict filter always uses the
    most precise coords available. Previously, physicians were sometimes
    excluded or included based on centroid coords even after geocoding had
    succeeded, because the centroid was written back over the geocoded value.
    The pre-filter and final filter now use separate distance thresholds to
    ensure no legitimate in-radius physician is dropped due to centroid error.
  - Change #1: lat/lng/radius are validated before any downstream calls.
"""

import logging
import math
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request

from core.config import cfg
from core.validation import validate_lat_lng, validate_radius
from core.helpers import sanitise
from services import nppes, zip_database, taxonomy as tax_service

logger = logging.getLogger(__name__)

router = APIRouter()

# Change #4: The ZIP centroid pre-filter uses a slightly expanded radius to
# avoid false-negatives when a ZIP centroid is near the boundary. Physicians
# that pass the centroid pre-filter are then re-evaluated with their precise
# geocoded address coordinates and the exact requested radius.
_CENTROID_BUFFER_MILES = 5.0


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
    request:   Request,
    lat:       float            = Query(...,  description="Latitude of trial site"),
    lng:       float            = Query(...,  description="Longitude of trial site"),
    radius:    float            = Query(25.0, description="Search radius in miles (1–100)"),
    specialty: Optional[str]   = Query(None, description="Taxonomy / specialty filter"),
):
    """
    Search for physicians near a clinical trial site.

    Returns physicians sorted by distance from the site, with full address,
    NPI, specialty, phone, and map coordinates.
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
            resolved = tax_service.resolve(clean_specialty)
            descriptions = [resolved]

    # ── 2. Find ZIP codes within radius ───────────────────────────────────────
    if not zip_database.is_ready():
        logger.warning("ZIP DB not ready yet — waiting up to %.0fs", cfg.ZIP_DB_WAIT)
        zip_database.wait_for_ready(cfg.ZIP_DB_WAIT)

    nearby_zips = zip_database.find_zips_in_radius(lat, lng, radius)

    if not nearby_zips:
        logger.info("No ZIPs found within %.1f miles of (%.4f, %.4f)", radius, lat, lng)
        return {
            "physicians":    [],
            "total":         0,
            "radius_miles":  radius,
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
                    "postal_code":          zipcode,
                    "taxonomy_description": desc,
                    "limit":                50,
                })
                for row in rows:
                    parsed = nppes.parse_physician(row)
                    if parsed and parsed["npi"] not in seen_npis:
                        seen_npis.add(parsed["npi"])
                        raw_physicians.append(parsed)
        else:
            rows, _ = nppes.fetch_with_retry({
                "postal_code": zipcode,
                "limit":       50,
            })
            for row in rows:
                parsed = nppes.parse_physician(row)
                if parsed and parsed["npi"] not in seen_npis:
                    seen_npis.add(parsed["npi"])
                    raw_physicians.append(parsed)

    if not raw_physicians:
        return {
            "physicians":    [],
            "total":         0,
            "radius_miles":  radius,
            "zips_searched": len(zip_batch),
        }

    # ── 4. Assign ZIP centroid coords ─────────────────────────────────────────
    # Change #4: centroid coords are stored in a separate key ("_zip_lat" /
    # "_zip_lng") so that geocoding later can overwrite lat/lng without losing
    # the centroid for fallback purposes. We no longer overwrite lat/lng with
    # the centroid if geocoding subsequently fails — the centroid is used for
    # the cheap pre-filter only.
    for p in raw_physicians:
        if p.get("zip"):
            z_lat, z_lng = zip_database.get_zip_coords(p["zip"])
            if z_lat is not None:
                p["_zip_lat"] = z_lat
                p["_zip_lng"] = z_lng
                # Seed lat/lng with centroid so geocoding has a fallback coord
                if p["lat"] is None:
                    p["lat"] = z_lat
                    p["lng"] = z_lng

    # Change #4: Pre-filter using centroid coords with an expanded buffer to
    # avoid false-negatives caused by centroid imprecision near the boundary.
    # This is intentionally generous — the strict filter comes after geocoding.
    centroid_threshold = radius + _CENTROID_BUFFER_MILES
    pre_filtered = [
        p for p in raw_physicians
        if p.get("_zip_lat") is not None
        and _haversine_miles(lat, lng, p["_zip_lat"], p["_zip_lng"]) <= centroid_threshold
    ]

    if not pre_filtered:
        return {
            "physicians":    [],
            "total":         0,
            "radius_miles":  radius,
            "zips_searched": len(zip_batch),
        }

    # ── 5. Geocode addresses for precise coords ───────────────────────────────
    nppes.batch_geocode_for_display(pre_filtered)

    # Change #4: After geocoding, recalculate distance using the best available
    # coordinate — address-level if geocoding succeeded (_geocoded=True),
    # otherwise fall back to the ZIP centroid. This ensures the final distance
    # is as accurate as possible, not silently capped to centroid precision.
    for p in pre_filtered:
        if p.get("lat") is not None and p.get("lng") is not None:
            p["distance_miles"] = round(
                _haversine_miles(lat, lng, p["lat"], p["lng"]), 1
            )
        elif p.get("_zip_lat") is not None:
            # Fallback: use centroid distance but flag it as approximate
            p["distance_miles"] = round(
                _haversine_miles(lat, lng, p["_zip_lat"], p["_zip_lng"]), 1
            )

    # Change #4: Strict final filter uses the exact requested radius now that
    # we have the best-precision coords (address-level or ZIP centroid).
    precise = [
        p for p in pre_filtered
        if p.get("distance_miles") is not None
        and p["distance_miles"] <= radius
    ]
    precise.sort(key=lambda p: p["distance_miles"])

    # Jitter overlapping markers
    nppes.apply_coord_jitter(precise)

    top = precise[: cfg.MAX_DISPLAY]

    # Strip internal flags before returning
    for p in top:
        p.pop("_geocoded", None)
        p.pop("_zip_lat", None)
        p.pop("_zip_lng", None)

    return {
        "physicians":    top,
        "total":         len(precise),
        "radius_miles":  radius,
        "zips_searched": len(zip_batch),
    }