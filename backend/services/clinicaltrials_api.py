from __future__ import annotations

import logging
import re
from typing import Any

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://clinicaltrials.gov/api/v2/studies"
USER_AGENT = "ClinicalTrialLocator/1.0"
DEFAULT_PAGE_SIZE = 100

# Change #9: Removed MAX_PAGES cap entirely — we now exhaust all pages from
# ClinicalTrials.gov so the full dataset is available for client-side
# pagination. The UI controls how many results are shown at a time.
# A hard safety ceiling is kept only to prevent infinite loops on
# pathological responses (e.g. a malformed nextPageToken loop).
_ABSOLUTE_PAGE_CEILING = 200  # 200 × 100 = 20,000 studies max

# Maps 2-letter abbreviations (lowercased, stripped) → full state name (lowercased, stripped)
# The ClinicalTrials.gov API returns full state names like "Connecticut", "New York", etc.
STATE_ABBREV_TO_FULL = {
    "al": "alabama",           "ak": "alaska",          "az": "arizona",
    "ar": "arkansas",          "ca": "california",      "co": "colorado",
    "ct": "connecticut",       "de": "delaware",        "fl": "florida",
    "ga": "georgia",           "hi": "hawaii",          "id": "idaho",
    "il": "illinois",          "in": "indiana",         "ia": "iowa",
    "ks": "kansas",            "ky": "kentucky",        "la": "louisiana",
    "me": "maine",             "md": "maryland",        "ma": "massachusetts",
    "mi": "michigan",          "mn": "minnesota",       "ms": "mississippi",
    "mo": "missouri",          "mt": "montana",         "ne": "nebraska",
    "nv": "nevada",            "nh": "newhampshire",    "nj": "newjersey",
    "nm": "newmexico",         "ny": "newyork",         "nc": "northcarolina",
    "nd": "northdakota",       "oh": "ohio",            "ok": "oklahoma",
    "or": "oregon",            "pa": "pennsylvania",    "ri": "rhodeisland",
    "sc": "southcarolina",     "sd": "southdakota",     "tn": "tennessee",
    "tx": "texas",             "ut": "utah",            "vt": "vermont",
    "va": "virginia",          "wa": "washington",      "wv": "westvirginia",
    "wi": "wisconsin",         "wy": "wyoming",         "dc": "districtofcolumbia",
}

# Change #1: Set of known full state names (lowercased, stripped of spaces) for
# city/state validation — rejects nonsense values before hitting the API.
_VALID_STATES_NORMALIZED: frozenset[str] = frozenset(STATE_ABBREV_TO_FULL.values())

# Change #1: City must contain only letters, spaces, hyphens, apostrophes, and
# periods (handles names like "St. Paul", "Winston-Salem", "O'Fallon").
_CITY_RE = re.compile(r"^[A-Za-z\s\-\'\.\,]+$")


def _normalize_value(value: str | None) -> str:
    """Strip all non-alphanumeric characters and lowercase."""
    if not value:
        return ""
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _extract_text_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if item]
    if isinstance(value, str) and value:
        return [value]
    return []


def _map_location(location: dict[str, Any], overall_status: str | None = None) -> dict[str, Any]:
    geo_point = location.get("geoPoint") or {}
    site_status = location.get("recruitmentStatus") or None
    resolved_status = site_status if site_status else overall_status
    return {
        "facility": location.get("facility"),
        "city":     location.get("city"),
        "state":    location.get("state"),
        "country":  location.get("country"),
        "status":   resolved_status,
        "lat":      geo_point.get("lat"),
        "lon":      geo_point.get("lon"),
    }


def _map_trial(study: dict[str, Any]) -> dict[str, Any]:
    protocol       = study.get("protocolSection", {})
    identification = protocol.get("identificationModule", {})
    status_module  = protocol.get("statusModule", {})
    description    = protocol.get("descriptionModule", {})
    conditions     = protocol.get("conditionsModule", {})
    sponsor_info   = protocol.get("sponsorCollaboratorsModule", {})
    design         = protocol.get("designModule", {})
    contacts       = protocol.get("contactsLocationsModule", {})
    eligibility    = protocol.get("eligibilityModule", {})

    overall_status = status_module.get("overallStatus")

    central_contact = None
    central_contacts = contacts.get("centralContacts") or []
    if central_contacts:
        first_contact = central_contacts[0]
        central_contact = {
            "name":  first_contact.get("name"),
            "role":  first_contact.get("role"),
            "phone": first_contact.get("phone"),
            "email": first_contact.get("email"),
        }

    return {
        "nctId":             identification.get("nctId"),
        "title":             identification.get("briefTitle"),
        "status":            overall_status,
        "description":       description.get("briefSummary"),
        "conditions":        _extract_text_list(conditions.get("conditions")),
        "sponsor":           (sponsor_info.get("leadSponsor") or {}).get("name"),
        "phases":            _extract_text_list(design.get("phases")),
        "locations":         [
            _map_location(location, overall_status)
            for location in contacts.get("locations", [])
        ],
        "inclusionCriteria": eligibility.get("eligibilityCriteria"),
        "exclusionCriteria": None,
        "pointOfContact":    central_contact,
    }


# ── Change #1 & #2: Validation helpers ───────────────────────────────────────

def validate_city(city: str | None) -> tuple[bool, str]:
    """
    Validate a city filter value.

    Returns (is_valid, reason). A blank/None city is valid (means "no filter").
    Rejects values that contain digits or look like SQL/script injections.

    Change #1: city values are validated before being used in filter logic.
    """
    if not city or not city.strip():
        return True, ""
    stripped = city.strip()
    if len(stripped) < 2:
        return False, f"City name too short: {stripped!r}"
    if len(stripped) > 100:
        return False, "City name too long"
    if not _CITY_RE.match(stripped):
        return False, f"City contains invalid characters: {stripped!r}"
    return True, ""


def validate_state(state: str | None) -> tuple[bool, str]:
    """
    Validate a state filter value (2-letter abbreviation OR full name).

    Returns (is_valid, reason). A blank/None state is valid (means "no filter").

    Change #1: state values are validated and rejected early if unrecognised,
    rather than silently producing zero results.
    """
    if not state or not state.strip():
        return True, ""
    norm = _normalize_value(state.strip())
    # Accept known 2-letter abbreviations
    if norm in STATE_ABBREV_TO_FULL:
        return True, ""
    # Accept known full state names (after stripping spaces/punctuation)
    if norm in _VALID_STATES_NORMALIZED:
        return True, ""
    return False, f"Unrecognised state: {state!r}"


# ── Change #2: Revised filter matching ───────────────────────────────────────

def _matches_filters(trial: dict[str, Any], filters: dict[str, Any]) -> bool:
    """
    Return True if *trial* satisfies all active filters.

    Change #2 improvements:
    - Status filter now does a case-insensitive substring match (not exact),
      so "RECRUITING" matches "Recruiting", "Active, not recruiting", etc.
      Exact matches are still prioritised by being checked first.
    - Phase filter normalises both sides identically — strips all non-alnum
      chars and lowercases — so "PHASE1", "Phase 1", "phase1" all match.
    - City filter now checks all locations instead of requiring the first one
      to match (pre-existing behaviour was already correct but the guard is
      now explicit with a clear comment).
    - State filter expands both 2-letter abbreviations AND full state names
      entered by the user, ensuring bi-directional matching.
    - us_only filter normalises country strings more broadly to catch
      "United States", "US", "USA", "U.S.A." etc.
    """
    normalized_status = _normalize_value(filters.get("status"))
    normalized_phase  = _normalize_value(filters.get("phase"))
    normalized_city   = _normalize_value(filters.get("city"))
    normalized_state  = _normalize_value(filters.get("state"))

    # ── Status ────────────────────────────────────────────────────────────────
    if normalized_status:
        trial_status_norm = _normalize_value(trial.get("status"))
        # Exact match first, then substring (e.g. "active" matches "activenotrecruiting")
        if (trial_status_norm != normalized_status
                and normalized_status not in trial_status_norm):
            return False

    # ── Phase ─────────────────────────────────────────────────────────────────
    if normalized_phase:
        trial_phases = [_normalize_value(p) for p in trial.get("phases", [])]
        if normalized_phase not in trial_phases:
            return False

    locations = trial.get("locations", [])

    # ── City ──────────────────────────────────────────────────────────────────
    # Change #2: city must match ANY location, not just the first one.
    if normalized_city and not any(
        _normalize_value(loc.get("city")) == normalized_city
        for loc in locations
    ):
        return False

    # ── State ─────────────────────────────────────────────────────────────────
    # Change #2: resolve both 2-letter abbreviations (e.g. "CT" → "connecticut")
    # AND accept full-name inputs (e.g. "connecticut" already normalised).
    # The API returns full names; the frontend may send either form.
    if normalized_state:
        # Attempt abbreviation lookup first
        resolved_state = STATE_ABBREV_TO_FULL.get(normalized_state, normalized_state)
        if not any(
            _normalize_value(loc.get("state")) == resolved_state
            for loc in locations
        ):
            return False

    # ── US-only ───────────────────────────────────────────────────────────────
    # Change #2: broaden country matching — normalise away spaces, dots, etc.
    # "United States", "US", "USA", "U.S.A." all normalise to "unitedstates" / "us" / "usa".
    _US_NORMS = {"us", "usa", "unitedstates", "unitedstatesofamerica"}
    if filters.get("us_only"):
        if locations and not any(
            _normalize_value(loc.get("country")) in _US_NORMS
            for loc in locations
        ):
            return False

    return True


def _fetch_study_page(condition: str, page_token: str | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {
        "query.cond": condition,
        "pageSize":   DEFAULT_PAGE_SIZE,
        "countTotal": "true",
        "format":     "json",
    }
    if page_token:
        params["pageToken"] = page_token

    response = requests.get(
        BASE_URL,
        params=params,
        headers={"User-Agent": USER_AGENT},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()


def fetch_trials_with_filters(
    filters: dict[str, Any], limit: int, offset: int
) -> tuple[list[dict[str, Any]], int]:
    """
    Fetch and filter trials from ClinicalTrials.gov.

    Change #9: The MAX_PAGES cap is removed. We now exhaust all available
    pages (up to the safety ceiling of _ABSOLUTE_PAGE_CEILING) so the full
    matching dataset is returned to the caller. The API layer passes the
    full list to the frontend; pagination is handled client-side by
    usePhysicians / useTrials hooks (PAGE_SIZE = 10 per view).

    Change #1: city and state filters are pre-validated. If either is
    invalid the function returns immediately with an empty result rather
    than scanning thousands of records and returning 0 matches with no
    explanation.
    """
    condition = (filters.get("condition") or "").strip()
    if not condition:
        return [], 0

    # Change #1: Validate city and state before touching the API
    city_ok,  city_reason  = validate_city(filters.get("city"))
    state_ok, state_reason = validate_state(filters.get("state"))
    if not city_ok:
        logger.warning("Invalid city filter rejected: %s", city_reason)
        return [], 0
    if not state_ok:
        logger.warning("Invalid state filter rejected: %s", state_reason)
        return [], 0

    # Change #9: collect ALL matching trials, not just the first MAX_PAGES.
    # We pass *all* of them back and let the frontend paginate client-side.
    matched_trials: list[dict[str, Any]] = []
    page_token: str | None = None
    pages_fetched = 0

    while pages_fetched < _ABSOLUTE_PAGE_CEILING:
        payload = _fetch_study_page(condition, page_token)
        studies = payload.get("studies") or []
        if not studies:
            break

        for study in studies:
            mapped_trial = _map_trial(study)
            if _matches_filters(mapped_trial, filters):
                matched_trials.append(mapped_trial)

        page_token = payload.get("nextPageToken")
        pages_fetched += 1

        if not page_token:
            break

    # total reflects ALL matching records found across every page scanned.
    total_count = len(matched_trials)

    # Slice according to offset/limit so existing callers that do server-side
    # paging still work correctly, but the full count is always returned.
    paged = matched_trials[offset: offset + limit]
    return paged, total_count


def fetch_study_detail(nct_id: str) -> dict[str, Any]:
    response = requests.get(
        f"{BASE_URL}/{nct_id}",
        headers={"User-Agent": USER_AGENT},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()