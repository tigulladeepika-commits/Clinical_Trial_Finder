"""

physician_insights_service.py



Enrichment pipeline for a single physician:



  1. Fetch publications from PubMed        (pubmed_service)         — primary

  2. Fetch publications from EuropePMC     (europepmc_service)      — secondary

  3. Fetch publications from Semantic Scholar (semantic_scholar_service) — tertiary + disambiguation

  4. Merge + deduplicate by PMID / title

  5. Verify relevance via Groq             (publication_verifier)

  6. Generate a plain-text summary via Groq using the verified publications

     as context — falls back to a profile-only summary if Groq is unavailable.



Publications come from real bibliographic databases, NOT from an LLM.

Groq is used only for (a) title relevance verification and (b) summary text.



S2 integration notes:

  - S2 author search uses full name + state affiliation matching

  - S2 results carry affiliation_verified=True — skip author name filter

  - If S2 finds NO matching author for a physician, it suppresses that physician's

    PubMed/EuropePMC results that have no affiliation (high collision risk)

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

from services.semantic_scholar_service import semantic_scholar_lookup

from services.publication_verifier import verify_publications



load_dotenv(Path(__file__).parent.parent / ".env")



logger = logging.getLogger(__name__)



GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"

GROQ_MODEL   = "openai/gpt-oss-120b"
# Fallback chain: each model has its own separate rate limit bucket on Groq
GROQ_FALLBACK_MODELS = [
    "openai/gpt-oss-120b",   # primary  — 8K TPM, best quality
    "openai/gpt-oss-20b",    # secondary — 8K TPM, 1000 tps
    "llama-3.1-8b-instant",  # tertiary  — 6K TPM, highest availability
]

HTTP_TIMEOUT = 20.0



# Minimum confidence score to accept publications from a source

_MIN_CONFIDENCE = 15





# ── Helpers ──────────────────────────────────────────────────────────────────



def _merge_publications(

    pubmed_pubs: list[dict],

    epmc_pubs:   list[dict],

    s2_pubs:     list[dict],

) -> list[dict]:

    """

    Merge PubMed, EuropePMC, and Semantic Scholar results.

    Deduplicate by PMID then by title.

    PubMed takes priority, then EuropePMC, then S2.

    S2 papers already have affiliation_verified=True set.

    """

    seen_pmids:  set[str] = set()

    seen_titles: set[str] = set()

    merged: list[dict]    = []



    for pub in pubmed_pubs + epmc_pubs + s2_pubs:

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

            for p in publications[:5]

        )

        pub_context = f"\n\nSelected publications (summarize themes only, do NOT quote titles):\n{pub_lines}"

    else:

        pub_context = ""



    prompt = (

        f"Write a concise 2-sentence professional summary for a physician. Be brief and specific. Do NOT quote paper titles.\n"

        f"Name: {name}\n"

        f"Specialty: {specialty}\n"

        f"{pub_context}\n\n"

        "Focus ONLY on their specialty and actual research contributions listed above. "

        "Do NOT assume clinical expertise not supported by the publications. "

        "Do not invent facts. Return plain text only — no JSON, no bullet points."

    )



    for _sum_model in GROQ_FALLBACK_MODELS:
        try:
            resp = await client.post(
                GROQ_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type":  "application/json",
                },
                json={
                    "model":       _sum_model,
                    "max_tokens":  300,
                    "temperature": 0.3,
                    "messages":    [{"role": "user", "content": prompt}],
                },
                timeout=HTTP_TIMEOUT,
            )
            if resp.status_code == 429:
                logger.warning("Groq summary 429 on %s for %r - trying next model", _sum_model, name)
                continue
            if resp.status_code != 200:
                logger.warning("Groq summary failed %d model=%s for %r", resp.status_code, _sum_model, name)
                continue
            content = resp.json()["choices"][0]["message"]["content"].strip()
            return content
        except Exception as exc:
            logger.warning("Groq summary error model=%s for %r: %s", _sum_model, name, exc)
            continue
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



        # ── Step 1: Fetch from all three sources in parallel ──────────────

        pubmed_result, epmc_result, s2_result = await asyncio.gather(

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

            semantic_scholar_lookup(

                name      = name,

                specialty = specialty,

                npi_state = npi_state,

                client    = client,

                disease   = disease,

            ),

            return_exceptions=True,

        )



        # ── Step 2: Extract publications from each source ─────────────────

        pubmed_pubs: list[dict] = []

        epmc_pubs:   list[dict] = []

        s2_pubs:     list[dict] = []

        s2_author_verified = False



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



        if isinstance(s2_result, Exception):

            logger.warning("Semantic Scholar lookup exception for %r: %s", name, s2_result)

        else:

            s2_conf = s2_result.get("confidence", 0)

            s2_author_id = s2_result.get("author_id")

            s2_affiliation = s2_result.get("affiliation")



            if s2_author_id:

                # S2 found a verified author match

                s2_author_verified = True

                s2_pubs = s2_result.get("publications", [])

                logger.info(

                    "S2: matched author_id=%s affiliation=%r publications=%d",

                    s2_author_id, s2_affiliation, len(s2_pubs),

                )

            else:

                logger.info(

                    "S2: no author match for %r (state=%s) — "

                    "PubMed/EuropePMC results will be filtered more strictly",

                    name, npi_state,

                )

                # S2 found no matching author. We used to strip PubMed papers here
                # that lacked affiliation data when the name was common and PubMed
                # confidence was low - but PubMed's esummary API never returns
                # per-author affiliation, so that check was always false and
                # silently zeroed out 100% of PubMed results for every common
                # surname (Han, Kim, Ahmed, Brown...) whenever confidence dipped
                # below 85. Disambiguation for common surnames now relies on
                # Groq's title/specialty verification and the keyword-fallback
                # safety net downstream instead of this dead filter.

                clean = pubmed_service.clean_name(name)

                is_common = pubmed_service._is_common_name(clean)

                if is_common:
                    logger.info(
                        "S2 no-match: common name (confidence=%d) - "
                        "deferring to Groq/keyword-fallback specialty verification",
                        pubmed_conf,
                    )
        # ── Step 3: Merge + deduplicate ───────────────────────────────────

        merged = _merge_publications(pubmed_pubs, epmc_pubs, s2_pubs)

        logger.info(

            "Merged publications: %d total (pubmed=%d epmc=%d s2=%d)",

            len(merged), len(pubmed_pubs), len(epmc_pubs), len(s2_pubs),

        )



        # ── Step 4: Verify relevance ──────────────────────────────────────

        if merged:

            verified = await verify_publications(

                publications   = merged,

                specialty      = specialty,

                npi_state      = npi_state,

                client         = client,

                physician_name = pubmed_service.clean_name(name),

            )

            logger.info(

                "Verified publications: %d / %d kept",

                len(verified), len(merged),

            )

        else:

            verified = []



        # ── Step 5: Generate Groq summary ─────────────────────────────────

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

            "Enrich complete | npi=%s | publications=%d | status=%s | s2_verified=%s",

            npi, len(verified), status, s2_author_verified,

        )



        return {

            "npi":          npi,

            "name":         name,

            "status":       status,

            "summary":      summary,

            "publications": verified,

            "error":        None,

        }

