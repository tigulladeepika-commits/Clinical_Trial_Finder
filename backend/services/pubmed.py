"""
services/pubmed.py

Fetches a physician's publications from the NCBI PubMed E-utilities API.

Strategy
--------
Tier 1 — Full name + specialty keyword (title/abstract), recent 15 years:
    "Firstname Lastname"[Author] AND "Specialty"[Title/Abstract]

Tier 2 — Full name only, ALL years (fires when Tier 1 returns 0):
    "Firstname Lastname"[Author]
    No date restriction — catches physicians with older publication histories.

Tier 3 — Initial form + specialty + US affiliation, ALL years
         (fires when Tier 2 returns 0):
    "LastName FI"[Author] AND "Specialty"[Title/Abstract]
                           AND "United States"[Affiliation]
    Required for physicians whose full first name was never indexed by
    PubMed (e.g. Mustafa Albakour → "Albakour M" only in the index).
    _verify_author runs strict=False at Tier 3: initial prefix match is
    sufficient since US affiliation has already filtered foreign collisions.

Concurrency / timeout design
-----------------------------
_NCBI_SEMAPHORE limits the whole process to _MAX_CONCURRENT_NCBI simultaneous
NCBI HTTP calls. This prevents 10 parallel physician cards from saturating
NCBI's 3 req/s unauthenticated rate limit and causing cascading slowdowns.

fetch_publications runs inside a ThreadPoolExecutor with a hard
_FETCH_BUDGET_SECONDS wall-clock cap. Any physician that doesn't resolve
within budget returns [] immediately, keeping the API responsive.

Set NCBI_API_KEY in .env to raise the NCBI rate limit from 3 → 10 req/s.
"""

from __future__ import annotations

import concurrent.futures
import logging
import os
import threading
import xml.etree.ElementTree as ET
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

_ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
_EFETCH_URL  = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
_PUBMED_URL  = "https://pubmed.ncbi.nlm.nih.gov/"

MAX_RESULTS           = 10
_YEARS_BACK           = 15   # Tier 1 date window only
_TIMEOUT              = 5    # seconds per individual NCBI HTTP request
_FETCH_BUDGET_SECONDS = 8    # hard wall-clock cap for entire fetch_publications call
_MAX_CONCURRENT_NCBI  = 3    # max simultaneous NCBI calls across all threads

_TOOL  = "ClintrialNavigator"
_EMAIL = "admin@clintrialnavigator.com"

_NCBI_API_KEY: str = os.environ.get("NCBI_API_KEY", "")

# Semaphore shared across all threads in this process
_NCBI_SEMAPHORE = threading.Semaphore(_MAX_CONCURRENT_NCBI)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _base_params() -> dict[str, str]:
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
    Normalise an NPPES physician name for PubMed author search.

    Strips leading honorifics (Dr., Prof.), trailing credential suffixes
    after the first comma (", M.D., MPH"), inline credential tokens at
    the end ("JOHN DOE MD"), then title-cases and collapses whitespace.
    """
    import re

    clean = name.strip()

    for prefix in ("Dr. ", "Dr.", "Prof. ", "Prof."):
        if clean.startswith(prefix):
            clean = clean[len(prefix):].strip()
            break

    if "," in clean:
        clean = clean.split(",")[0].strip()

    _CREDENTIAL_RE = re.compile(
        r"\s+\b(M\.?D\.?|D\.?O\.?|Ph\.?D\.?|MPH|MBA|MS|RN|NP|PA|"
        r"FACC|FACS|FAHA|FACG|FASN|FAAN|FACR|FACEP|Jr\.?|Sr\.?|II|III|IV)\b\.?$",
        re.IGNORECASE,
    )
    prev = None
    while prev != clean:
        prev = clean
        clean = _CREDENTIAL_RE.sub("", clean).strip()

    clean = clean.title()
    clean = " ".join(clean.split())
    return clean


def _extract_specialty_keyword(taxonomy_desc: Optional[str]) -> Optional[str]:
    """
    Return the most specific part of an NPPES taxonomy description as a
    plain keyword for [Title/Abstract] search. No MeSH mapping required.

    "Internal Medicine, Cardiovascular Disease"  → "Cardiovascular Disease"
    "Medical Oncology"                           → "Medical Oncology"
    None / ""                                    → None
    """
    if not taxonomy_desc:
        return None
    parts = [p.strip() for p in taxonomy_desc.split(",") if p.strip()]
    return parts[-1] if parts else None


def _build_tier1_query(clean_name: str, specialty_keyword: str) -> str:
    return f'"{clean_name}"[Author] AND "{specialty_keyword}"[Title/Abstract]'


def _build_tier2_query(clean_name: str) -> str:
    return f'"{clean_name}"[Author]'


def _build_tier3_query(clean_name: str, specialty_keyword: Optional[str]) -> str:
    """
    Initial form + optional specialty keyword + US affiliation.
    No date restriction — covers the full PubMed history.
    """
    parts         = clean_name.strip().split()
    last          = parts[-1]
    first_initial = parts[0][0].upper()
    pubmed_fmt    = f"{last} {first_initial}"

    base = f'"{pubmed_fmt}"[Author]'
    if specialty_keyword:
        base += f' AND "{specialty_keyword}"[Title/Abstract]'
    base += ' AND "United States"[Affiliation]'
    return base


def _verify_author(
    pubs:       list[dict],
    clean_name: str,
    strict:     bool = True,
) -> list[dict]:
    """
    Drop papers where the physician's name does not appear in the author list.

    strict=True  (Tiers 1 & 2):
        When the XML <ForeName> field is indexed for any author on the paper,
        require the physician's full forename to match. This distinguishes
        "Chawla Shawn" from "Chawla Saurabh" even though both index as "Chawla S".
        Falls back to initial prefix when no forenames are indexed on the paper.

    strict=False (Tier 3):
        Always accept on initial prefix match ("grado g", "albakour m").
        Safe because: (a) US affiliation filter already eliminated foreign
        collisions, and (b) Tier 3 only fires when the physician has zero
        full-name indexed papers.
    """
    parts = clean_name.strip().split()
    if len(parts) < 2:
        return pubs

    last           = parts[-1].lower()
    first_name     = parts[0].lower()
    first_initial  = first_name[0]
    initial_prefix = f"{last} {first_initial}"       # "chawla s"
    full_lastfirst = f"{last} {first_name}"          # "chawla shawn"
    full_firstlast = f"{first_name} {last}"          # "shawn chawla"

    verified = []
    for pub in pubs:
        authors_lower = [a.lower() for a in pub.get("authors", [])]

        if not strict:
            matched = any(a.startswith(initial_prefix) for a in authors_lower)
        else:
            has_full_forename_in_index = any(
                len(a.split()) >= 2
                and a.split()[0] == last
                and len(a.split()[1]) > 1
                for a in authors_lower
            )
            if has_full_forename_in_index:
                matched = any(
                    full_lastfirst in a or full_firstlast in a
                    for a in authors_lower
                )
            else:
                matched = any(a.startswith(initial_prefix) for a in authors_lower)

        if matched:
            verified.append(pub)

    return verified


def _esearch(query: str, use_date_filter: bool = True) -> list[str]:
    """
    Run an esearch under the NCBI semaphore and return PMIDs.
    use_date_filter=False removes the reldate restriction (Tiers 2 & 3).
    """
    params: dict = {
        **_base_params(),
        "term":   query,
        "retmax": str(MAX_RESULTS),
        "sort":   "pub date",
    }
    if use_date_filter:
        params["datetype"] = "pdat"
        params["reldate"]  = str(_YEARS_BACK * 365)

    with _NCBI_SEMAPHORE:
        try:
            resp = requests.get(_ESEARCH_URL, params=params, timeout=_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            return data.get("esearchresult", {}).get("idlist", [])
        except Exception as exc:
            logger.warning("PubMed esearch failed | query=%r | error=%s", query, exc)
            return []


def _efetch(pmids: list[str]) -> list[dict]:
    """Fetch full records for a list of PMIDs under the NCBI semaphore."""
    if not pmids:
        return []

    params = {
        **_base_params(),
        "id":      ",".join(pmids),
        "rettype": "abstract",
        "retmode": "xml",
    }

    with _NCBI_SEMAPHORE:
        try:
            resp = requests.get(_EFETCH_URL, params=params, timeout=_TIMEOUT)
            resp.raise_for_status()
            return _parse_pubmed_xml(resp.text)
        except Exception as exc:
            logger.warning("PubMed efetch failed | pmids=%s | error=%s", pmids, exc)
            return []


def _parse_pubmed_xml(xml_text: str) -> list[dict]:
    """
    Parse PubMed XML into publication dicts.

    Author format stored:
      "LastName ForeName"  when <ForeName> is present → "Chawla Shawn"
      "LastName Initials"  when only <Initials> present → "Albakour M"
      "CollectiveName"     for group authors
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
                last     = author_node.findtext("LastName",  default="").strip()
                forename = author_node.findtext("ForeName",  default="").strip()
                initials = author_node.findtext("Initials",  default="").strip()

                if last:
                    if forename:
                        authors.append(f"{last} {forename}")   # "Chawla Shawn"
                    elif initials:
                        authors.append(f"{last} {initials}")   # "Albakour M"
                    else:
                        authors.append(last)
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


# ── Public API ─────────────────────────────────────────────────────────────────

def fetch_publications(
    name:          str,
    taxonomy_desc: Optional[str] = None,
) -> list[dict]:
    """
    Fetch up to MAX_RESULTS publications for a physician.
    Hard wall-clock limit of _FETCH_BUDGET_SECONDS — returns [] on timeout.

    Parameters
    ----------
    name          : Physician's full name as returned by NPPES
    taxonomy_desc : NUCC taxonomy description, e.g.
                   "Internal Medicine, Cardiovascular Disease"
    """
    if not name or not name.strip():
        logger.warning("fetch_publications called with empty name")
        return []

    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(_fetch_publications_inner, name, taxonomy_desc)
        try:
            return future.result(timeout=_FETCH_BUDGET_SECONDS)
        except concurrent.futures.TimeoutError:
            logger.warning(
                "PubMed fetch budget exceeded (%ss) | name=%r — returning []",
                _FETCH_BUDGET_SECONDS, name,
            )
            return []
        except Exception as exc:
            logger.warning("PubMed fetch error | name=%r | error=%s", name, exc)
            return []


def _fetch_publications_inner(
    name:          str,
    taxonomy_desc: Optional[str] = None,
) -> list[dict]:
    """
    Tier waterfall — runs inside the wall-clock budget wrapper.

    Tier 1  Full name + specialty, recent 15 years
    Tier 2  Full name only, ALL years
    Tier 3  Initial form + specialty + US affiliation, ALL years
            _verify_author strict=False (initial prefix sufficient)
    """
    clean_name        = _clean_physician_name(name)
    specialty_keyword = _extract_specialty_keyword(taxonomy_desc)

    # ── Tier 1: Full name + specialty, recent years ────────────────────────
    if specialty_keyword:
        query_t1 = _build_tier1_query(clean_name, specialty_keyword)
        logger.info("PubMed Tier 1 | query=%r", query_t1)
        pmids = _esearch(query_t1, use_date_filter=True)

        if pmids:
            pubs = _verify_author(_efetch(pmids), clean_name, strict=True)
            if pubs:
                logger.info(
                    "PubMed Tier 1 success | name=%r specialty=%r → %d results",
                    name, taxonomy_desc, len(pubs),
                )
                return pubs

    # ── Tier 2: Full name only, all years ─────────────────────────────────
    query_t2 = _build_tier2_query(clean_name)
    logger.info("PubMed Tier 2 (full name, no specialty) | query=%r", query_t2)
    pmids = _esearch(query_t2, use_date_filter=False)

    if pmids:
        pubs = _verify_author(_efetch(pmids), clean_name, strict=True)
        if pubs:
            logger.info(
                "PubMed Tier 2 success | name=%r → %d results",
                name, len(pubs),
            )
            return pubs

    # ── Tier 3: Initial form + US affiliation, all years ──────────────────
    query_t3 = _build_tier3_query(clean_name, specialty_keyword)
    logger.info("PubMed Tier 3 (initial form + US affiliation fallback) | query=%r", query_t3)
    pmids = _esearch(query_t3, use_date_filter=False)

    if not pmids:
        logger.info(
            "PubMed | no results across all tiers | name=%r specialty=%r",
            name, taxonomy_desc,
        )
        return []

    pubs = _verify_author(_efetch(pmids), clean_name, strict=False)
    logger.info(
        "PubMed Tier 3 success | name=%r → %d results",
        name, len(pubs),
    )
    return pubs