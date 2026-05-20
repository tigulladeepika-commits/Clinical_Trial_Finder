"""
services/pubmed.py

Fetches a physician's publications from the NCBI PubMed E-utilities API.

Strategy
--------
Tier 1 — Full name + specialty keyword (title/abstract):
    "Firstname Lastname"[Author] AND "Specialty"[Title/Abstract]

Tier 2 — Full name only (fires when Tier 1 returns 0):
    "Firstname Lastname"[Author]
    No date restriction — catches all indexed years.

Tier 3 — Initial form + specialty + US affiliation (fires when Tier 2 returns 0):
    "LastName FI"[Author] AND "Specialty"[Title/Abstract]
                           AND "United States"[Affiliation]
    No date restriction — required for physicians whose full first name
    was never indexed (proven by PubMed author links resolving to initial
    form) AND for physicians with older publication histories (pre-2011).

_verify_author behaviour per tier
    Tier 1 / 2  — strict: full forename match when forename is indexed,
                  initial prefix match when only initials are indexed.
    Tier 3      — relaxed: if the paper is initial-only (no forename
                  indexed for any author), trust the US affiliation filter
                  and accept the initial prefix match without requiring
                  forename confirmation. This is correct because Tier 3
                  only fires when Tiers 1+2 found nothing, meaning the
                  physician almost certainly has no full-name indexed papers.
"""

from __future__ import annotations

import logging
import os
import xml.etree.ElementTree as ET
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

_ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
_EFETCH_URL  = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
_PUBMED_URL  = "https://pubmed.ncbi.nlm.nih.gov/"

MAX_RESULTS      = 10
_YEARS_BACK      = 15   # used for Tier 1 only — recent papers
_TIMEOUT         = 12   # seconds per request

_TOOL  = "ClintrialNavigator"
_EMAIL = "admin@clintrialnavigator.com"

_NCBI_API_KEY: str = os.environ.get("NCBI_API_KEY", "")


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

    Parameters
    ----------
    strict : True  (Tiers 1 & 2) — when forename IS indexed for any author
                   on the paper, require the physician's full forename to
                   match. Distinguishes "Chawla Shawn" from "Chawla Saurabh".
             False (Tier 3)       — always accept on initial prefix match.
                   Safe because Tier 3 only fires when the physician has zero
                   full-name indexed papers, AND the US affiliation filter has
                   already eliminated foreign name collisions.

    Matching logic
    --------------
    Full forename path (strict=True, forename indexed):
        Checks "chawla shawn" or "shawn chawla" appears in the author string.

    Initial prefix path (strict=True, initials only) or (strict=False):
        Checks author string startswith "chawla s".
        "Albakour M" → passes for Mustafa Albakour.
        "Grado G"    → passes for Gordon Grado.
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
            # Tier 3 — initial prefix is sufficient
            matched = any(a.startswith(initial_prefix) for a in authors_lower)
        else:
            # Tiers 1 & 2 — check whether any author has a full forename indexed
            has_full_forename_in_index = any(
                len(a.split()) >= 2
                and a.split()[0] == last
                and len(a.split()[1]) > 1
                for a in authors_lower
            )

            if has_full_forename_in_index:
                # Strict: require physician's full name to match
                matched = any(
                    full_lastfirst in a or full_firstlast in a
                    for a in authors_lower
                )
            else:
                # Initials only on this paper — fall back to prefix
                matched = any(a.startswith(initial_prefix) for a in authors_lower)

        if matched:
            verified.append(pub)

    return verified


def _esearch(query: str, use_date_filter: bool = True) -> list[str]:
    """
    Run an esearch and return a list of PMIDs (up to MAX_RESULTS).

    use_date_filter=False removes the reldate restriction, returning
    results from the full PubMed history. Used for Tiers 2 and 3 so
    that physicians with older publication records are not excluded.
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

    try:
        resp = requests.get(_ESEARCH_URL, params=params, timeout=_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        return data.get("esearchresult", {}).get("idlist", [])
    except Exception as exc:
        logger.warning("PubMed esearch failed | query=%r | error=%s", query, exc)
        return []


def _efetch(pmids: list[str]) -> list[dict]:
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

    Parameters
    ----------
    name          : Physician's full name as returned by NPPES
    taxonomy_desc : NUCC taxonomy description, e.g.
                   "Internal Medicine, Cardiovascular Disease"
                   Pass None when unavailable — Tier 3 still fires
                   without a specialty filter, guarded by US affiliation.

    Tier waterfall
    --------------
    Tier 1  Full name + specialty, recent 15 years
            "Amir Azadi"[Author] AND "Medical Oncology"[Title/Abstract]
            Skipped when specialty is None.

    Tier 2  Full name only, ALL years (no date filter)
            "Gordon Grado"[Author]
            Catches physicians whose papers predate the 15-year window.

    Tier 3  Initial form + specialty + US affiliation, ALL years
            "Grado G"[Author] AND "United States"[Affiliation]
            Fires when full first name was never indexed by PubMed.
            _verify_author runs in relaxed mode (strict=False) — initial
            prefix match is sufficient since US affiliation already
            filtered foreign collisions.
    """
    if not name or not name.strip():
        logger.warning("fetch_publications called with empty name")
        return []

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

    # strict=False: initial prefix sufficient — US affiliation already filtered
    pubs = _verify_author(_efetch(pmids), clean_name, strict=False)
    logger.info(
        "PubMed Tier 3 success | name=%r → %d results",
        name, len(pubs),
    )
    return pubs