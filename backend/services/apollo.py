"""
services/apollo.py — Apollo.io Email Lookup
============================================
Two-step pipeline:
  1. Search  — find the exact person by full cleaned name + city/state location
  2. Pick best match — when multiple results returned:
       a. Backfill empty name from first_name + last_name fields
       b. Filter by city/state match in person_location
       c. Prefer healthcare/medical industry (title or org keywords)
       d. Fall back to first result if no filters narrow it down
  3. Enrich  — fetch email only for the matched person_id

Strategy
--------
- Credentials stripped from name before search: "BETTY TONG, M.D." → "BETTY TONG"
- Location used to narrow multi-result sets (not as a hard API filter to avoid
  missing people whose Apollo location differs slightly from NPPES address).
- Healthcare scoring boosts physicians, nurses, professors, hospital staff.
- Similarity check (0.4 threshold) guards against wrong-person matches.
- If enriched record has no email → ApolloResult(found=True, email=None)
  so the caller shows the fallback popup.
"""

import logging
import re
from dataclasses import dataclass
from typing import Optional

import httpx

from core.config import cfg

logger = logging.getLogger(__name__)

APOLLO_SEARCH_URL = "https://api.apollo.io/api/v1/mixed_people/api_search"
APOLLO_ENRICH_URL = "https://api.apollo.io/api/v1/people/match"

_TIMEOUT = 15  # seconds per request

# ── Healthcare keyword sets ───────────────────────────────────────────────────

_HEALTHCARE_TITLE_KEYWORDS = {
    "physician", "doctor", "surgeon", "oncologist", "cardiologist",
    "neurologist", "radiologist", "pathologist", "psychiatrist",
    "dermatologist", "urologist", "nephrologist", "endocrinologist",
    "pulmonologist", "gastroenterologist", "rheumatologist", "internist",
    "pediatrician", "obstetrician", "gynecologist", "anesthesiologist",
    "md", "m.d", "do", "d.o", "mbbs", "professor", "associate professor",
    "assistant professor", "fellow", "resident", "attending",
    "nurse", "np", "pa", "pharmacist", "therapist", "clinician",
    "medical", "clinical", "health", "hospital", "cancer", "surgery",
    "medicine", "care", "treatment", "department of",
}

_HEALTHCARE_ORG_KEYWORDS = {
    "hospital", "medical", "health", "clinic", "cancer", "university",
    "institute", "center", "centre", "care", "surgery", "medicine",
    "pharma", "biotech", "research", "laboratory", "lab", "sciences",
    "therapeutics", "oncology", "cardiology", "radiology", "pathology",
    "mayo", "johns hopkins", "cleveland", "kaiser", "va ", "veterans",
    "memorial", "presbyterian", "baptist", "methodist", "general",
    "children", "pediatric", "womens", "women's",
}


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class ApolloResult:
    found:       bool
    email:       Optional[str]
    person_id:   Optional[str]
    apollo_name: Optional[str]
    error:       Optional[str]


_EMPTY = ApolloResult(found=False, email=None, person_id=None, apollo_name=None, error=None)


# ── Name helpers ──────────────────────────────────────────────────────────────

_TITLE_RE = re.compile(r"^(Dr\.?|MD\.?|DO\.?|Prof\.?)\s*", re.IGNORECASE)


def _clean_name(name: str) -> str:
    """Strip credential suffixes and leading honorifics."""
    # Remove everything after a comma: ", M.D." / ", AGACNP" / ", PhD"
    name = re.sub(r",\s*.+$", "", name).strip()
    # Remove leading honorifics
    return _TITLE_RE.sub("", name).strip()


def _backfill_name(person: dict) -> dict:
    """
    Apollo api_search sometimes returns name='' even when first_name/last_name
    are populated. Build the name from parts if the name field is empty.
    """
    if not person.get("name", "").strip():
        first = person.get("first_name", "").strip()
        last  = person.get("last_name",  "").strip()
        if first or last:
            person = dict(person)  # don't mutate the original
            person["name"] = f"{first} {last}".strip()
            logger.info("Apollo: backfilled name '%s' from first/last fields", person["name"])
    return person


def _name_similarity(a: str, b: str) -> float:
    """Token overlap ratio — 0.0 to 1.0."""
    ta = set(_clean_name(a).lower().split())
    tb = set(_clean_name(b).lower().split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(len(ta), len(tb))


# ── Location helpers ──────────────────────────────────────────────────────────

def _parse_city_state(address: str) -> tuple[str, str]:
    """Extract (city, state) from a physician address string."""
    if not address:
        return "", ""
    parts = [p.strip() for p in address.split(",")]
    for i in range(len(parts) - 1, -1, -1):
        tokens = parts[i].split()
        if tokens and len(tokens[0]) == 2 and tokens[0].isalpha():
            state = tokens[0].upper()
            city  = parts[i - 1] if i > 0 else ""
            return city, state
    if len(parts) >= 2:
        return parts[-2], parts[-1]
    return "", ""


def _location_matches(person: dict, city: str, state: str) -> bool:
    """
    Return True if the person's Apollo location contains the city or state.
    Checks person_location (string like "Phoenix, Arizona, United States").
    """
    if not city and not state:
        return False
    loc = (person.get("city") or person.get("person_location") or "").lower()
    if state and state.lower() in loc:
        return True
    if city and city.lower() in loc:
        return True
    return False


# ── Healthcare scoring ────────────────────────────────────────────────────────

def _healthcare_score(person: dict) -> int:
    """
    Score 0–2 indicating how likely this Apollo person is a healthcare professional.
      2 = strong signal (title AND org both look medical)
      1 = one signal
      0 = no signal
    """
    title = (person.get("title") or "").lower()
    org   = (person.get("organization", {}) or {})
    org_name = (org.get("name") or "").lower() if isinstance(org, dict) else ""

    title_hit = any(kw in title for kw in _HEALTHCARE_TITLE_KEYWORDS)
    org_hit   = any(kw in org_name for kw in _HEALTHCARE_ORG_KEYWORDS)

    return int(title_hit) + int(org_hit)


# ── Response parser ───────────────────────────────────────────────────────────

def _extract_people(data: dict) -> list:
    """Extract people list from Apollo response, trying all known key names."""
    logger.info("Apollo raw response keys: %s", list(data.keys()))
    for key in ("people", "contacts", "results", "persons", "data"):
        if key in data and isinstance(data[key], list):
            logger.info("Apollo: found %d results under key '%s'", len(data[key]), key)
            return data[key]
    logger.warning("Apollo: no people list found. Sample: %s", str(data)[:400])
    return []


# ── Best-match selection ──────────────────────────────────────────────────────

def _pick_best(
    people:  list,
    name:    str,
    city:    str,
    state:   str,
) -> Optional[dict]:
    """
    From a list of Apollo people, pick the best match for this physician.

    Priority:
      1. Name similarity ≥ 0.4  (hard filter — wrong person is worse than no person)
      2. Location match (city or state)  +  healthcare score
      3. Healthcare score alone
      4. First result with name similarity ≥ 0.4

    Logs the scoring for every candidate so diagnosis is easy.
    """
    # Backfill empty names and attach scores
    scored = []
    for raw in people:
        p    = _backfill_name(raw)
        sim  = _name_similarity(name, p.get("name", ""))
        loc  = _location_matches(p, city, state)
        hc   = _healthcare_score(p)
        logger.info(
            "Apollo candidate | name='%s' | title='%s' | org='%s' | "
            "location='%s' | sim=%.2f | loc_match=%s | hc_score=%d",
            p.get("name", ""), p.get("title", ""),
            (p.get("organization") or {}).get("name", "") if isinstance(p.get("organization"), dict) else "",
            p.get("city") or p.get("person_location", ""),
            sim, loc, hc,
        )
        if sim >= 0.4:
            scored.append((p, sim, loc, hc))

    if not scored:
        logger.info("Apollo: no candidates passed name similarity threshold (0.4)")
        return None

    # Sort: location_match DESC, healthcare_score DESC, similarity DESC
    scored.sort(key=lambda x: (x[2], x[3], x[1]), reverse=True)

    best, sim, loc, hc = scored[0]
    logger.info(
        "Apollo: selected '%s' | sim=%.2f | loc_match=%s | hc_score=%d",
        best.get("name", ""), sim, loc, hc,
    )
    return best


# ── Core pipeline ─────────────────────────────────────────────────────────────

async def find_physician_email(
    name:         str,
    address:      str = "",
    organization: str = "",
    city:         str = "",
    state:        str = "",
) -> ApolloResult:
    """
    Main entry point. Steps:
      1. Clean name (strip credentials/honorifics).
      2. Search Apollo with name + location.
      3. If org provided and no hit, retry without org.
      4. Pick best match from results using location + healthcare scoring.
      5. Enrich matched person for email.
    """
    if not cfg.APOLLO_API_KEY:
        logger.warning("APOLLO_API_KEY not set — skipping email lookup")
        return ApolloResult(
            found=False, email=None, person_id=None, apollo_name=None,
            error="Apollo API key not configured",
        )

    if not city and not state and address:
        city, state = _parse_city_state(address)

    clean = _clean_name(name)
    logger.info("Apollo: searching for '%s' (cleaned from '%s') | city=%s state=%s",
                clean, name, city or "-", state or "-")

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        # Step 1: search with org filter
        people = []
        if organization:
            people = await _search_people(client, clean, city, state, organization)

        # Step 2: retry without org if no results
        if not people:
            people = await _search_people(client, clean, city, state, organization="")

        if not people:
            logger.info("Apollo: no results for '%s'", name)
            return _EMPTY

        # Step 3: pick best match
        person = _pick_best(people, name, city, state)
        if person is None:
            logger.info("Apollo: no confident match for '%s'", name)
            return _EMPTY

        person_id   = person.get("id")
        apollo_name = person.get("name", "")

        # Step 4: enrich for email
        email = await _enrich_person(client, person_id, apollo_name, organization)

    logger.info("Apollo result | name='%s' | found=True | has_email=%s", name, bool(email))
    return ApolloResult(
        found=True,
        email=email,
        person_id=person_id,
        apollo_name=apollo_name,
        error=None,
    )


# ── Private helpers ───────────────────────────────────────────────────────────

async def _search_people(
    client:       httpx.AsyncClient,
    name:         str,
    city:         str,
    state:        str,
    organization: str,
) -> list:
    """
    POST to Apollo api_search. Returns raw people list (may be empty).
    Fetches up to 10 results so the picker has enough candidates.
    """
    payload: dict = {
        "q_keywords": name,
        "page":       1,
        "per_page":   10,
    }

    if city:
        payload["person_locations"] = [f"{city}, {state}".strip(", ")] if state else [city]
    elif state:
        payload["person_locations"] = [state]

    if organization:
        payload["q_organization_name"] = organization

    try:
        resp = await client.post(
            APOLLO_SEARCH_URL,
            json=payload,
            headers={
                "Content-Type":  "application/json",
                "Cache-Control": "no-cache",
                "X-Api-Key":     cfg.APOLLO_API_KEY,
            },
        )
        resp.raise_for_status()
        return _extract_people(resp.json())

    except httpx.HTTPStatusError as exc:
        logger.warning("Apollo search HTTP %d: %s",
                       exc.response.status_code, exc.response.text[:300])
        return []
    except Exception as exc:
        logger.error("Apollo search error: %s", exc)
        return []


async def _enrich_person(
    client:       httpx.AsyncClient,
    person_id:    Optional[str],
    name:         str,
    organization: str,
) -> Optional[str]:
    """Enrich a specific person_id to retrieve their email."""
    payload: dict = {"reveal_personal_emails": False}

    if person_id:
        payload["id"] = person_id
    else:
        payload["name"] = name
        if organization:
            payload["organization_name"] = organization

    try:
        resp = await client.post(
            APOLLO_ENRICH_URL,
            json=payload,
            headers={
                "Content-Type":  "application/json",
                "Cache-Control": "no-cache",
                "X-Api-Key":     cfg.APOLLO_API_KEY,
            },
        )
        resp.raise_for_status()
        data   = resp.json()
        person = data.get("person") or {}
        email  = person.get("email") or None

        if email and person.get("email_status") in ("invalid", "unverified_catchall"):
            logger.info("Apollo: email status '%s' — treating as unavailable",
                        person["email_status"])
            email = None

        return email

    except httpx.HTTPStatusError as exc:
        logger.warning("Apollo enrich HTTP %d: %s",
                       exc.response.status_code, exc.response.text[:300])
        return None
    except Exception as exc:
        logger.error("Apollo enrich error: %s", exc)
        return None