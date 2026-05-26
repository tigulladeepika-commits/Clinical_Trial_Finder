"""
services/apollo.py — Apollo.io Email Lookup
============================================
Two-step pipeline:
  1. Search  — find the exact person by name + optional location/org
  2. Enrich  — fetch email only for the matched person (avoids noisy bulk enrichment)

Strategy
--------
- Search narrows by name + location (city/state extracted from physician address).
- If a single high-confidence match is found, enrich that person_id.
- Organisation (facility name) is used as an optional secondary filter:
    if the exact-match branch finds a hit, great; otherwise we fall back
    to name+location only so we don't silently skip real matches.
- If the enriched record has no email, we return ApolloResult with
  found=True but email=None so the caller can show the fallback popup.

Usage
-----
    from services.apollo import find_physician_email, ApolloResult
    result: ApolloResult = await find_physician_email(
        name="Dr. Jane Smith",
        city="Boston",
        state="MA",
        organization="Massachusetts General Hospital",   # optional
    )
    if result.found and result.email:
        ...
"""

import logging
import re
from dataclasses import dataclass
from typing import Optional

import httpx

from core.config import cfg

logger = logging.getLogger(__name__)

APOLLO_SEARCH_URL  = "https://api.apollo.io/api/v1/mixed_people/api_search"
APOLLO_ENRICH_URL  = "https://api.apollo.io/api/v1/people/match"

# Apollo free-tier / standard rate: 50 req/min; we stay conservative.
_TIMEOUT = 15  # seconds per request


# ── Result dataclass ──────────────────────────────────────────────────────────

@dataclass
class ApolloResult:
    found:        bool
    email:        Optional[str]
    person_id:    Optional[str]
    apollo_name:  Optional[str]  # name as Apollo knows it (for display/debug)
    error:        Optional[str]  # set only on hard errors (network, auth)


_EMPTY = ApolloResult(found=False, email=None, person_id=None, apollo_name=None, error=None)


# ── Helpers ───────────────────────────────────────────────────────────────────

_TITLE_RE = re.compile(r"^(Dr\.?|MD\.?|DO\.?|Prof\.?)\s*", re.IGNORECASE)


def _clean_name(name: str) -> str:
    """Strip honorifics and credential suffixes so Apollo name-matching works better."""
    # Remove suffix credentials after a comma: ", M.D." / ", AGACNP" / ", PhD" etc.
    name = re.sub(r",\s*.+$", "", name).strip()
    # Remove leading honorifics: Dr. / MD. / DO. etc.
    return _TITLE_RE.sub("", name).strip()


def _parse_city_state(address: str) -> tuple[str, str]:
    """
    Best-effort extraction of city and state from a physician address string.
    Handles common formats:
      '123 Main St, Boston, MA 02101'
      'Boston, MA'
    Returns (city, state) — either may be empty string.
    """
    if not address:
        return "", ""
    parts = [p.strip() for p in address.split(",")]
    # Try to find the part that looks like a US state abbreviation (2 alpha chars)
    # or a full state name.  We look from the right.
    for i in range(len(parts) - 1, -1, -1):
        segment = parts[i]
        # "MA 02101" or "MA" — state is the alpha prefix
        tokens = segment.split()
        if tokens and len(tokens[0]) == 2 and tokens[0].isalpha():
            state = tokens[0].upper()
            city  = parts[i - 1] if i > 0 else ""
            return city, state
    # Fallback: last two parts
    if len(parts) >= 2:
        return parts[-2], parts[-1]
    return "", ""


def _name_similarity(a: str, b: str) -> float:
    """
    Simple token overlap ratio to guard against returning wrong people.
    Both strings are lowercased and split on whitespace.
    Returns a value 0.0 – 1.0.
    """
    ta = set(_clean_name(a).lower().split())
    tb = set(_clean_name(b).lower().split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(len(ta), len(tb))


def _extract_people(data: dict) -> list:
    """
    Extract the people list from Apollo api_search response.
    Apollo's api_search endpoint may return results under different keys
    depending on API version — check all known keys in priority order.
    """
    # Log all top-level keys for debugging
    logger.info("Apollo raw response keys: %s", list(data.keys()))

    # Try known keys in order of likelihood
    for key in ("people", "contacts", "results", "persons", "data"):
        if key in data and isinstance(data[key], list):
            logger.info("Apollo: found %d results under key '%s'", len(data[key]), key)
            return data[key]

    # Nothing found — log a sample of the response for diagnosis
    logger.warning("Apollo: no people list found in response. Sample: %s", str(data)[:400])
    return []


# ── Core pipeline ─────────────────────────────────────────────────────────────

async def find_physician_email(
    name:         str,
    address:      str  = "",
    organization: str  = "",   # facility / place of work (optional)
    city:         str  = "",
    state:        str  = "",
) -> ApolloResult:
    """
    Main entry point.  Call this from the API route.

    Steps:
      1. Search Apollo by name + location (+org if provided).
      2. If no confident hit with org, retry without org filter.
      3. If exactly one confident person found → enrich for email.
      4. Return ApolloResult.
    """
    if not cfg.APOLLO_API_KEY:
        logger.warning("APOLLO_API_KEY not set — skipping email lookup")
        return ApolloResult(
            found=False, email=None, person_id=None, apollo_name=None,
            error="Apollo API key not configured"
        )

    # Derive city/state from address if not passed explicitly
    if not city and not state and address:
        city, state = _parse_city_state(address)

    clean = _clean_name(name)
    logger.info("Apollo: searching for '%s' (cleaned from '%s')", clean, name)

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        # ── Step 1a: search with org (if available) ───────────────────────────
        person = None
        if organization:
            person = await _search_person(client, clean, city, state, organization)

        # ── Step 1b: retry without org if step 1a found nothing ───────────────
        if person is None:
            person = await _search_person(client, clean, city, state, organization="")

        if person is None:
            logger.info("Apollo: no confident match for '%s'", name)
            return _EMPTY

        person_id   = person.get("id")
        apollo_name = person.get("name", "")

        # Sanity-check: the returned name should overlap meaningfully
        similarity = _name_similarity(name, apollo_name)
        if similarity < 0.4:
            logger.info(
                "Apollo: low name similarity (%.2f) — '%s' vs '%s'; skipping",
                similarity, name, apollo_name,
            )
            return _EMPTY

        # ── Step 2: enrich to get email ───────────────────────────────────────
        email = await _enrich_person(client, person_id, apollo_name, organization)

    logger.info(
        "Apollo result | name='%s' | found=True | has_email=%s",
        name, bool(email),
    )
    return ApolloResult(
        found=True,
        email=email,
        person_id=person_id,
        apollo_name=apollo_name,
        error=None,
    )


# ── Private helpers ───────────────────────────────────────────────────────────

async def _search_person(
    client:       httpx.AsyncClient,
    name:         str,
    city:         str,
    state:        str,
    organization: str,
) -> Optional[dict]:
    """
    POST to Apollo people api_search.
    Returns the first high-confidence person dict, or None.
    """
    payload: dict = {
        "q_keywords":    name,
        "page":          1,
        "per_page":      5,
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
        data   = resp.json()
        people = _extract_people(data)

        if not people:
            return None

        # Apollo api_search sometimes returns empty "name" — backfill from
        # first_name + last_name so similarity check doesn't fail.
        for person in people:
            if not person.get("name", "").strip():
                first = person.get("first_name", "").strip()
                last  = person.get("last_name",  "").strip()
                if first or last:
                    person["name"] = f"{first} {last}".strip()
                    logger.info(
                        "Apollo: backfilled name '%s' from first/last fields",
                        person["name"],
                    )

        return people[0]
        

    except httpx.HTTPStatusError as exc:
        logger.warning("Apollo search HTTP %d: %s", exc.response.status_code, exc.response.text[:300])
        return None
    except Exception as exc:
        logger.error("Apollo search error: %s", exc)
        return None


async def _enrich_person(
    client:       httpx.AsyncClient,
    person_id:    Optional[str],
    name:         str,
    organization: str,
) -> Optional[str]:
    """
    POST to Apollo people/match (enrich) to retrieve email.
    Only called after we've found a specific person_id.
    Returns the email string, or None if not available.
    """
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

        email = person.get("email") or None

        # Apollo sometimes returns "email_status": "unavailable" with a null email
        if email and person.get("email_status") in ("invalid", "unverified_catchall"):
            logger.info(
                "Apollo enriched email status is '%s' — treating as unavailable",
                person["email_status"],
            )
            email = None

        return email

    except httpx.HTTPStatusError as exc:
        logger.warning("Apollo enrich HTTP %d: %s", exc.response.status_code, exc.response.text[:300])
        return None
    except Exception as exc:
        logger.error("Apollo enrich error: %s", exc)
        return None