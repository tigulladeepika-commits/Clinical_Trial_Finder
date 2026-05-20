"""
api/publications.py

GET /api/physicians/{npi}/publications
    ?name=<physician full name>
    &specialty=<taxonomy description>   (optional)

Returns up to 10 recent PubMed publications for the physician.

Design notes
------------
- NPI is used as a cache-friendly URL segment (unique per physician).
  The actual PubMed search uses `name` (+ optional `specialty`) because
  PubMed indexes authors by name, not by US provider ID.

- `specialty` maps to a PubMed MeSH term via the service layer to
  reduce false positives for common physician names.

- Cache-Control: 24 h — publication records don't change frequently
  and the NCBI E-utilities free tier is rate-limited (3 req/s).

- On any upstream failure the endpoint returns an empty list with
  HTTP 200 rather than propagating a 502, so the frontend degrades
  gracefully (section simply shows "No publications found").

Response shape
--------------
{
  "npi":   "1234567890",
  "name":  "John Smith",
  "count": 3,
  "publications": [
    {
      "pmid":     "38012345",
      "title":    "Effect of X on Y ...",
      "journal":  "New England Journal of Medicine",
      "year":     "2023",
      "authors":  ["Smith J", "Jones A", "Brown K"],
      "url":      "https://pubmed.ncbi.nlm.nih.gov/38012345/",
      "abstract": "Background: ..."
    },
    ...
  ]
}
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Query, Response

from services.pubmed import fetch_publications

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/{npi}/publications")
async def get_physician_publications(
    npi:      str,
    name:     str            = Query(...,  description="Physician full name — used for PubMed author search"),
    specialty: Optional[str] = Query(None, description="NUCC taxonomy description — narrows MeSH search"),
    response: Response       = None,
) -> dict:
    """
    Fetch recent PubMed publications for a physician by name.

    The NPI path parameter is used only for cache-keying and logging —
    the PubMed search itself is name-based (PubMed has no NPI field).

    Errors from the upstream NCBI API are swallowed and returned as an
    empty list so the UI degrades gracefully instead of showing an error.
    """
    if response:
        # Cache for 24 hours — publication data changes infrequently
        response.headers["Cache-Control"] = "private, max-age=86400"

    name_clean      = (name or "").strip()
    specialty_clean = (specialty or "").strip() or None

    if not name_clean:
        return {
            "npi":          npi,
            "name":         "",
            "count":        0,
            "publications": [],
        }

    logger.info(
        "Publications request | npi=%s name=%r specialty=%r",
        npi, name_clean, specialty_clean,
    )

    try:
        pubs = fetch_publications(
            name=name_clean,
            taxonomy_desc=specialty_clean,
        )
    except Exception as exc:
        # Never surface upstream errors to the client — degrade gracefully
        logger.exception(
            "Unexpected error fetching publications | npi=%s name=%r | %s",
            npi, name_clean, exc,
        )
        pubs = []

    logger.info(
        "Publications response | npi=%s name=%r → %d publications",
        npi, name_clean, len(pubs),
    )

    return {
        "npi":          npi,
        "name":         name_clean,
        "count":        len(pubs),
        "publications": pubs,
    }