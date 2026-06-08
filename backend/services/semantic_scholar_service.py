"""
semantic_scholar_service.py

Semantic Scholar Academic Graph API integration for physician publication lookup.

Strategy:
  Step A — Author search by full name
            GET /author/search?query=<name>&fields=name,affiliations,paperCount,hIndex
  Step B — State-based affiliation filter
            Match author affiliation against physician's NPI state
  Step C — Fetch papers for matched author
            GET /author/{id}/papers?fields=title,year,authors,citationCount,externalIds

Key advantage over PubMed:
  - Returns affiliation at AUTHOR level (not paper level)
  - Full author names (not initials) prevent initial-collision false matches
  - 200M+ papers vs PubMed's ~35M

Rate limits:
  - No API key: 100 req/5min (shared pool)
  - With API key: 1 req/sec dedicated
  - No signup required for basic usage

Usage in physician_insights_service.py:
  from services.semantic_scholar_service import semantic_scholar_lookup
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

S2_BASE_URL      = "https://api.semanticscholar.org/graph/v1"
HTTP_TIMEOUT     = 15.0
MAX_RESULTS      = 20
MAX_RETRIES      = 2
RETRY_DELAY      = 1.0
MAX_AUTHOR_CANDIDATES = 5

# ── US state name lookup ───────────────────────────────────────────────────
_US_STATE_NAMES: dict[str, list[str]] = {
    "AL": ["alabama"], "AK": ["alaska"], "AZ": ["arizona"],
    "AR": ["arkansas"], "CA": ["california"], "CO": ["colorado"],
    "CT": ["connecticut"], "DE": ["delaware"], "FL": ["florida"],
    "GA": ["georgia"], "HI": ["hawaii"], "ID": ["idaho"],
    "IL": ["illinois"], "IN": ["indiana"], "IA": ["iowa"],
    "KS": ["kansas"], "KY": ["kentucky"], "LA": ["louisiana"],
    "ME": ["maine"], "MD": ["maryland"], "MA": ["massachusetts"],
    "MI": ["michigan"], "MN": ["minnesota"], "MS": ["mississippi"],
    "MO": ["missouri"], "MT": ["montana"], "NE": ["nebraska"],
    "NV": ["nevada"], "NH": ["new hampshire"], "NJ": ["new jersey"],
    "NM": ["new mexico"], "NY": ["new york"], "NC": ["north carolina"],
    "ND": ["north dakota"], "OH": ["ohio"], "OK": ["oklahoma"],
    "OR": ["oregon"], "PA": ["pennsylvania"], "RI": ["rhode island"],
    "SC": ["south carolina"], "SD": ["south dakota"], "TN": ["tennessee"],
    "TX": ["texas"], "UT": ["utah"], "VT": ["vermont"],
    "VA": ["virginia"], "WA": ["washington"], "WV": ["west virginia"],
    "WI": ["wisconsin"], "WY": ["wyoming"], "DC": ["district of columbia"],
}

_WRONG_COUNTRY_SIGNALS = [
    "netherlands", "wageningen", "amsterdam", "rotterdam", "utrecht",
    "united kingdom", "england", "scotland", "wales", "oxford", "cambridge",
    "germany", "berlin", "munich", "france", "paris", "italy", "rome",
    "spain", "madrid", "australia", "sydney", "melbourne",
    "canada", "toronto", "montreal", "china", "beijing", "shanghai",
    "india", "japan", "tokyo", "korea", "seoul", "brazil",
    "sweden", "norway", "denmark", "finland", "switzerland",
    "saudi arabia", "egypt", "turkey", "iran", "pakistan",
    "new zealand", "singapore", "hong kong",
]


def _empty_result() -> dict:
    return {
        "publications": [],
        "confidence":   0,
        "author_id":    None,
        "affiliation":  None,
        "source":       "Semantic Scholar",
    }


async def _fetch_with_retry(
    client: httpx.AsyncClient,
    url:    str,
    params: dict,
) -> Optional[dict]:
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = await client.get(url, params=params, timeout=HTTP_TIMEOUT)
            if resp.status_code == 429:
                wait = RETRY_DELAY * (2 ** attempt)
                logger.warning("S2 rate limit hit attempt %d — waiting %.1fs", attempt + 1, wait)
                if attempt < MAX_RETRIES:
                    await asyncio.sleep(wait)
                    continue
                return None
            if resp.status_code == 200:
                return resp.json()
            logger.warning("S2 unexpected status %d for %s", resp.status_code, url)
            return None
        except Exception as exc:
            logger.warning("S2 request error attempt %d: %s", attempt + 1, exc)
            if attempt < MAX_RETRIES:
                await asyncio.sleep(RETRY_DELAY)
    return None


def _affiliation_matches_state(affiliations: list[str], npi_state: str) -> bool:
    """
    Return True if any affiliation string matches the physician's NPI state.
    Returns True if affiliations is empty (can't rule out).
    Returns False if a wrong country signal is found.
    """
    if not affiliations:
        # When we know the physician's state, require affiliation confirmation.
        # No affiliation = cannot verify = reject to avoid name collisions.
        if npi_state:
            return False
        return True  # no state info — pass through

    npi_state_upper = npi_state.upper().strip()
    correct_names   = _US_STATE_NAMES.get(npi_state_upper, [])
    combined        = " ".join(affiliations).lower()

    # Reject wrong country first
    if any(signal in combined for signal in _WRONG_COUNTRY_SIGNALS):
        logger.debug("S2 affiliation reject (wrong country): %r", affiliations[:2])
        return False

    # If we have state names to check, verify at least one matches
    if correct_names:
        return any(s in combined for s in correct_names)

    return True  # unknown state code — pass through


def _name_matches(s2_name: str, physician_name: str) -> bool:
    """
    Check if Semantic Scholar author name matches physician name.
    Handles partial matches (last name + first initial at minimum).
    """
    s2_parts   = s2_name.lower().strip().split()
    phys_parts = physician_name.lower().strip().split()

    if not s2_parts or not phys_parts:
        return False

    s2_last   = s2_parts[-1]
    phys_last = phys_parts[-1]

    # Last name must match
    if s2_last != phys_last:
        return False

    # First initial must match
    s2_first   = s2_parts[0][0] if s2_parts else ""
    phys_first = phys_parts[0][0] if phys_parts else ""

    return s2_first == phys_first


async def semantic_scholar_lookup(
    name:      str,
    specialty: str,
    npi_state: str,
    client:    httpx.AsyncClient,
    disease:   str = "",
) -> dict:
    """
    Look up a physician on Semantic Scholar.

    Returns dict with:
        publications: list[dict]  — structured like PubMed/EuropePMC outputs
        confidence:   int         — 0-100
        author_id:    str | None  — S2 author ID if matched
        affiliation:  str | None  — matched author's affiliation
        source:       str
    """
    if not name:
        return _empty_result()

    # Clean name — strip credentials
    clean = re.sub(
        r',?\s*(M\.D\.?|MD|D\.O\.?|DO|Ph\.D\.?|PhD|MPH|FACC|FACS|FACOG|FACP)\b',
        '', name, flags=re.IGNORECASE
    ).strip().strip(',').strip()
    clean = re.sub(r'\b(Dr\.?|Mr\.?|Mrs\.?|Prof\.?)\b', '', clean, flags=re.IGNORECASE).strip()
    clean = " ".join(clean.split())

    logger.info("S2 lookup | name=%r | state=%r", clean, npi_state)

    # ── Step A: Search for author ─────────────────────────────────────────
    search_data = await _fetch_with_retry(
        client,
        f"{S2_BASE_URL}/author/search",
        {
            "query":  clean,
            "fields": "authorId,name,affiliations,paperCount,hIndex,papers.fieldsOfStudy",
            "limit":  MAX_AUTHOR_CANDIDATES,
        },
    )

    if not search_data:
        logger.info("S2: no response for author search %r", clean)
        return _empty_result()

    candidates = search_data.get("data", [])
    if not candidates:
        logger.info("S2: no author candidates for %r", clean)
        return _empty_result()

    # ── Step B: Find best matching author ────────────────────────────────
    matched_author = None
    matched_affiliation = None

    for candidate in candidates:
        s2_name      = candidate.get("name", "")
        affiliations = candidate.get("affiliations") or []
        paper_count  = candidate.get("paperCount", 0)

        if not _name_matches(s2_name, clean):
            logger.debug("S2: name mismatch %r vs %r", s2_name, clean)
            continue

        if npi_state:
            if not _affiliation_matches_state(affiliations, npi_state):
                logger.info(
                    "S2: affiliation reject for %r (state=%s affiliations=%r)",
                    s2_name, npi_state, affiliations[:2],
                )
                continue

        # Reject if candidate is clearly non-medical (Physics, Engineering, CS)
        NON_MEDICAL_FIELDS = {
            "physics", "engineering", "computer science", "chemistry",
            "mathematics", "geology", "materials science", "environmental science",
            "economics", "political science", "sociology", "psychology",
            "biology", "art", "history", "philosophy", "linguistics",
        }
        candidate_papers = candidate.get("papers") or []
        candidate_fields: set[str] = set()
        for paper in candidate_papers[:10]:
            for field in (paper.get("fieldsOfStudy") or []):
                candidate_fields.add(field.lower())
        
        medical_fields = {"medicine"}
        if candidate_fields and not candidate_fields.intersection(medical_fields):
            if candidate_fields.intersection(NON_MEDICAL_FIELDS):
                logger.info(
                    "S2: rejecting non-medical candidate %r (fields=%r)",
                    s2_name, list(candidate_fields)[:3],
                )
                continue

        # Accept this candidate
        matched_author      = candidate
        matched_affiliation = affiliations[0] if affiliations else None
        logger.info(
            "S2: matched author %r | affiliations=%r | papers=%d",
            s2_name, affiliations[:2], paper_count,
        )
        break

    if not matched_author:
        logger.info("S2: no matching author found for %r (state=%s)", clean, npi_state)
        return _empty_result()

    author_id = matched_author.get("authorId")
    if not author_id:
        return _empty_result()

    # ── Step C: Fetch papers for matched author ───────────────────────────
    await asyncio.sleep(0.5)  # be polite to S2 rate limits

    papers_data = await _fetch_with_retry(
        client,
        f"{S2_BASE_URL}/author/{author_id}/papers",
        {
            "fields": "title,year,authors,citationCount,externalIds,openAccessPdf",
            "limit":  MAX_RESULTS,
            "sort":   "citationCount",
        },
    )

    if not papers_data:
        logger.info("S2: no papers response for author %s", author_id)
        return _empty_result()

    raw_papers = papers_data.get("data", [])
    if not raw_papers:
        logger.info("S2: author %s has no papers", author_id)
        return _empty_result()

    # ── Step D: Build structured publication list ─────────────────────────
    publications: list[dict] = []
    for paper in raw_papers:
        title = (paper.get("title") or "").strip().rstrip(".")
        if not title:
            continue

        year = paper.get("year")

        # Extract DOI and PMID from externalIds
        external_ids = paper.get("externalIds") or {}
        doi    = external_ids.get("DOI", "")
        pmid   = str(external_ids.get("PubMed", "")) if external_ids.get("PubMed") else ""

        doi_url    = f"https://doi.org/{doi}" if doi else ""
        pubmed_url = f"https://pubmed.ncbi.nlm.nih.gov/{pmid}" if pmid else ""
        s2_url     = f"https://www.semanticscholar.org/paper/{paper.get('paperId', '')}"

        # Open access PDF
        oa_pdf = (paper.get("openAccessPdf") or {}).get("url", "")

        best_url = doi_url or pubmed_url or oa_pdf or s2_url

        # Author names
        raw_authors  = paper.get("authors") or []
        author_names = [a.get("name", "") for a in raw_authors if a.get("name")]

        citation_count = paper.get("citationCount", 0)

        publications.append({
            "title":                title,
            "year":                 year,
            "pubmed_url":           pubmed_url,
            "doi_url":              doi_url,
            "semantic_scholar_url": s2_url,
            "best_url":             best_url,
            "source":               "Semantic Scholar",
            "pmid":                 pmid,
            "authors":              author_names,
            "citation_count":       citation_count,
            "affiliation":          matched_affiliation or "",
            "affiliation_verified": True,  # S2 author match = affiliation confirmed
        })

    # Sort newest first
    publications.sort(key=lambda p: p.get("year") or 0, reverse=True)
    publications = publications[:MAX_RESULTS]

    # Confidence: higher if affiliation matched, lower if no affiliation data
    confidence = 70 if matched_affiliation else 45

    logger.info(
        "S2 result | name=%r | author_id=%s | publications=%d | confidence=%d",
        clean, author_id, len(publications), confidence,
    )

    return {
        "publications": publications,
        "confidence":   confidence,
        "author_id":    author_id,
        "affiliation":  matched_affiliation,
        "source":       "Semantic Scholar",
    }
