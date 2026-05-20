"""
services/pubmed.py

Fetches a physician's publications from the NCBI PubMed E-utilities API.

Strategy
--------
Tier 1 — Name + specialty MeSH search:
    "<Full Name>"[Author] AND "<Specialty>"[MeSH Terms]
    Reduces false positives for common names ("John Smith").

Tier 2 — Name-only fallback (fires only when Tier 1 returns 0 results):
    "<Full Name>"[Author]
    Handles physicians whose specialty doesn't map to a PubMed MeSH term.

Both tiers search the last 15 years by default, sorted by publication
date descending. Returns up to MAX_RESULTS publications.

No API key is required for the NCBI E-utilities read-only endpoints used
here (esearch + efetch), though rate limits apply (3 req/s unauthenticated).
Set NCBI_API_KEY in .env to raise the limit to 10 req/s.

Response shape (per publication):
    {
      "pmid":     "12345678",
      "title":    "Effect of X on Y in Z patients",
      "journal":  "New England Journal of Medicine",
      "year":     "2023",
      "authors":  ["Smith J", "Jones A", "Brown K"],
      "url":      "https://pubmed.ncbi.nlm.nih.gov/12345678/",
      "abstract": "Background: ..."   # present when available, else ""
    }
"""

from __future__ import annotations

import logging
import os
import xml.etree.ElementTree as ET
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

_ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
_EFETCH_URL  = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
_PUBMED_URL  = "https://pubmed.ncbi.nlm.nih.gov/"

MAX_RESULTS   = 10
_YEARS_BACK   = 15
_TIMEOUT      = 12   # seconds per request

# NCBI asks all callers to identify themselves via email
_TOOL  = "ClintrialNavigator"
_EMAIL = "admin@clintrialnavigator.com"

# Optional API key — raises rate limit from 3 → 10 req/s
_NCBI_API_KEY: str = os.environ.get("NCBI_API_KEY", "")


# ── Specialty → PubMed MeSH term map ─────────────────────────────────────────
# Maps NUCC taxonomy display names (as returned by the NPPES physician record)
# to PubMed MeSH terms that meaningfully narrow the author search.
# Only included where the MeSH term is well-indexed (high publication volume).

_SPECIALTY_TO_MESH: dict[str, str] = {
    "Medical Oncology":                   "Oncology",
    "Hematology & Oncology":              "Oncology",
    "Hematology":                         "Hematology",
    "Radiation Oncology":                 "Radiation Oncology",
    "Neurology":                          "Neurology",
    "Cardiology":                         "Cardiology",
    "Cardiovascular Disease":             "Cardiovascular Diseases",
    "Internal Medicine":                  "Internal Medicine",
    "Psychiatry":                         "Psychiatry",
    "Gastroenterology":                   "Gastroenterology",
    "Pulmonary Disease":                  "Pulmonary Medicine",
    "Rheumatology":                       "Rheumatology",
    "Nephrology":                         "Nephrology",
    "Endocrinology, Diabetes & Metabolism": "Endocrinology",
    "Infectious Disease":                 "Communicable Diseases",
    "Dermatology":                        "Dermatology",
    "Urology":                            "Urology",
    "Ophthalmology":                      "Ophthalmology",
    "Orthopaedic Surgery":                "Orthopedics",
    "General Surgery":                    "Surgery",
    "Pediatrics":                         "Pediatrics",
    "Obstetrics & Gynecology":            "Obstetrics",
    "Geriatric Medicine":                 "Geriatrics",
    "Allergy & Immunology":               "Allergy and Immunology",
    "Physical Medicine & Rehabilitation": "Rehabilitation",
    "Anesthesiology":                     "Anesthesiology",
    "Pathology":                          "Pathology",
    "Radiology":                          "Radiology",
    "Emergency Medicine":                 "Emergency Medicine",
    "Family Medicine":                    "Family Practice",
    "Otolaryngology":                     "Otolaryngology",
    "Thoracic Surgery":                   "Thoracic Surgery",
    "Vascular Surgery":                   "Vascular Surgical Procedures",
    "Plastic Surgery":                    "Surgery, Plastic",
    "Neurosurgery":                       "Neurosurgery",
}


def _mesh_lookup_single(term: str) -> Optional[str]:
    """Lookup a single specialty term against the MeSH map."""
    if term in _SPECIALTY_TO_MESH:
        return _SPECIALTY_TO_MESH[term]
    lower = term.lower()
    for key, mesh in _SPECIALTY_TO_MESH.items():
        if key.lower() == lower:
            return mesh
    for key, mesh in _SPECIALTY_TO_MESH.items():
        if key.lower() in lower or lower in key.lower():
            return mesh
    return None


def _mesh_for_specialty(taxonomy_desc: Optional[str]) -> Optional[str]:
    """
    Return the best PubMed MeSH term for a NUCC taxonomy description.

    NPPES taxonomy_desc arrives as a comma-separated compound string like:
        "Internal Medicine, Cardiovascular Disease"
        "Internal Medicine, Interventional Cardiology"

    Try each part from most-specific (rightmost) to least and return the
    first match, so "Cardiovascular Disease" is preferred over "Internal Medicine".
    """
    if not taxonomy_desc:
        return None
    parts = [p.strip() for p in taxonomy_desc.split(",") if p.strip()]
    for part in reversed(parts):
        result = _mesh_lookup_single(part)
        if result:
            return result
    return None


def _base_params() -> dict[str, str]:
    """Common parameters sent with every NCBI E-utilities request."""
    p = {
        "db":     "pubmed",
        "tool":   _TOOL,
        "email":  _EMAIL,
        "retmode": "json",
    }
    if _NCBI_API_KEY:
        p["api_key"] = _NCBI_API_KEY
    return p


def _clean_physician_name(name: str) -> str:
    """
    Normalise a physician name for PubMed author search.

    NPPES names arrive in forms like:
        "TIFFANY POWELL-WILEY, M.D., MPH"
        "ROBERT GALLAGHER, M.D."
        "BRADLEY SERWER, M.D."
        "Dr. Jane Smith"
        "JOHN DOE MD"

    PubMed author fields store names without credentials, e.g.:
        "Powell-Wiley T"  or  "Powell-Wiley Tiffany"

    Steps applied (in order):
      1. Strip leading honorific prefixes  (Dr., Prof.)
      2. Strip trailing credential suffixes separated by comma
         e.g. ", M.D., MPH"  →  ""
      3. Strip inline credential tokens at the end
         e.g. "JOHN DOE MD"  →  "JOHN DOE"
      4. Title-case so "TIFFANY POWELL-WILEY" → "Tiffany Powell-Wiley"
         (PubMed search is case-insensitive but mixed-case looks cleaner
         in logs and matches the [Author] field format more closely)
      5. Collapse extra whitespace
    """
    import re

    clean = name.strip()

    # Step 1 — leading honorifics
    for prefix in ("Dr. ", "Dr.", "Prof. ", "Prof."):
        if clean.startswith(prefix):
            clean = clean[len(prefix):].strip()
            break

    # Step 2 — trailing credentials after first comma
    # "TIFFANY POWELL-WILEY, M.D., MPH"  →  "TIFFANY POWELL-WILEY"
    # "ROBERT GALLAGHER, M.D."           →  "ROBERT GALLAGHER"
    if "," in clean:
        clean = clean.split(",")[0].strip()

    # Step 3 — inline credential tokens at end of name (no comma separator)
    # "JOHN DOE MD" → "JOHN DOE"  |  "JANE DOE PHD" → "JANE DOE"
    # Matches common post-nominal abbreviations as whole words at the end
    _CREDENTIAL_RE = re.compile(
        r"\s+\b(M\.?D\.?|D\.?O\.?|Ph\.?D\.?|MPH|MBA|MS|RN|NP|PA|"
        r"FACC|FACS|FAHA|FACG|FASN|FAAN|FACR|FACEP|Jr\.?|Sr\.?|II|III|IV)\b\.?$",
        re.IGNORECASE,
    )
    # Apply repeatedly to strip multiple trailing tokens
    prev = None
    while prev != clean:
        prev = clean
        clean = _CREDENTIAL_RE.sub("", clean).strip()

    # Step 4 — title-case (handles hyphenated names correctly)
    clean = clean.title()

    # Step 5 — collapse extra whitespace
    clean = " ".join(clean.split())

    return clean


def _to_pubmed_author(clean_name: str) -> str:
    """
    Convert a cleaned full name to PubMed author field format.

    PubMed indexes authors as "LastName FI" (last name + first initial).
    "Jerome Fleg"          stored as "Fleg J"
    "Tiffany Powell-Wiley" stored as "Powell-Wiley T"
    """
    parts = clean_name.strip().split()
    if len(parts) == 1:
        return parts[0]
    last = parts[-1]
    first_initial = parts[0][0].upper()
    return f"{last} {first_initial}"


def _build_search_query(name: str, mesh_term) -> str:
    """
    Build a PubMed esearch query string.

    PubMed [Author] field stores names as "LastName FI", NOT "Firstname Lastname".
    We search BOTH formats joined with OR for maximum recall:

        ("Fleg J"[Author] OR "Jerome Fleg"[Author])
        AND "Cardiovascular Diseases"[MeSH Terms]
    """
    clean_name = _clean_physician_name(name)
    pubmed_fmt = _to_pubmed_author(clean_name)

    if pubmed_fmt.lower() != clean_name.lower():
        author_clause = f'("{pubmed_fmt}"[Author] OR "{clean_name}"[Author])'
    else:
        author_clause = f'"{clean_name}"[Author]'

    if mesh_term:
        return f'{author_clause} AND "{mesh_term}"[MeSH Terms]'
    return author_clause


def _esearch(query: str) -> list[str]:
    """
    Run an esearch and return a list of PMIDs (up to MAX_RESULTS).
    Returns an empty list on any error.
    """
    params = {
        **_base_params(),
        "term":     query,
        "retmax":   str(MAX_RESULTS),
        "sort":     "pub date",
        "datetype": "pdat",
        # Restrict to last _YEARS_BACK years
        "reldate":  str(_YEARS_BACK * 365),
    }
    # efetch needs JSON but esearch returns JSON by default
    params["retmode"] = "json"

    try:
        resp = requests.get(_ESEARCH_URL, params=params, timeout=_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        return data.get("esearchresult", {}).get("idlist", [])
    except Exception as exc:
        logger.warning("PubMed esearch failed | query=%r | error=%s", query, exc)
        return []


def _efetch(pmids: list[str]) -> list[dict]:
    """
    Fetch full records for a list of PMIDs via efetch (XML mode).
    Returns a list of publication dicts.
    """
    if not pmids:
        return []

    params = {
        **_base_params(),
        "id":      ",".join(pmids),
        "rettype": "abstract",
        "retmode": "xml",
    }
    # efetch XML — override retmode
    del params["retmode"]
    params["retmode"] = "xml"

    try:
        resp = requests.get(_EFETCH_URL, params=params, timeout=_TIMEOUT)
        resp.raise_for_status()
        return _parse_pubmed_xml(resp.text)
    except Exception as exc:
        logger.warning("PubMed efetch failed | pmids=%s | error=%s", pmids, exc)
        return []


def _parse_pubmed_xml(xml_text: str) -> list[dict]:
    """
    Parse PubMed XML (PubmedArticleSet) into a list of publication dicts.
    Handles missing fields gracefully — every field has a safe default.
    """
    results: list[dict] = []

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        logger.warning("PubMed XML parse error: %s", exc)
        return results

    for article_node in root.findall(".//PubmedArticle"):
        try:
            citation = article_node.find("MedlineCitation")
            if citation is None:
                continue

            # PMID
            pmid_node = citation.find("PMID")
            pmid = pmid_node.text.strip() if pmid_node is not None and pmid_node.text else ""

            article = citation.find("Article")
            if article is None:
                continue

            # Title — strip trailing whitespace/period
            title_node = article.find("ArticleTitle")
            title = (title_node.text or "").strip().rstrip(".")
            if not title:
                continue  # skip records with no title

            # Journal
            journal_node = article.find(".//Journal/Title")
            journal = (journal_node.text or "").strip() if journal_node is not None else ""

            # Abbreviated journal as fallback
            if not journal:
                abbr_node = article.find(".//Journal/ISOAbbreviation")
                journal = (abbr_node.text or "").strip() if abbr_node is not None else ""

            # Year — prefer PubDate/Year, fall back to MedlineDate parsing
            year = ""
            year_node = article.find(".//Journal/JournalIssue/PubDate/Year")
            if year_node is not None and year_node.text:
                year = year_node.text.strip()
            else:
                medline_node = article.find(".//Journal/JournalIssue/PubDate/MedlineDate")
                if medline_node is not None and medline_node.text:
                    # MedlineDate is like "2023 Jan-Feb" — grab first 4 digits
                    import re
                    m = re.search(r"\d{4}", medline_node.text)
                    if m:
                        year = m.group()

            # Authors — "LastName Initials" format
            authors: list[str] = []
            for author_node in article.findall(".//AuthorList/Author"):
                last  = author_node.findtext("LastName", default="").strip()
                init  = author_node.findtext("Initials", default="").strip()
                if last:
                    authors.append(f"{last} {init}".strip())
                else:
                    # Collective author
                    collective = author_node.findtext("CollectiveName", default="").strip()
                    if collective:
                        authors.append(collective)

            # Abstract — concatenate structured abstract sections if present
            abstract_parts: list[str] = []
            for abstract_text_node in article.findall(".//Abstract/AbstractText"):
                label = abstract_text_node.get("Label", "")
                text  = abstract_text_node.text or ""
                if label:
                    abstract_parts.append(f"{label}: {text.strip()}")
                elif text.strip():
                    abstract_parts.append(text.strip())
            abstract = " ".join(abstract_parts)

            results.append({
                "pmid":     pmid,
                "title":    title,
                "journal":  journal,
                "year":     year,
                "authors":  authors[:6],   # cap at 6 for display
                "url":      f"{_PUBMED_URL}{pmid}/",
                "abstract": abstract[:600] if abstract else "",  # cap for payload size
            })

        except Exception as exc:
            logger.debug("Skipped malformed PubMed article: %s", exc)
            continue

    return results


# ── Public API ────────────────────────────────────────────────────────────────

def fetch_publications(
    name:          str,
    taxonomy_desc: Optional[str] = None,
) -> list[dict]:
    """
    Fetch up to MAX_RESULTS recent publications for a physician.

    Parameters
    ----------
    name          : Physician's full name (as returned by NPPES)
    taxonomy_desc : NUCC taxonomy description (e.g. "Medical Oncology")
                   Used to build a MeSH-term filter for Tier 1 search.

    Returns
    -------
    List of publication dicts (may be empty if none found or on error).
    Sorted by year descending (most recent first).
    """
    if not name or not name.strip():
        logger.warning("fetch_publications called with empty name")
        return []

    mesh_term = _mesh_for_specialty(taxonomy_desc)

    # ── Tier 1: name + specialty MeSH ─────────────────────────────────────
    if mesh_term:
        query_t1 = _build_search_query(name, mesh_term)
        logger.info("PubMed Tier 1 | query=%r", query_t1)
        pmids = _esearch(query_t1)

        if pmids:
            pubs = _efetch(pmids)
            if pubs:
                logger.info(
                    "PubMed Tier 1 success | name=%r specialty=%r → %d results",
                    name, taxonomy_desc, len(pubs),
                )
                return pubs

    # ── Tier 2: name only ──────────────────────────────────────────────────
    query_t2 = _build_search_query(name, None)
    logger.info("PubMed Tier 2 (name-only fallback) | query=%r", query_t2)
    pmids = _esearch(query_t2)

    if not pmids:
        logger.info("PubMed | no results | name=%r specialty=%r", name, taxonomy_desc)
        return []

    pubs = _efetch(pmids)
    logger.info(
        "PubMed Tier 2 success | name=%r → %d results",
        name, len(pubs),
    )
    return pubs