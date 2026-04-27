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
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Query, Request, Response
from core.config import cfg
from core.validation import validate_lat_lng, validate_radius
from core.helpers import sanitise
from services import nppes, zip_database, taxonomy as tax_service
import logging, math

logger = logging.getLogger(__name__)
router = APIRouter()

_CENTROID_BUFFER_MILES = 5.0

def _haversine_miles(lat1, lon1, lat2, lon2):
    R = 3958.8
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


@router.get("/search")
async def search_physicians(
    request:       Request,
    lat:           float          = Query(...,  description="Latitude of trial site"),
    lng:           float          = Query(...,  description="Longitude of trial site"),
    radius:        float          = Query(25.0, description="Search radius in miles (1–100)"),
    specialty:     Optional[str]  = Query(None, description="Resolved from trial condition"),
    user_specialty: Optional[str] = Query(None, description="Extra filter added by user"),
    response:      Response       = None,
):
    # ── HTTP Caching (Issue #6): Cache physician search for 10 minutes.
    # Physicians near a trial location don't change frequently, so caching the
    # results helps when users expand search radius or change specialties (they
    # may go back to previous searches). The "private" directive ensures cache
    # is not shared across users.
    if response:
        response.headers["Cache-Control"] = "private, max-age=600"  # 10 minutes
    
    # ── 1. Validate ───────────────────────────────────────────────────────────
    try:
        lat, lng = validate_lat_lng(lat, lng)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    try:
        radius = validate_radius(radius)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # ── 2. Resolve specialties (OR logic) ─────────────────────────────────────
    descriptions: list[str] = []

    if specialty:
        clean = sanitise(specialty, cfg.MAX_DESC_LEN)
        if clean:
            resolved = tax_service.resolve(clean)
            descriptions.append(resolved)

    if user_specialty:
        clean = sanitise(user_specialty, cfg.MAX_DESC_LEN)
        if clean:
            resolved = tax_service.resolve(clean)
            # Only add if not already present (avoids duplicate NPPES queries)
            if resolved not in descriptions:
                descriptions.append(resolved)

    logger.info(
        "Physician search | lat=%.4f lng=%.4f radius=%.1fmi descriptions=%s",
        lat, lng, radius, descriptions or "any",
    )

    # ── 3. ZIP codes within radius ────────────────────────────────────────────
    if not zip_database.is_ready():
        zip_database.wait_for_ready(cfg.ZIP_DB_WAIT)

    nearby_zips = zip_database.find_zips_in_radius(lat, lng, radius)

    if not nearby_zips:
        return {"physicians": [], "total": 0, "radius_miles": radius, "zips_searched": 0}

    # ── 4. NPPES fan-out per ZIP × specialty ──────────────────────────────────
    # CRITICAL FIX: Add early stopping when we have enough results.
    # Previously, we'd query all MAX_ZIP_QUERIES ZIPs even if we already had
    # 100+ physicians. Now we stop once we hit 2× MAX_DISPLAY to ensure good
    # coverage but avoid unnecessary API calls (each call includes retries).
    seen_npis: set[str] = set()
    raw_physicians: list[dict] = []
    zip_batch = nearby_zips[: cfg.MAX_ZIP_QUERIES]
    early_stop_threshold = cfg.MAX_DISPLAY * 2  # Stop at 2× display count

    for zipcode in zip_batch:
        # Early stop: if we have enough results, break
        if len(raw_physicians) >= early_stop_threshold:
            break
        
        if descriptions:
            # OR: query each resolved specialty independently, merge results
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
                        # Tag which specialty matched for transparency
                        parsed["matched_specialty"] = desc
                        raw_physicians.append(parsed)
        else:
            rows, _ = nppes.fetch_with_retry({"postal_code": zipcode, "limit": 50})
            for row in rows:
                parsed = nppes.parse_physician(row)
                if parsed and parsed["npi"] not in seen_npis:
                    seen_npis.add(parsed["npi"])
                    raw_physicians.append(parsed)

    if not raw_physicians:
        return {"physicians": [], "total": 0, "radius_miles": radius, "zips_searched": len(zip_batch)}

    # ── 5. ZIP centroid pre-filter + geocode + strict distance filter ─────────
    for p in raw_physicians:
        if p.get("zip"):
            z_lat, z_lng = zip_database.get_zip_coords(p["zip"])
            if z_lat is not None:
                p["_zip_lat"] = z_lat
                p["_zip_lng"] = z_lng
                if p["lat"] is None:
                    p["lat"] = z_lat
                    p["lng"] = z_lng

    centroid_threshold = radius + _CENTROID_BUFFER_MILES
    pre_filtered = [
        p for p in raw_physicians
        if p.get("_zip_lat") is not None
        and _haversine_miles(lat, lng, p["_zip_lat"], p["_zip_lng"]) <= centroid_threshold
    ]

    if not pre_filtered:
        return {"physicians": [], "total": 0, "radius_miles": radius, "zips_searched": len(zip_batch)}

    nppes.batch_geocode_for_display(pre_filtered)

    for p in pre_filtered:
        if p.get("lat") is not None and p.get("lng") is not None:
            p["distance_miles"] = round(_haversine_miles(lat, lng, p["lat"], p["lng"]), 1)
        elif p.get("_zip_lat") is not None:
            p["distance_miles"] = round(_haversine_miles(lat, lng, p["_zip_lat"], p["_zip_lng"]), 1)

    precise = [
        p for p in pre_filtered
        if p.get("distance_miles") is not None and p["distance_miles"] <= radius
    ]
    precise.sort(key=lambda p: p["distance_miles"])

    nppes.apply_coord_jitter(precise)
    top = precise[: cfg.MAX_DISPLAY]

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