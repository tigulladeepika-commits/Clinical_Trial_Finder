from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
import httpx
import difflib

from services.query_cache import get_cached_query, set_cached_query

load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL   = "llama-3.3-70b-versatile"
GROQ_TIMEOUT = 8.0

MAX_CORRECTION_SECONDS = 5.0
FUZZY_SCORE_THRESHOLD = 88
FUZZY_MAX_WORDS = 2

MEDICAL_TERMS = [
    "heart attack", "heart failure", "myocardial infarction",
    "atrial fibrillation", "coronary artery disease", "hypertension",
    "hypotension", "stroke", "diabetes mellitus", "type 2 diabetes",
    "type 1 diabetes", "leukemia", "lymphoma", "multiple myeloma",
    "lung cancer", "breast cancer", "prostate cancer", "colorectal cancer",
    "melanoma", "glioblastoma", "pancreatic cancer", "ovarian cancer",
    "kidney cancer", "bladder cancer", "thyroid cancer", "liver cancer",
    "Parkinson's disease", "Alzheimer's disease", "multiple sclerosis",
    "amyotrophic lateral sclerosis", "epilepsy", "migraine",
    "chronic obstructive pulmonary disease", "asthma", "pulmonary fibrosis",
    "pneumonia", "tuberculosis", "chronic kidney disease",
    "inflammatory bowel disease", "crohn's disease", "ulcerative colitis",
    "rheumatoid arthritis", "systemic lupus erythematosus", "psoriasis",
    "anemia", "deep vein thrombosis", "pulmonary embolism",
    "non-alcoholic fatty liver disease", "cirrhosis", "hepatitis",
    "HIV", "sepsis", "obesity", "osteoporosis", "scoliosis",
    "macular degeneration", "glaucoma", "cataracts",
    "anxiety disorder", "depression", "schizophrenia", "bipolar disorder",
    "post-traumatic stress disorder",
    "attention deficit hyperactivity disorder",
    "autism spectrum disorder", "eating disorder",
    "heart failure with preserved ejection fraction",
    "heart failure with reduced ejection fraction",
    "transcatheter aortic valve replacement",
    "percutaneous coronary intervention",
    "coronary artery bypass grafting",
    "transient ischemic attack",
    "venous thromboembolism",
    "non-small cell lung cancer",
    "small cell lung cancer",
    "diffuse large b-cell lymphoma",
    "chronic lymphocytic leukemia",
    "acute myeloid leukemia",
    "myelodysplastic syndrome",
    "obstructive sleep apnea",
    "gastroesophageal reflux disease",
    "benign prostatic hyperplasia",
    "nonalcoholic steatohepatitis",
    "immune thrombocytopenia",
]


@dataclass
class QueryResult:
    original_query:   str
    corrected_query:  str
    was_corrected:    bool
    correction_layer: str


def _clean_text(query: str) -> str:
    cleaned = query.strip()
    cleaned = re.sub(r"[^\w\s\-']", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


async def _groq_correct(query: str, client: httpx.AsyncClient) -> Optional[str]:
    if not GROQ_API_KEY:
        logger.warning("GROQ_API_KEY not set — skipping Groq correction layer")
        return None

    prompt = (
        "You are a spelling corrector for a clinical trial search engine.\n\n"
        "Your ONLY job is to fix spelling mistakes and expand abbreviations.\n"
        "NEVER translate common English terms to medical jargon.\n\n"
        "Rules:\n"
        "- Fix spelling ONLY: 'hart attak' -> 'heart attack'\n"
        "- Expand abbreviations: 'HFpEF' -> 'heart failure with preserved ejection fraction'\n"
        "- If already correct English, return EXACTLY as-is\n"
        "- 'heart attack' stays 'heart attack' — do NOT change to myocardial infarction\n"
        "- 'stroke' stays 'stroke' — do NOT change to cerebrovascular accident\n"
        "- 'diabetes' stays 'diabetes' — do NOT change to diabetes mellitus\n"
        "- 'cancer' stays 'cancer'\n"
        "- Return ONLY the result. No explanation. No extra words. Max 10 words.\n\n"
        f"Input: {query}\n"
        "Output:"
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
                "max_tokens":  25,
                "temperature": 0.0,
                "messages":    [{"role": "user", "content": prompt}],
            },
            timeout=GROQ_TIMEOUT,
        )

        if resp.status_code == 429:
            logger.warning("Groq rate limit hit during query correction")
            return None
        if resp.status_code != 200:
            logger.warning("Groq correction returned %d for %r", resp.status_code, query)
            return None

        corrected = resp.json()["choices"][0]["message"]["content"].strip()

        if not corrected:
            return None
        if len(corrected) > 120:
            logger.warning("Groq returned too-long correction for %r — ignoring", query)
            return None
        if corrected.lower().strip() == query.lower().strip():
            return None

        logger.info(
            "Groq correction | original=%r → corrected=%r",
            query, corrected,
        )
        return corrected

    except Exception as exc:
        logger.warning("Groq correction failed for %r: %s", query, exc)
        return None


def _fuzzy_correct(query: str) -> Optional[str]:
    word_count = len(query.strip().split())
    if word_count > FUZZY_MAX_WORDS:
        logger.debug(
            "RapidFuzz skipped — %d words (max %d): %r",
            word_count, FUZZY_MAX_WORDS, query,
        )
        return None
    # Fallback pure-Python fuzzy matching using difflib.SequenceMatcher.
    # Compute similarity ratio against each MEDICAL_TERMS entry and
    # accept the best candidate above the threshold.
    q = query.lower().strip()
    best: tuple[str, float] | None = None
    for t in MEDICAL_TERMS:
        score = difflib.SequenceMatcher(None, q, t.lower()).ratio() * 100
        if score >= FUZZY_SCORE_THRESHOLD:
            if best is None or score > best[1]:
                best = (t, score)

    if not best:
        return None

    corrected, score = best
    if corrected.lower().strip() == q:
        return None

    logger.info(
        "Fuzzy correction | original=%r → corrected=%r score=%.1f",
        query, corrected, score,
    )
    return corrected


async def correct_query(raw_query: str) -> QueryResult:
    if not raw_query or not raw_query.strip():
        return QueryResult(
            original_query=raw_query,
            corrected_query=raw_query,
            was_corrected=False,
            correction_layer="none",
        )

    cleaned = _clean_text(raw_query)

    cached = get_cached_query(cleaned)
    if cached:
        return QueryResult(
            original_query=raw_query,
            corrected_query=cached,
            was_corrected=cached.lower() != cleaned.lower(),
            correction_layer="cache",
        )

    corrected: Optional[str] = None
    layer_used = "none"

    async def _run_ai_layers() -> tuple[Optional[str], str]:
        async with httpx.AsyncClient(
            headers={"User-Agent": "ClinTrialNavigator/1.0"},
            follow_redirects=True,
        ) as client:
            result = await _groq_correct(cleaned, client)
            if result:
                return result, "groq"

        result = _fuzzy_correct(cleaned)
        if result:
            return result, "fuzzy"

        return None, "none"

    try:
        corrected, layer_used = await asyncio.wait_for(
            _run_ai_layers(),
            timeout=MAX_CORRECTION_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "AI correction timed out after %.1fs for %r — using original query",
            MAX_CORRECTION_SECONDS, raw_query,
        )
        corrected = None
        layer_used = "timeout"

    final_query   = corrected if corrected else cleaned
    was_corrected = bool(corrected) and (final_query.lower() != cleaned.lower())

    if was_corrected:
        set_cached_query(cleaned, final_query)

    logger.info(
        "AI Search | original=%r → final=%r | layer=%s | corrected=%s",
        raw_query, final_query, layer_used, was_corrected,
    )

    return QueryResult(
        original_query=raw_query,
        corrected_query=final_query,
        was_corrected=was_corrected,
        correction_layer=layer_used,
    )
