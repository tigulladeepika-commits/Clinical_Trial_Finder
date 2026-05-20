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

MAX_RESULTS = 10
_YEARS_BACK = 15
_TIMEOUT    = 12   # seconds per request

# NCBI asks all callers to identify themselves via email
_TOOL  = "ClintrialNavigator"
_EMAIL = "admin@clintrialnavigator.com"

# Optional API key — raises rate limit from 3 → 10 req/s
_NCBI_API_KEY: str = os.environ.get("NCBI_API_KEY", "")


def _base_params() -> dict[str, str]:
    """Common parameters sent with every NCBI E-utilities request."""
    p = {
        "db":      "pubmed",
        "tool":    _TOOL,
        "email":   _EMAIL,
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
        "Dr. Jane Smith"
        "JOHN DOE MD"

    Steps applied (in order):
      1. Strip leading honorific prefixes  (Dr., Prof.)
      2. Strip trailing credential suffixes separated by comma
      3. Strip inline credential tokens at the end
      4. Title-case
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
    if "," in clean:
        clean = clean.split(",")[0].strip()

    # Step 3 — inline credential tokens at end of name
    _CREDENTIAL_RE = re.compile(
        r"\s+\b(M\.?D\.?|D\.?O\.?|Ph\.?D\.?|MPH|MBA|MS|RN|NP|PA|"
        r"FACC|FACS|FAHA|FACG|FASN|FAAN|FACR|FACEP|Jr\.?|Sr\.?|II|III|IV)\b\.?$",
        re.IGNORECASE,
    )
    prev = None
    while prev != clean:
        prev = clean
        clean = _CREDENTIAL_RE.sub("", clean).strip()

    # Step 4 — title-case
    clean = clean.title()

    # Step 5 — collapse extra whitespace
    clean = " ".join(clean.split())

    return clean


def _extract_specialty_keyword(taxonomy_desc: Optional[str]) -> Optional[str]:
    """
    Extract a plain-text specialty keyword from an NPPES taxonomy description.

    NPPES taxonomy_desc arrives as a comma-separated compound string like:
        "Internal Medicine, Cardiovascular Disease"
        "Internal Medicine, Interventional Cardiology"

    Returns the most specific part (rightmost token) as-is, since PubMed
    [Title/Abstract] search treats it as a plain keyword — no mapping needed.

    Examples:
        "Internal Medicine, Cardiovascular Disease"  → "Cardiovascular Disease"
        "Medical Oncology"                           → "Medical Oncology"
        "Cardiology"                                 → "Cardiology"
        None                                         → None
    """
    if not taxonomy_desc:
        return None
    parts = [p.strip() for p in taxonomy_desc.split(",") if p.strip()]
    # Most specific part is the last (rightmost) token
    return parts[-1] if parts else None


def _build_tier1_query(clean_name: str, specialty_keyword: str) -> str:
    """
    Tier 1: Full name + specialty keyword in title/abstract.

    Uses [Title/Abstract] instead of [MeSH Terms] so no mapping table
    is required — the specialty string from NPPES is used directly.

    Example:
        '"Shawn Chawla"[Author] AND "Cardiovascular Disease"[Title/Abstract]'
    """
    return f'"{clean_name}"[Author] AND "{specialty_keyword}"[Title/Abstract]'


def _build_tier2_query(clean_name: str) -> str:
    """
    Tier 2: Full name only (no specialty filter).

    Catches papers where the specialty isn't mentioned in title/abstract,
    or where the physician publishes outside their primary specialty.

    Example:
        '"Shawn Chawla"[Author]'
    """
    return f'"{clean_name}"[Author]'


def _verify_author(pubs: list[dict], clean_name: str) -> list[dict]:
    """
    Post-fetch guard: drop papers where the physician's name doesn't
    actually appear in the author list.

    PubMed's own disambiguation can occasionally return papers where the
    physician is not listed. This filter eliminates those.

    Matches on "LastName FI" prefix (case-insensitive), e.g. "chawla s"
    will match "Chawla S" or "Chawla Shawn" but not "Chawla Saurabh" once
    the full author name is indexed.
    """
    parts = clean_name.strip().split()
    if len(parts) < 2:
        return pubs  # can't verify a single-token name; pass through

    last          = parts[-1].lower()
    first_initial = parts[0][0].lower()
    expected      = f"{last} {first_initial}"

    return [
        p for p in pubs
        if any(a.lower().startswith(expected) for a in p.get("authors", []))
    ]


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
        "reldate":  str(_YEARS_BACK * 365),
        "retmode":  "json",
    }

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

            pmid_node = citation.find("PMID")
            pmid = pmid_node.text.strip() if pmid_node is not None and pmid_node.text else ""

            article = citation.find("Article")
            if article is None:
                continue

            title_node = article.find("ArticleTitle")
            title = (title_node.text or "").strip().rstrip(".")
            if not title:
                continue

            journal_node = article.find(".//Journal/Title")
            journal = (journal_node.text or "").strip() if journal_node is not None else ""
            if not journal:
                abbr_node = article.find(".//Journal/ISOAbbreviation")
                journal = (abbr_node.text or "").strip() if abbr_node is not None else ""

            year = ""
            year_node = article.find(".//Journal/JournalIssue/PubDate/Year")
            if year_node is not None and year_node.text:
                year = year_node.text.strip()
            else:
                medline_node = article.find(".//Journal/JournalIssue/PubDate/MedlineDate")
                if medline_node is not None and medline_node.text:
                    import re
                    m = re.search(r"\d{4}", medline_node.text)
                    if m:
                        year = m.group()

            authors: list[str] = []
            for author_node in article.findall(".//AuthorList/Author"):
                last = author_node.findtext("LastName", default="").strip()
                init = author_node.findtext("Initials", default="").strip()
                if last:
                    authors.append(f"{last} {init}".strip())
                else:
                    collective = author_node.findtext("CollectiveName", default="").strip()
                    if collective:
                        authors.append(collective)

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
                "authors":  authors[:6],
                "url":      f"{_PUBMED_URL}{pmid}/",
                "abstract": abstract[:600] if abstract else "",
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
    taxonomy_desc : NUCC taxonomy description (e.g. "Internal Medicine, Cardiovascular Disease")
                   The most specific part is used as a plain keyword filter.

    Returns
    -------
    List of publication dicts (may be empty if none found or on error).

    Tier waterfall
    --------------
    Tier 1  Full name + specialty keyword   "Shawn Chawla"[Author]
                                             AND "Cardiovascular Disease"[Title/Abstract]
    Tier 2  Full name only                  "Shawn Chawla"[Author]

    The initial-form query ("Chawla S") has been removed entirely — it is
    the primary source of false positives (matches any S. Chawla worldwide).

    Every result set is passed through _verify_author(), which drops any
    paper where the physician's name does not appear in the author list.
    """
    if not name or not name.strip():
        logger.warning("fetch_publications called with empty name")
        return []

    clean_name        = _clean_physician_name(name)
    specialty_keyword = _extract_specialty_keyword(taxonomy_desc)

    # ── Tier 1: Full name + specialty keyword ──────────────────────────────
    if specialty_keyword:
        query_t1 = _build_tier1_query(clean_name, specialty_keyword)
        logger.info("PubMed Tier 1 | query=%r", query_t1)
        pmids = _esearch(query_t1)

        if pmids:
            pubs = _verify_author(_efetch(pmids), clean_name)
            if pubs:
                logger.info(
                    "PubMed Tier 1 success | name=%r specialty=%r → %d results",
                    name, taxonomy_desc, len(pubs),
                )
                return pubs

    # ── Tier 2: Full name only ─────────────────────────────────────────────
    query_t2 = _build_tier2_query(clean_name)
    logger.info("PubMed Tier 2 (full name, no specialty) | query=%r", query_t2)
    pmids = _esearch(query_t2)

    if not pmids:
        logger.info("PubMed | no results across all tiers | name=%r specialty=%r", name, taxonomy_desc)
        return []

    pubs = _verify_author(_efetch(pmids), clean_name)
    logger.info(
        "PubMed Tier 2 success | name=%r → %d results",
        name, len(pubs),
    )
    return pubs