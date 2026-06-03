"""
physician_insights_service.py

Enrichment pipeline for a single physician:

  1. Fetch publications from PubMed  (pubmed_service)
  2. Fetch publications from EuropePMC  (europepmc_service)
  3. Merge + deduplicate by PMID / title
  4. Verify relevance via Groq  (publication_verification_service)
  5. Generate a plain-text summary via Groq using the verified publications
     as context — falls back to a profile-only summary if Groq is unavailable.

Publications come from real bibliographic databases, NOT from an LLM.
Groq is used only for (a) title relevance verification and (b) summary text.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
import httpx

from services import pubmed_service, europepmc_service
from services.publication_verifier import verify_publications

load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger(__name__)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL   = "llama-3.3-70b-versatile"
HTTP_TIMEOUT = 20.0

# Minimum confidence score to accept publications from a source
_MIN_CONFIDENCE = 15


# ── Helpers ───────────────────────────────────────────────────────────────────

def _merge_publications(
    pubmed_pubs:  list[dict],
    epmc_pubs:    list[dict],
) -> list[dict]:
    """
    Merge PubMed and EuropePMC results, deduplicate by PMID then by title.
    PubMed takes priority when both sources have the same paper.
    """
    seen_pmids:  set[str] = set()
    seen_titles: set[str] = set()
    merged: list[dict] = []

    for pub in pubmed_pubs + epmc_pubs:
        pmid  = (pub.get("pmid") or "").strip()
        title = (pub.get("title") or "").strip().lower()[:80]

        if pmid and pmid in seen_pmids:
            continue
        if title and title in seen_titles:
            continue

        if pmid:
            seen_pmids.add(pmid)
        if title:
            seen_titles.add(title)

        merged.append(pub)

    # Sort newest first
    merged.sort(key=lambda p: p.get("year") or 0, reverse=True)
    return merged


async def _groq_summary(
    name:         str,
    specialty:    str,
    disease:      str,
    publications: list[dict],
    client:       httpx.AsyncClient,
) -> str:
    """
    Generate a concise physician profile summary using Groq.
    Publications are passed as context so the summary is grounded in real data.
    Returns an empty string on failure — caller uses a fallback.
    """
    if not GROQ_API_KEY:
        return ""

    pub_lines = ""
    if publications:
        pub_lines = "\n".join(
            f"- {p.get('title', '')} ({p.get('year', 'n/d')})"
            for p in publications[:8]
        )
        pub_context = f"\n\nSelected publications:\n{pub_lines}"
    else:
        pub_context = ""

    prompt = (
        f"Write a concise 3-sentence professional profile for a physician.\n"
        f"Name: {name}\n"
        f"Specialty: {specialty}\n"
        f"Clinical context: {disease}"
        f"{pub_context}\n\n"
        "Focus on their specialty, clinical expertise, and research contributions. "
        "Do not invent facts. Return plain text only — no JSON, no bullet points."
    )

    try:
        resp = await client.post(
            GROQ_URL,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type":  "application/json",
            },
            json={
                "model":       GROQ_MODEL,
                "max_tokens":  300,
                "temperature": 0.3,
                "messages":    [{"role": "user", "content": prompt}],
            },
            timeout=HTTP_TIMEOUT,
        )

        if resp.status_code != 200:
            logger.warning("Groq summary failed %d for %r", resp.status_code, name)
            return ""

        content = resp.json()["choices"][0]["message"]["content"].strip()
        return content

    except Exception as exc:
        logger.warning("Groq summary error for %r: %s", name, exc)
        return ""


def _fallback_summary(name: str, specialty: str, disease: str) -> str:
    return (
        f"{name} is a {specialty} specialist with clinical expertise relevant to {disease}. "
        "This summary is generated from available profile context."
    )


# ── Main entry point ──────────────────────────────────────────────────────────

async def enrich_physician(
    npi:          str,
    name:         str,
    specialty:    str,
    disease:      str,
    groq_api_key: str,
    npi_state:    str = "",
) -> dict[str, Any]:
    """
    Full enrichment pipeline for a single physician.

    Returns a dict with keys:
        npi, name, status, summary, publications, error
    """
    if not npi or not name:
        raise ValueError("npi and name are required for physician enrichment")

    logger.info(
        "Enriching physician | npi=%s name=%r specialty=%r disease=%r state=%r",
        npi, name, specialty, disease, npi_state,
    )

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:

        # ── Step 1: Fetch publications from PubMed + EuropePMC in parallel ──
        pubmed_result, epmc_result = await asyncio.gather(
            pubmed_service.pubmed_lookup(
                name      = name,
                specialty = specialty,
                client    = client,
                disease   = disease,
            ),
            europepmc_service.europepmc_lookup(
                name      = name,
                specialty = specialty,
                client    = client,
                disease   = disease,
            ),
            return_exceptions=True,
        )

        # Handle exceptions from gather
        pubmed_pubs: list[dict] = []
        epmc_pubs:   list[dict] = []

        if isinstance(pubmed_result, Exception):
            logger.warning("PubMed lookup exception for %r: %s", name, pubmed_result)
        else:
            pubmed_conf = pubmed_result.get("confidence", 0)
            if pubmed_conf >= _MIN_CONFIDENCE:
                pubmed_pubs = pubmed_result.get("publications", [])
                logger.info(
                    "PubMed: %d publications | confidence=%d",
                    len(pubmed_pubs), pubmed_conf,
                )
            else:
                logger.info(
                    "PubMed: confidence too low (%d) — skipping %d papers",
                    pubmed_conf, len(pubmed_result.get("publications", [])),
                )

        if isinstance(epmc_result, Exception):
            logger.warning("EuropePMC lookup exception for %r: %s", name, epmc_result)
        else:
            epmc_conf = epmc_result.get("confidence", 0)
            if epmc_conf >= _MIN_CONFIDENCE:
                epmc_pubs = epmc_result.get("publications", [])
                logger.info(
                    "EuropePMC: %d publications | confidence=%d",
                    len(epmc_pubs), epmc_conf,
                )
            else:
                logger.info(
                    "EuropePMC: confidence too low (%d) — skipping %d papers",
                    epmc_conf, len(epmc_result.get("publications", [])),
                )

        # ── Step 2: Merge + deduplicate ──────────────────────────────────────
        merged = _merge_publications(pubmed_pubs, epmc_pubs)
        logger.info("Merged publications: %d total", len(merged))

        # ── Step 3: Verify relevance via Groq ────────────────────────────────
        if merged:
            verified = await verify_publications(
                publications    = merged,
                specialty       = specialty,
                npi_state       = npi_state,
                client          = client,
                physician_name  = pubmed_service.clean_name(name),
            )
            logger.info(
                "Verified publications: %d / %d kept",
                len(verified), len(merged),
            )
        else:
            verified = []

        # ── Step 4: Generate summary via Groq ────────────────────────────────
        summary = await _groq_summary(
            name         = name,
            specialty    = specialty,
            disease      = disease,
            publications = verified,
            client       = client,
        )

        if not summary:
            summary = _fallback_summary(name, specialty, disease)

        status = "ready" if verified else "fallback"

        logger.info(
            "Enrich complete | npi=%s | publications=%d | status=%s",
            npi, len(verified), status,
        )

        return {
            "npi":          npi,
            "name":         name,
            "status":       status,
            "summary":      summary,
            "publications": verified,
            "error":        None,
        }