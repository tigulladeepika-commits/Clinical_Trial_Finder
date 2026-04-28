"""
api/physicians.py
GET /api/physicians/search

Accepts a trial site's lat/lng (from ClinicalTrials.gov geoPoint),
a search radius in miles, and optional specialty filters.
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
    most precise coords available.
  - Change #1: lat/lng/radius are validated before any downstream calls.
  - Change #SPECIALTY: Three specialty inputs are now accepted and combined
    with OR logic:
      specialty         — raw condition/specialty extracted from the trial;
                          resolved via resolve_with_broader() to real NUCC codes.
      initial_specialty — the specialty the user searched with originally;
                          always included even when user edits the field.
      user_specialty    — any additional specialty the user explicitly enters
                          in the override field.
    All three are resolved independently and merged (de-duplicated). NPPES
    is queried once per unique resolved specialty string.
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


def _resolve_specialty_input(raw: Optional[str]) -> list[str]:
    """
    Sanitise a raw specialty/condition string and resolve it to one or more
    NUCC taxonomy descriptions via resolve_with_broader().
    Returns an empty list when raw is None / empty.
    """
    if not raw:
        return []
    clean = sanitise(raw, cfg.MAX_DESC_LEN)
    if not clean:
        return []
    return tax_service.resolve_with_broader(clean)


@router.get("/search")
async def search_physicians(
    request:           Request,
    lat:               float          = Query(...,  description="Latitude of trial site"),
    lng:               float          = Query(...,  description="Longitude of trial site"),
    radius:            float          = Query(25.0, description="Search radius in miles (1–100)"),
    specialty:         Optional[str]  = Query(None, description="Resolved from trial condition (raw condition text)"),
    initial_specialty: Optional[str]  = Query(None, description="Specialty used in the user's very first search — always OR-included"),
    user_specialty:    Optional[str]  = Query(None, description="Extra specialty explicitly entered by the user"),
    response:          Response       = None,
):
    # ── HTTP Caching ──────────────────────────────────────────────────────────
    if response:
        response.headers["Cache-Control"] = "private, max-age=600"

    # ── 1. Validate ───────────────────────────────────────────────────────────
    try:
        lat, lng = validate_lat_lng(lat, lng)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    try:
        radius = validate_radius(radius)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # ── 2. Resolve all specialty inputs → unified OR list ─────────────────────
    #
    # Each of the three inputs is resolved independently via resolve_with_broader()
    # which tries exact NUCC match → prefix → substring → token overlap.
    # Results are merged with OR (de-duplicated, order preserved):
    #   [specialty results] + [initial_specialty results] + [user_specialty results]
    #
    # If NONE of the inputs produce a resolved specialty (e.g. unrecognised
    # condition with no taxonomy mapping) we fall back to including the raw
    # strings themselves so NPPES still gets something to query against.

    descriptions: list[str] = []
    seen_descs: set[str] = set()

    def _add_resolved(raw: Optional[str]) -> None:
        resolved = _resolve_specialty_input(raw)
        for spec in resolved:
            if spec not in seen_descs:
                seen_descs.add(spec)
                descriptions.append(spec)

    _add_resolved(specialty)
    _add_resolved(initial_specialty)
    _add_resolved(user_specialty)

    # Fallback: if nothing resolved, include the raw strings so NPPES still
    # receives something to search (better than returning zero results).
    if not descriptions:
        for raw in [specialty, initial_specialty, user_specialty]:
            if raw:
                clean = sanitise(raw, cfg.MAX_DESC_LEN)
                if clean and clean not in seen_descs:
                    seen_descs.add(clean)
                    descriptions.append(clean)

    logger.info(
        "Physician search | lat=%.4f lng=%.4f radius=%.1fmi "
        "specialty=%r initial_specialty=%r user_specialty=%r → descriptions=%s",
        lat, lng, radius, specialty, initial_specialty, user_specialty,
        descriptions or "any",
    )

    # ── 3. ZIP codes within radius ────────────────────────────────────────────
    if not zip_database.is_ready():
        zip_database.wait_for_ready(cfg.ZIP_DB_WAIT)

    nearby_zips = zip_database.find_zips_in_radius(lat, lng, radius)

    if not nearby_zips:
        return {
            "physicians":        [],
            "total":             0,
            "radius_miles":      radius,
            "zips_searched":     0,
            "search_specialties": descriptions,
        }

    # ── 4. NPPES fan-out per ZIP × specialty ──────────────────────────────────
    seen_npis: set[str] = set()
    raw_physicians: list[dict] = []
    zip_batch = nearby_zips[: cfg.MAX_ZIP_QUERIES]
    early_stop_threshold = cfg.MAX_DISPLAY * 2

    for zipcode in zip_batch:
        if len(raw_physicians) >= early_stop_threshold:
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
        return {
            "physicians":        [],
            "total":             0,
            "radius_miles":      radius,
            "zips_searched":     len(zip_batch),
            "search_specialties": descriptions,
        }

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
        return {
            "physicians":        [],
            "total":             0,
            "radius_miles":      radius,
            "zips_searched":     len(zip_batch),
            "search_specialties": descriptions,
        }

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
        "physicians":         top,
        "total":              len(precise),
        "radius_miles":       radius,
        "zips_searched":      len(zip_batch),
        "search_specialties": descriptions,   # tell UI exactly what was searched
    }