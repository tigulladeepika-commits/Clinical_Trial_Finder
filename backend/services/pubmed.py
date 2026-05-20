"""
services/pubmed.py

Fetches a physician's publications from the NCBI PubMed E-utilities API.

Strategy
--------
Tier 1 — Full name + specialty keyword (title/abstract):
    "Firstname Lastname"[Author] AND "Specialty"[Title/Abstract]

Tier 2 — Full name only (fires when Tier 1 returns 0):
    "Firstname Lastname"[Author]

Tier 3 — Initial form + specialty + US affiliation (fires when Tier 2 returns 0):
    "LastName FI"[Author] AND "Specialty"[Title/Abstract]
                           AND "United States"[Affiliation]

    Required for physicians whose full first name was never indexed by PubMed
    (common for authors with few publications regardless of paper age).
    PubMed website proof: the author link for Mustafa Albakour resolves to
    "Albakour M" — the full forename is absent from the index entirely.

    False-positive guard at Tier 3:
    _verify_author checks the XML <ForeName> field (full forename) when
    available, falling back to the initial check. This distinguishes
    "Chawla Shawn" from "Chawla Saurabh" even though both index as "Chawla S".

NOTE: Specialty is used as a plain [Title/Abstract] keyword — no MeSH
mapping table required. The most specific part of the NPPES taxonomy
string is used directly (e.g. "Cardiovascular Disease" from
"Internal Medicine, Cardiovascular Disease").
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

MAX_RESULTS = 10
_YEARS_BACK = 15
_TIMEOUT    = 12   # seconds per request

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
    None                                         → None
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
    Initial form + specialty keyword + US affiliation.

    Fires only when Tiers 1 and 2 return 0, meaning the full first name
    was never indexed. US affiliation cuts foreign name collisions.
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


def _verify_author(pubs: list[dict], clean_name: str) -> list[dict]:
    """
    Drop papers where the physician's name does not appear in the author list.

    Three-layer check (most → least specific):

    1. Full forename match  — "Chawla Shawn" or "Shawn Chawla" in author string
       Uses the <ForeName> field stored as "LastName ForeName" by the parser.
       Distinguishes Shawn Chawla from Saurabh Chawla even at Tier 3.

    2. Initial prefix match — author startswith "chawla s"
       Catches papers where only the initial was indexed (e.g. "Albakour M").
       Only used when the full forename is NOT present in any author record,
       i.e. when every author for this paper was stored as initial-only.

    3. Pass-through         — if clean_name has only one token, can't verify.
    """
    parts = clean_name.strip().split()
    if len(parts) < 2:
        return pubs

    last           = parts[-1].lower()
    first_name     = parts[0].lower()                    # "shawn"
    first_initial  = first_name[0]                       # "s"
    initial_prefix = f"{last} {first_initial}"           # "chawla s"
    # PubMed XML stores authors as "LastName ForeName" when forename is present
    full_lastfirst = f"{last} {first_name}"              # "chawla shawn"
    full_firstlast = f"{first_name} {last}"              # "shawn chawla"

    verified = []
    for pub in pubs:
        authors_lower = [a.lower() for a in pub.get("authors", [])]

        # Layer 1 — full forename present anywhere in author list
        # e.g. "Chawla Shawn" stored by parser when <ForeName> was indexed
        has_full_forename_in_index = any(
            # Does any author string contain a space after the last-name prefix,
            # suggesting a forename (not just an initial) was indexed?
            len(a.split()) >= 2 and a.split()[0] == last and len(a.split()[1]) > 1
            for a in authors_lower
        )

        if has_full_forename_in_index:
            # Full forename IS indexed for at least one author on this paper —
            # apply strict check: physician's full name must match exactly.
            matched = any(
                full_lastfirst in a or full_firstlast in a
                for a in authors_lower
            )
        else:
            # Full forename NOT indexed (initial-only paper, e.g. "Albakour M")
            # Fall back to initial prefix — less precise but correct for
            # uncommon names that reached Tier 3.
            matched = any(a.startswith(initial_prefix) for a in authors_lower)

        if matched:
            verified.append(pub)

    return verified


def _esearch(query: str) -> list[str]:
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
      - "LastName ForeName"  when <ForeName> is present in XML  → "Chawla Shawn"
      - "LastName Initials"  when only <Initials> present       → "Albakour M"
      - "CollectiveName"     for group authors

    Storing the full forename (when available) is critical for _verify_author
    to distinguish physicians sharing the same last name and first initial.
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
                last      = author_node.findtext("LastName",  default="").strip()
                forename  = author_node.findtext("ForeName",  default="").strip()
                initials  = author_node.findtext("Initials",  default="").strip()

                if last:
                    if forename:
                        # Prefer full forename: "Chawla Shawn"
                        authors.append(f"{last} {forename}")
                    elif initials:
                        # Fall back to initials: "Albakour M"
                        authors.append(f"{last} {initials}")
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
    Fetch up to MAX_RESULTS recent publications for a physician.

    Parameters
    ----------
    name          : Physician's full name as returned by NPPES
    taxonomy_desc : NUCC taxonomy description, e.g.
                   "Internal Medicine, Cardiovascular Disease"

    Tier waterfall
    --------------
    Tier 1  Full name + specialty   "Mustafa Albakour"[Author]
                                     AND "Internal Medicine"[Title/Abstract]

    Tier 2  Full name only          "Mustafa Albakour"[Author]
            Catches cross-specialty papers or papers without specialty
            keyword in title/abstract.

    Tier 3  Initial + specialty     "Albakour M"[Author]
             + US affiliation        AND "Internal Medicine"[Title/Abstract]
                                     AND "United States"[Affiliation]
            Last resort for physicians whose full first name was never
            indexed by PubMed (proven by PubMed's own author link resolving
            to "Albakour M" rather than "Mustafa Albakour").

    All tiers pass through _verify_author(), which uses the XML <ForeName>
    field to distinguish same-initial physicians (e.g. Shawn vs Saurabh Chawla).
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

    if pmids:
        pubs = _verify_author(_efetch(pmids), clean_name)
        if pubs:
            logger.info(
                "PubMed Tier 2 success | name=%r → %d results",
                name, len(pubs),
            )
            return pubs

    # ── Tier 3: Initial form + specialty + US affiliation ──────────────────
    query_t3 = _build_tier3_query(clean_name, specialty_keyword)
    logger.info("PubMed Tier 3 (initial form + US affiliation fallback) | query=%r", query_t3)
    pmids = _esearch(query_t3)

    if not pmids:
        logger.info(
            "PubMed | no results across all tiers | name=%r specialty=%r",
            name, taxonomy_desc,
        )
        return []

    pubs = _verify_author(_efetch(pmids), clean_name)
    logger.info(
        "PubMed Tier 3 success | name=%r → %d results",
        name, len(pubs),
    )
    return pubs