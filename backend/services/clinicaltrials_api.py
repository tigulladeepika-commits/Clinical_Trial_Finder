from __future__ import annotations

import logging
import re
from typing import Any

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://clinicaltrials.gov/api/v2/studies"
USER_AGENT = "ClinicalTrialLocator/1.0"
DEFAULT_PAGE_SIZE = 100

_ABSOLUTE_PAGE_CEILING = 200  # 200 × 100 = 20,000 studies max

# Maps 2-letter abbreviations (lowercased, stripped) → full state name (lowercased, stripped)
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

_VALID_STATES_NORMALIZED: frozenset[str] = frozenset(STATE_ABBREV_TO_FULL.values())
_CITY_RE = re.compile(r"^[A-Za-z\s\-\'\.\,]+$")


# ── Relevance scoring ──────────────────────────────────────────────────────────
#
# Problem: ClinicalTrials.gov's query.cond is a full-text search that matches
# the condition token anywhere in the study record (title, description,
# eligibility text, keywords).  This causes false positives like:
#   - "Improving Sleep in the Neurology In-Patient Population" appearing when
#     searching for "neurology" — the word appears in the title but the study
#     is about sleep, not a neurological condition.
#   - "Load Carriage on Upper Limb Performance" — no neurological relevance at
#     all, but matched a keyword in the eligibility criteria.
#
# Fix: after fetching each page we score every trial against the search term.
# Trials below MIN_RELEVANCE_SCORE are dropped before they reach the frontend.
#
# Scoring strategy (additive, capped at 100):
#   +50  The search term appears in the trial's conditions[] list
#   +30  The search term appears in the title (briefTitle)
#   +15  A domain-synonym of the search term appears in conditions[]
#   +10  The search term appears in the description (briefSummary)
#    -20  The search term appears ONLY in the title as an incidental word
#         (e.g. "Neurology" as a ward/department name, not a disease)
#
# MIN_RELEVANCE_SCORE = 30 means we require at least one strong signal
# (condition list hit) OR two weaker signals (title + description).

MIN_RELEVANCE_SCORE = 30

# Domain synonym groups: if the search term maps to any of these condition
# families, we boost trials whose conditions[] contain related terms.
# Keys are lowercased search terms (or common aliases); values are sets of
# condition tokens that confirm domain relevance.
_DOMAIN_SYNONYMS: dict[str, set[str]] = {
    "neurology": {
        "neurology", "neurological", "neurodegenerative", "alzheimer",
        "parkinson", "epilepsy", "seizure", "multiple sclerosis", "stroke",
        "dementia", "neuropathy", "brain", "spinal cord", "cerebral",
        "meningitis", "encephalitis", "migraine", "ataxia", "glioma",
        "glioblastoma", "als", "amyotrophic", "tremor", "dystonia",
        "myasthenia", "guillain", "hydrocephalus", "concussion",
        "neuromuscular", "peripheral nerve", "tbi", "vertigo", "dizziness",
    },
    "cardiology": {
        "cardiology", "cardiovascular", "cardiac", "heart", "coronary",
        "arrhythmia", "atrial fibrillation", "heart failure", "hypertension",
        "myocardial", "angina", "pacemaker", "valve", "aortic", "ventricular",
    },
    "oncology": {
        "cancer", "tumor", "carcinoma", "sarcoma", "lymphoma", "leukemia",
        "myeloma", "neoplasm", "malignant", "metastatic", "glioblastoma",
        "melanoma", "adenocarcinoma", "squamous cell",
    },
    "psychiatry": {
        "psychiatry", "depression", "anxiety", "bipolar", "schizophrenia",
        "mental health", "ptsd", "adhd", "ocd", "psychosis", "borderline",
        "personality disorder", "eating disorder",
    },
    "gastroenterology": {
        "gastroenterology", "gastrointestinal", "ibs", "crohn", "colitis",
        "ulcerative", "liver", "hepatitis", "cirrhosis", "gerd", "colonoscopy",
        "esophageal", "pancreatitis", "gallbladder",
    },
    "pulmonology": {
        "pulmonary", "respiratory", "asthma", "copd", "lung", "emphysema",
        "pneumonia", "fibrosis", "bronchitis", "sleep apnea",
    },
    "rheumatology": {
        "rheumatology", "arthritis", "lupus", "fibromyalgia", "sjogren",
        "scleroderma", "vasculitis", "gout", "autoimmune",
    },
    "dermatology": {
        "dermatology", "skin", "psoriasis", "eczema", "melanoma",
        "acne", "vitiligo", "alopecia",
    },
    "endocrinology": {
        "endocrinology", "diabetes", "thyroid", "obesity", "metabolic",
        "adrenal", "pituitary", "insulin", "hormones",
    },
    "nephrology": {
        "nephrology", "kidney", "renal", "dialysis", "proteinuria",
        "glomerular", "ckd",
    },
    "urology": {
        "urology", "bladder", "prostate", "urinary", "kidney stone",
        "erectile", "testicular",
    },
    "ophthalmology": {
        "ophthalmology", "eye", "vision", "glaucoma", "cataract", "retina",
        "macular degeneration",
    },
    "otolaryngology": {
        "otolaryngology", "ear", "nose", "throat", "sinus", "hearing",
        "tinnitus", "vertigo", "larynx",
    },
    "pediatrics": {
        "pediatric", "children", "infant", "neonatal", "childhood",
        "developmental", "congenital",
    },
    "geriatrics": {
        "geriatric", "elderly", "aging", "dementia", "fall prevention",
        "frailty", "older adults",
    },
    "infectious disease": {
        "infectious", "infection", "hiv", "tuberculosis", "sepsis",
        "hepatitis", "covid", "influenza", "malaria", "bacterial", "viral",
    },
}


def _norm_lower(text: str) -> str:
    """Lowercase and collapse whitespace for comparison."""
    return " ".join((text or "").lower().split())


def _score_trial_relevance(trial: dict[str, Any], search_term: str) -> int:
    """
    Return a relevance score in [0, 100] for how well *trial* matches
    *search_term* as a clinical domain.

    High score  → trial is genuinely about the searched domain.
    Low score   → trial only incidentally mentions the term.
    """
    term = _norm_lower(search_term)
    if not term:
        return 100  # no term → pass everything through

    score = 0

    # ── Gather text fields ─────────────────────────────────────────────────────
    conditions_raw: list[str] = [_norm_lower(c) for c in (trial.get("conditions") or [])]
    title     = _norm_lower(trial.get("title") or "")
    desc      = _norm_lower(trial.get("description") or "")
    sponsor   = _norm_lower(trial.get("sponsor") or "")

    # ── Pass 1: exact condition match (+50) ────────────────────────────────────
    # The term appears as (or inside) one of the trial's listed conditions.
    # This is the strongest signal — conditions[] is curated by the study team.
    if any(term in c or c in term for c in conditions_raw):
        score += 50

    # ── Pass 2: title match (+30) ──────────────────────────────────────────────
    # Term appears in the brief title.
    if term in title:
        score += 30

    # ── Pass 3: domain synonym match in conditions (+15) ──────────────────────
    # The search term maps to a known clinical domain and the trial's conditions
    # contain a term from that domain — confirms genuine clinical relevance.
    synonyms = _DOMAIN_SYNONYMS.get(term, set())
    if not synonyms:
        # Try partial synonym key match (e.g. "alzheimer" → neurology synonyms)
        for key, syn_set in _DOMAIN_SYNONYMS.items():
            if term in key or key in term or term in syn_set:
                synonyms = syn_set
                break

    if synonyms:
        conditions_text = " ".join(conditions_raw)
        if any(syn in conditions_text for syn in synonyms):
            if score < 50:  # only add if conditions match didn't already score
                score += 15

    # ── Pass 4: description match (+10) ───────────────────────────────────────
    # Term appears in the brief summary.
    if term in desc and score < 50:
        score += 10

    # ── Penalty: incidental title-only mentions (-20) ─────────────────────────
    # The term appears in the title but NOT in conditions[] and the title
    # strongly suggests the term is used as a setting/department name rather
    # than a disease domain (e.g. "Neurology In-Patient Population",
    # "Neurology Measures in FA Children").
    #
    # Heuristic: if score is entirely from title (+30) and not from conditions,
    # and the title contains department-style phrases, apply penalty.
    DEPARTMENT_PHRASES = {
        "in-patient", "inpatient", "outpatient", "ward", "unit",
        "department", "population", "measures in", "service",
    }
    if score == 30 and term in title:
        if any(phrase in title for phrase in DEPARTMENT_PHRASES):
            score -= 20

    return max(score, 0)


def _is_relevant(trial: dict[str, Any], search_term: str) -> bool:
    """Return True if the trial clears the minimum relevance threshold."""
    return _score_trial_relevance(trial, search_term) >= MIN_RELEVANCE_SCORE


# ── Existing helpers (unchanged) ──────────────────────────────────────────────

def _normalize_value(value: str | None) -> str:
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


# ── Validation helpers (unchanged) ────────────────────────────────────────────

def validate_city(city: str | None) -> tuple[bool, str]:
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
    if not state or not state.strip():
        return True, ""
    norm = _normalize_value(state.strip())
    if norm in STATE_ABBREV_TO_FULL:
        return True, ""
    if norm in _VALID_STATES_NORMALIZED:
        return True, ""
    return False, f"Unrecognised state: {state!r}"


def _matches_filters(trial: dict[str, Any], filters: dict[str, Any]) -> bool:
    normalized_status = _normalize_value(filters.get("status"))
    normalized_phase  = _normalize_value(filters.get("phase"))
    normalized_city   = _normalize_value(filters.get("city"))
    normalized_state  = _normalize_value(filters.get("state"))

    if normalized_status:
        trial_status_norm = _normalize_value(trial.get("status"))
        if (trial_status_norm != normalized_status
                and normalized_status not in trial_status_norm):
            return False

    if normalized_phase:
        trial_phases = [_normalize_value(p) for p in trial.get("phases", [])]
        if normalized_phase not in trial_phases:
            return False

    locations = trial.get("locations", [])

    if normalized_city and not any(
        _normalize_value(loc.get("city")) == normalized_city
        for loc in locations
    ):
        return False

    if normalized_state:
        resolved_state = STATE_ABBREV_TO_FULL.get(normalized_state, normalized_state)
        if not any(
            _normalize_value(loc.get("state")) == resolved_state
            for loc in locations
        ):
            return False

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
    Fetch, filter, and relevance-score trials from ClinicalTrials.gov.

    Pipeline per page:
      1. Fetch page from ClinicalTrials.gov (query.cond = raw condition string)
      2. Apply hard filters (status, phase, city, state, us_only)
      3. Apply relevance scoring — drop trials below MIN_RELEVANCE_SCORE
         This removes false positives where the search term appears incidentally
         in the study title/description but the trial is not clinically relevant
         to the searched domain (e.g. "Improving Sleep in the Neurology
         In-Patient Population" when searching for "neurology").
      4. Accumulate until we have (offset + limit) relevant results or exhaust
         all pages.

    Relevance scoring details — see _score_trial_relevance() above.
    """
    condition = (filters.get("condition") or "").strip()
    if not condition:
        return [], 0

    city_ok,  city_reason  = validate_city(filters.get("city"))
    state_ok, state_reason = validate_state(filters.get("state"))
    if not city_ok:
        logger.warning("Invalid city filter rejected: %s", city_reason)
        return [], 0
    if not state_ok:
        logger.warning("Invalid state filter rejected: %s", state_reason)
        return [], 0

    matched_trials: list[dict[str, Any]] = []
    page_token: str | None = None
    pages_fetched = 0
    total_count_estimate = 0

    needed = offset + limit

    while pages_fetched < _ABSOLUTE_PAGE_CEILING and len(matched_trials) < needed:
        payload = _fetch_study_page(condition, page_token)
        studies = payload.get("studies") or []

        if pages_fetched == 0:
            total_count_estimate = payload.get("totalCount", 0)

        if not studies:
            break

        for study in studies:
            mapped_trial = _map_trial(study)

            # Hard filters first (cheap)
            if not _matches_filters(mapped_trial, filters):
                continue

            # Relevance scoring (drops incidental matches)
            if not _is_relevant(mapped_trial, condition):
                rel_score = _score_trial_relevance(mapped_trial, condition)
                logger.debug(
                    "Filtered out low-relevance trial %s (score=%d): %s",
                    mapped_trial.get("nctId"), rel_score, mapped_trial.get("title"),
                )
                continue

            matched_trials.append(mapped_trial)

        page_token = payload.get("nextPageToken")
        pages_fetched += 1

        if not page_token:
            break

    paged = matched_trials[offset: offset + limit]
    total_count = len(matched_trials) if not page_token else total_count_estimate

    return paged, total_count


def fetch_study_detail(nct_id: str) -> dict[str, Any]:
    response = requests.get(
        f"{BASE_URL}/{nct_id}",
        headers={"User-Agent": USER_AGENT},
        timeout=20,
    )
    response.raise_for_status()
    return response.json()