from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
import httpx

load_dotenv(Path(__file__).parent.parent / ".env")

logger = logging.getLogger(__name__)
_GROQ_API_URL = os.environ.get("GROQ_API_URL", "").strip()
_GROQ_MODEL   = os.environ.get("GROQ_MODEL", "gpt-4o-mini").strip()
_TIMEOUT_SECONDS = 18.0


def _build_prompt(
    name: str,
    specialty: str,
    disease: str,
    npi_state: str = "",
) -> str:
    details = (
        f"Name: {name}. Specialty: {specialty}. "
        f"State: {npi_state}. Context: {disease}."
    )
    return (
        "Create a concise physician profile summary for a healthcare provider. "
        + details + " "
        "Also list up to 5 recent relevant publications in a structured JSON array under the key \"publications\". "
        "Each publication should include pmid, title, journal, year, authors, url, and a short abstract if available. "
        "Return valid JSON with keys: npi, name, status, summary, publications."
    )


def _normalize_response(body: Any, npi: str, name: str) -> dict[str, Any]:
    if isinstance(body, dict):
        if body.get("npi") and body.get("summary"):
            return {
                "npi":          body.get("npi", npi),
                "name":         body.get("name", name),
                "status":       body.get("status", "ok"),
                "summary":      body.get("summary", ""),
                "publications": body.get("publications", []),
                "error":        body.get("error"),
            }

        text = None
        if "choices" in body and isinstance(body["choices"], list) and body["choices"]:
            choice = body["choices"][0]
            if isinstance(choice, dict):
                text = choice.get("message", {}).get("content") or choice.get("text")
        for key in ("text", "output", "result", "data"):
            if text is None and key in body and isinstance(body[key], str):
                text = body[key]

        if text:
            try:
                parsed = json.loads(text)
                if isinstance(parsed, dict) and parsed.get("summary"):
                    return _normalize_response(parsed, npi, name)
            except json.JSONDecodeError:
                pass

    if isinstance(body, str):
        try:
            parsed = json.loads(body)
            return _normalize_response(parsed, npi, name)
        except json.JSONDecodeError:
            pass

    logger.warning("Unable to normalize AI response into insights | npi=%s body=%r", npi, body)
    return {
        "npi":          npi,
        "name":         name,
        "status":       "ok",
        "summary":      str(body) if isinstance(body, str) else "",
        "publications": [],
    }


def _fallback_response(npi: str, name: str, specialty: str, disease: str) -> dict[str, Any]:
    return {
        "npi":          npi,
        "name":         name,
        "status":       "fallback",
        "summary":      (
            f"{name} is a {specialty} relevant to {disease}. "
            "This summary is generated from available profile context."
        ),
        "publications": [],
        "error":        None,
    }


async def enrich_physician(
    npi: str,
    name: str,
    specialty: str,
    disease: str,
    groq_api_key: str,
    npi_state: str = "",
) -> dict[str, Any]:
    if not npi or not name:
        raise ValueError("npi and name are required for physician enrichment")

    prompt = _build_prompt(name, specialty, disease, npi_state)

    if groq_api_key and _GROQ_API_URL:
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    _GROQ_API_URL,
                    headers={
                        "Authorization": f"Bearer {groq_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model":   _GROQ_MODEL,
                        "input":   prompt,
                    },
                )
                response.raise_for_status()
                return _normalize_response(response.json(), npi, name)
        except Exception as exc:
            logger.warning(
                "AI enrichment request failed | npi=%s name=%r specialty=%r disease=%r state=%r error=%s",
                npi, name, specialty, disease, npi_state, exc,
            )

    return _fallback_response(npi, name, specialty, disease)
