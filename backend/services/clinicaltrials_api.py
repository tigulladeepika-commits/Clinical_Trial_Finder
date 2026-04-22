from __future__ import annotations

import logging
import re
from typing import Any

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://clinicaltrials.gov/api/v2/studies"
USER_AGENT = "ClinicalTrialLocator/1.0"
DEFAULT_PAGE_SIZE = 100
MAX_PAGES = 10

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


def _matches_filters(trial: dict[str, Any], filters: dict[str, Any]) -> bool:
    normalized_status = _normalize_value(filters.get("status"))
    # FIX: use _normalize_value directly — the old _normalize_phase was a no-op
    # (it replaced "phase" with "phase") and has been removed.
    # _normalize_value strips underscores/spaces/hyphens, so both
    # "PHASE1" (from API) and "phase1" (from frontend) → "phase1". ✓
    normalized_phase  = _normalize_value(filters.get("phase"))
    normalized_city   = _normalize_value(filters.get("city"))
    normalized_state  = _normalize_value(filters.get("state"))

    if normalized_status and _normalize_value(trial.get("status")) != normalized_status:
        return False

    if normalized_phase:
        trial_phases = [_normalize_value(phase) for phase in trial.get("phases", [])]
        if normalized_phase not in trial_phases:
            return False

    locations = trial.get("locations", [])

    if normalized_city and not any(
        _normalize_value(location.get("city")) == normalized_city
        for location in locations
    ):
        return False

    # Expand 2-letter abbreviation to full state name before comparing.
    # The API returns full names like "Connecticut", "New York", etc.
    # The frontend sends abbreviations like "CT", "NY" → normalize → "ct", "ny".
    if normalized_state:
        resolved_state = STATE_ABBREV_TO_FULL.get(normalized_state, normalized_state)
        if not any(
            _normalize_value(location.get("state")) == resolved_state
            for location in locations
        ):
            return False

    if filters.get("us_only"):
        if locations and not any(
            _normalize_value(location.get("country")) in {"us", "usa", "unitedstates"}
            for location in locations
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
    condition = (filters.get("condition") or "").strip()
    if not condition:
        return [], 0

    matched_trials: list[dict[str, Any]] = []
    processed_matches = 0
    page_token: str | None = None
    pages_fetched = 0

    while pages_fetched < MAX_PAGES:
        payload = _fetch_study_page(condition, page_token)
        studies = payload.get("studies") or []
        if not studies:
            break

        for study in studies:
            mapped_trial = _map_trial(study)
            if not _matches_filters(mapped_trial, filters):
                continue

            processed_matches += 1
            if processed_matches > offset and len(matched_trials) < limit:
                matched_trials.append(mapped_trial)

        page_token = payload.get("nextPageToken")
        pages_fetched += 1

        if not page_token:
            break

    # NOTE: processed_matches only reflects studies scanned so far
    # (up to MAX_PAGES × DEFAULT_PAGE_SIZE = 1 000 studies).
    # The actual total across all ClinicalTrials.gov pages may be higher.
    # The API response labels this as "matched_in_scan" so the UI can
    # surface a "showing results from first N pages" caveat if needed.
    total_count = processed_matches
    return matched_trials, total_count


def fetch_study_detail(nct_id: str) -> dict[str, Any]:
    response = requests.get(
        f"{BASE_URL}/{nct_id}",
        headers={"User-Agent": USER_AGENT},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()