"""
api/physicians.py
GET /api/physicians/search   — main list (search-criteria driven, max 10, no nurses/pharmacists)
GET /api/physicians/suggested — suggested list (trial-condition driven, broader specialties, max 5)

Changes v4:
  - Added /suggested endpoint that uses only the trial condition to find
    related/supporting specialists (e.g. pediatricians for childhood cancer).
  - Both endpoints now filter out non-physician provider types:
    nurses, pharmacists, medical assistants, technicians, etc.
  - MAX_DISPLAY for /search stays at 10 (cfg.MAX_DISPLAY).
  - /suggested hard-caps at MAX_SUGGESTED = 5.
  - specialty / initial_specialty / user_specialty still accept repeated
    query params (List[str]) so the frontend can send multiple values per
    field without joining them into a comma string.
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
MAX_SUGGESTED = 5

# ── Non-physician taxonomy keywords to exclude ────────────────────────────────
# These are matched case-insensitively against taxonomy_desc.
# Covers: nurses, pharmacists, medical assistants, technicians, therapists
# (non-physician), aides, case managers, counselors, social workers, etc.
_EXCLUDED_TAXONOMY_KEYWORDS = [
    # Nursing
    "nurse",
    "nursing",
    "registered nurse",
    "licensed practical",
    "licensed vocational",
    "nurse practitioner",   # keep this? Some orgs want NPs — comment out to include NPs
    "clinical nurse",
    "certified nurse",
    # Pharmacy
    "pharmacist",
    "pharmacy",
    # Allied health
    "medical assistant",
    "physician assistant",  # comment out if you want PAs included
    "technician",
    "technologist",
    "therapist",
    "physical therapy",
    "occupational therapy",
    "speech",
    "audiologist",
    "optician",
    "dietitian",
    "nutritionist",
    "social worker",
    "counselor",
    "case manager",
    "health educator",
    "community health",
    "home health",
    "aide",
    "assistant",
    "coordinator",
    "administrator",
    "dental",
    "dentist",
    "orthodontist",
    "podiatrist",         # comment out if you want podiatrists
    "chiropractor",
    "acupuncturist",
    "midwife",
    "doula",
    "paramedic",
    "emergency medical",
    "phlebotomist",
    "radiology technician",
    "radiology technologist",
]

def _is_excluded_provider(taxonomy_desc: Optional[str]) -> bool:
    """Return True if the provider type should be excluded from results."""
    if not taxonomy_desc:
        return False
    lower = taxonomy_desc.lower()
    return any(kw in lower for kw in _EXCLUDED_TAXONOMY_KEYWORDS)


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


def _run_physician_search(
    lat: float,
    lng: float,
    radius: float,
    query_descriptions: list[str],
    max_display: int,
) -> dict:
    """
    Core physician search logic shared by /search and /suggested.
    Filters out non-physician providers.
    Returns a dict matching the API response shape.
    """
    if not query_descriptions:
        return {
            "physicians":         [],
            "total":              0,
            "radius_miles":       radius,
            "zips_searched":      0,
            "search_specialties": [],
        }

    # ── ZIP codes within radius ───────────────────────────────────────────────
    if not zip_database.is_ready():
        zip_database.wait_for_ready(cfg.ZIP_DB_WAIT)

    nearby_zips = zip_database.find_zips_in_radius(lat, lng, radius)
    if not nearby_zips:
        return {
            "physicians":         [],
            "total":              0,
            "radius_miles":       radius,
            "zips_searched":      0,
            "search_specialties": query_descriptions,
        }

    # ── NPPES fan-out per ZIP × specialty ─────────────────────────────────────
    seen_npis:      set[str]   = set()
    raw_physicians: list[dict] = []
    zip_batch            = nearby_zips[: cfg.MAX_ZIP_QUERIES]
    early_stop_threshold = max_display * 4   # fetch more so filtering doesn't starve results

    for zipcode in zip_batch:
        if len(raw_physicians) >= early_stop_threshold:
            break
        for desc in query_descriptions:
            rows, _ = nppes.fetch_with_retry({
                "postal_code":          zipcode,
                "taxonomy_description": desc,
                "limit":                50,
            })
            for row in rows:
                parsed = nppes.parse_physician(row)
                if parsed and parsed["npi"] not in seen_npis:
                    # Filter out nurses, pharmacists, and other non-physicians
                    if _is_excluded_provider(parsed.get("taxonomy_desc")):
                        continue
                    seen_npis.add(parsed["npi"])
                    parsed["matched_specialty"] = desc
                    raw_physicians.append(parsed)

    if not raw_physicians:
        return {
            "physicians":         [],
            "total":              0,
            "radius_miles":       radius,
            "zips_searched":      len(zip_batch),
            "search_specialties": query_descriptions,
        }

    # ── ZIP centroid pre-filter + geocode + strict distance filter ────────────
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
            "physicians":         [],
            "total":              0,
            "radius_miles":       radius,
            "zips_searched":      len(zip_batch),
            "search_specialties": query_descriptions,
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
    top = precise[:max_display]

    for p in top:
        p.pop("_geocoded", None)
        p.pop("_zip_lat", None)
        p.pop("_zip_lng", None)

    return {
        "physicians":         top,
        "total":              len(precise),
        "radius_miles":       radius,
        "zips_searched":      len(zip_batch),
        "search_specialties": query_descriptions,
    }


# ── /search ───────────────────────────────────────────────────────────────────
# Main physician list — driven by the user's search criteria (initial_specialty
# / user_specialty). The trial condition (specialty) is used only as a
# fallback when no user-specific specialty is provided.

@router.get("/search")
async def search_physicians(
    request:           Request,
    lat:               float                   = Query(...,  description="Latitude of trial site"),
    lng:               float                   = Query(...,  description="Longitude of trial site"),
    radius:            float                   = Query(25.0, description="Search radius in miles (1–100)"),
    specialty:         Optional[List[str]]     = Query(None, description="Resolved from trial condition — multiple allowed"),
    initial_specialty: Optional[List[str]]     = Query(None, description="Specialty from user's first search — multiple allowed"),
    user_specialty:    Optional[List[str]]     = Query(None, description="Extra specialty entered by user — multiple allowed"),
    response:          Response                = None,
):
    if response:
        response.headers["Cache-Control"] = "private, max-age=600"

    try:
        lat, lng = validate_lat_lng(lat, lng)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    try:
        radius = validate_radius(radius)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    # ── Resolve specialties — user criteria take priority ─────────────────────
    # Order: initial_specialty → user_specialty → specialty (trial condition fallback)
    # This ensures the main list is driven by user intent, not the trial.
    resolved_groups: list[list[str]] = []

    def _collect(raw: Optional[str]) -> None:
        resolved = _resolve_specialty_input(raw)
        if resolved:
            resolved_groups.append(resolved)

    # User-supplied specialties first (highest priority)
    for s in (initial_specialty or []):
        _collect(s)
    for s in (user_specialty    or []):
        _collect(s)
    # Trial condition as fallback only when no user specialty provided
    if not resolved_groups:
        for s in (specialty or []):
            _collect(s)

    descriptions: list[str] = []
    seen_descs:   set[str]  = set()

    def _add(desc: str) -> None:
        if not desc or desc in seen_descs or len(descriptions) >= cfg.MAX_DESC_COUNT:
            return
        seen_descs.add(desc)
        descriptions.append(desc)

    for group in resolved_groups:
        if group:
            _add(group[0])
    for group in resolved_groups:
        for desc in group[1:]:
            _add(desc)

    query_descriptions = descriptions[: cfg.MAX_TAX_QUERIES]

    if not query_descriptions:
        return {
            "physicians":         [],
            "total":              0,
            "radius_miles":       radius,
            "zips_searched":      0,
            "search_specialties": [],
        }

    logger.info(
        "Physician /search | lat=%.4f lng=%.4f radius=%.1fmi "
        "initial=%r user=%r specialty=%r → descriptions=%s",
        lat, lng, radius,
        initial_specialty, user_specialty, specialty,
        query_descriptions,
    )

    return _run_physician_search(lat, lng, radius, query_descriptions, cfg.MAX_DISPLAY)


# ── /suggested ────────────────────────────────────────────────────────────────
# Suggested physicians — driven exclusively by the trial condition.
# Resolves broader/related specialties so e.g. "childhood cancer" surfaces
# both oncologists AND pediatricians. Hard-capped at MAX_SUGGESTED (5).
# NPIs already returned by /search are excluded via the `exclude_npis` param.

@router.get("/suggested")
async def suggested_physicians(
    request:      Request,
    lat:          float            = Query(...,  description="Latitude of trial site"),
    lng:          float            = Query(...,  description="Longitude of trial site"),
    radius:       float            = Query(25.0, description="Search radius in miles (1–100)"),
    condition:    Optional[str]    = Query(None, description="Trial condition — drives specialty resolution"),
    exclude_npis: Optional[List[str]] = Query(None, description="NPIs already shown in main list — excluded from suggested"),
    response:     Response         = None,
):
    if response:
        response.headers["Cache-Control"] = "private, max-age=600"

    try:
        lat, lng = validate_lat_lng(lat, lng)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    try:
        radius = validate_radius(radius)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    if not condition or not condition.strip():
        return {
            "physicians":         [],
            "total":              0,
            "radius_miles":       radius,
            "zips_searched":      0,
            "search_specialties": [],
        }

    # Resolve the trial condition to a broad set of related specialties.
    # resolve_with_broader() already returns primary + supporting specialties.
    clean_condition = sanitise(condition.strip(), cfg.MAX_DESC_LEN)
    all_resolved    = tax_service.resolve_with_broader(clean_condition)

    if not all_resolved:
        return {
            "physicians":         [],
            "total":              0,
            "radius_miles":       radius,
            "zips_searched":      0,
            "search_specialties": [],
        }

    # Use a slightly larger set of descriptions for suggested so we surface
    # supporting specialties (e.g. Pediatrics alongside Pediatric Oncology).
    query_descriptions = all_resolved[: cfg.MAX_TAX_QUERIES + 2]

    exclude_set = set(exclude_npis or [])

    logger.info(
        "Physician /suggested | lat=%.4f lng=%.4f radius=%.1fmi "
        "condition=%r → descriptions=%s (excluding %d npis)",
        lat, lng, radius, condition, query_descriptions, len(exclude_set),
    )

    result = _run_physician_search(lat, lng, radius, query_descriptions, MAX_SUGGESTED * 4)

    # Remove any NPIs already in the main list, then cap at MAX_SUGGESTED
    filtered = [p for p in result["physicians"] if p["npi"] not in exclude_set]
    filtered = filtered[:MAX_SUGGESTED]

    return {
        "physicians":         filtered,
        "total":              max(0, result["total"] - len(exclude_set)),
        "radius_miles":       result["radius_miles"],
        "zips_searched":      result["zips_searched"],
        "search_specialties": result["search_specialties"],
    }