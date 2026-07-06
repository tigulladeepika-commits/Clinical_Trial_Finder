"""
services/salesforce.py — Salesforce Lead Integration
=====================================================
Pushes leads to Salesforce.

Active method : REST API  (OAuth2 + JSON POST to /sobjects/Lead/)
Fallback       : Web-to-Lead (used only when REST credentials are absent)

Why REST API?
  Web-to-Lead silently dropped the GenderIdentity picklist field because
  it needs an obscure generated field-ID for every non-standard key.
  The REST API uses real Salesforce field API names (GenderIdentity,
  NPI_Number__c, Specialization__c) directly — no mapping needed.

REST credentials (set in Render env vars):
  SF_CLIENT_ID      — Connected App Consumer Key
  SF_CLIENT_SECRET  — Connected App Consumer Secret
  SF_USERNAME       — Salesforce API user login email
  SF_PASSWORD       — password + security token joined (no space)
  SF_INSTANCE_URL   — e.g. https://aquarient.my.salesforce.com
"""

import logging
import re
import copy
from typing import Dict, Tuple, Optional

import requests

try:
    from core.config import cfg
    from core.helpers import sanitise
    from services.http_client import http_client
except ModuleNotFoundError:  # pragma: no cover
    from backend.core.config import cfg
    from backend.core.helpers import sanitise
    from backend.services.http_client import http_client

logger = logging.getLogger(__name__)

_EMAIL_REGEX = re.compile(
    r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$'
)

# Salesforce OAuth2 token endpoint
_SF_TOKEN_URL = "https://login.salesforce.com/services/oauth2/token"

# Exact picklist values configured in Salesforce for GenderIdentity field
_GENDER_PICKLIST = {"Male", "Female", "Nonbinary", "Not Listed"}

# In-memory OAuth token cache — avoids fetching a new token on every lead
_token_cache: dict = {"access_token": None, "instance_url": None}

# Stores the last payload sent (for debug endpoint)
_last_sf_payload: Optional[dict] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

def get_last_payload() -> Optional[dict]:
    """Return the last Salesforce payload sent (REST or Web-to-Lead)."""
    return _last_sf_payload


def _is_invalid_email(email: str) -> bool:
    """Return True if email is present but malformed. Blank is allowed."""
    lower = email.strip().lower()
    if not lower:
        return False
    return not bool(_EMAIL_REGEX.match(lower))


def _normalise_gender_identity(value: str) -> str:
    """
    Map raw gender string to an exact Salesforce picklist value.

    Picklist values: Male | Female | Nonbinary | Not Listed

    NPPES returns  : "M", "F", "U"
    User may type  : "male", "FEMALE", "non-binary", etc.
    """
    raw = str(value or "").strip()
    if not raw:
        return ""

    normalized = raw.lower()

    if normalized in ("m", "male"):
        return "Male"
    if normalized in ("f", "female"):
        return "Female"
    if normalized in ("nonbinary", "non-binary", "non binary"):
        return "Nonbinary"
    # Unknown / unrecognised → "Not Listed" (NOT "Unknown" — that's not in picklist)
    if normalized in ("u", "unknown", "unk", "not listed", "other"):
        return "Not Listed"

    # Try title-case match against known picklist values
    title_cased = " ".join(part.capitalize() for part in raw.split())
    if title_cased in _GENDER_PICKLIST:
        return title_cased

    logger.warning("Unrecognised gender value '%s' — leaving GenderIdentity blank", raw)
    return ""


# ── OAuth2 — REST API token ────────────────────────────────────────────────────

def _get_access_token() -> Tuple[str, str]:
    """
    Fetch (or return cached) Salesforce OAuth2 access token.

    Returns:
        Tuple of (access_token, instance_url)

    Raises:
        RuntimeError on auth failure.
    """
    if _token_cache["access_token"] and _token_cache["instance_url"]:
        logger.debug("Using cached Salesforce OAuth2 token")
        return _token_cache["access_token"], _token_cache["instance_url"]

    logger.info("Fetching new Salesforce OAuth2 access token")

    try:
        resp = requests.post(
            _SF_TOKEN_URL,
            data={
                "grant_type":    "password",
                "client_id":     cfg.SF_CLIENT_ID,
                "client_secret": cfg.SF_CLIENT_SECRET,
                "username":      cfg.SF_USERNAME,
                "password":      cfg.SF_PASSWORD,
            },
            timeout=15,
        )
    except requests.Timeout:
        raise RuntimeError("Salesforce OAuth2 token request timed out after 15s")
    except Exception as ex:
        raise RuntimeError(f"Salesforce OAuth2 request failed: {ex}") from ex

    if resp.status_code != 200:
        raise RuntimeError(
            f"Salesforce OAuth2 failed — HTTP {resp.status_code}. "
            "Check SF_CLIENT_ID, SF_CLIENT_SECRET, SF_USERNAME, SF_PASSWORD."
        )

    data = resp.json()
    if "access_token" not in data:
        raise RuntimeError(
            f"Salesforce OAuth2 missing access_token. "
            f"Error: {data.get('error')} — {data.get('error_description')}"
        )

    _token_cache["access_token"] = data["access_token"]
    _token_cache["instance_url"] = data.get("instance_url", "")
    logger.info("Salesforce OAuth2 token obtained | instance=%s", _token_cache["instance_url"])
    return _token_cache["access_token"], _token_cache["instance_url"]


def _invalidate_token_cache() -> None:
    """Clear cached token so next call re-authenticates (called on 401)."""
    _token_cache["access_token"] = None
    _token_cache["instance_url"] = None


# ── REST API payload builder ───────────────────────────────────────────────────

def _build_rest_payload(lead: Dict) -> dict:
    """
    Build a Salesforce Lead JSON payload using real API field names.

    Field mapping:
      FirstName        → Lead first name
      LastName         → Lead last name
      Email            → Lead email
      Phone            → Lead phone
      Company          → Organisation (required by Salesforce)
      Title            → Physician specialization label
      LeadSource       → Always "Clinical Trial"
      Description      → Full context summary text
      GenderIdentity   → Picklist: Male / Female / Nonbinary / Not Listed  ← THE FIX
      NPI_Number__c    → Custom field: Physician NPI number
      Specialization__c→ Custom field: Physician specialization
    """
    physician_name  = lead.get("physician_name", "")
    npi             = lead.get("npi", "")
    npi_number      = lead.get("npi_number") or npi
    specialization  = lead.get("specialization", "")
    gender_identity = _normalise_gender_identity(lead.get("gender_identity", ""))
    nct_id          = lead.get("nct_id", "")
    site            = lead.get("site", "")
    message         = lead.get("message", "")
    ctx             = lead.get("search_context", {})

    # Build description text
    desc_parts = ["Clinical Trial Navigator Lead"]
    if physician_name:  desc_parts.append(f"Physician: {physician_name}")
    if npi:             desc_parts.append(f"NPI: {npi}")
    if npi_number:      desc_parts.append(f"NPI Number: {npi_number}")
    if specialization:  desc_parts.append(f"Specialization: {specialization}")
    if gender_identity: desc_parts.append(f"Gender Identity: {gender_identity}")
    if nct_id:          desc_parts.append(f"Trial: {nct_id}")
    if site:            desc_parts.append(f"Site: {site}")
    if message:         desc_parts.append(f"Message: {message}")
    if ctx.get("address"):      desc_parts.append(f"Location: {ctx['address']}")
    if ctx.get("descriptions"): desc_parts.append(f"Specialty: {', '.join(ctx['descriptions'])}")

    payload: dict = {
        "FirstName":   sanitise(lead.get("first_name", ""), 80),
        "LastName":    sanitise(lead.get("last_name") or "Unknown", 80),
        "Email":       sanitise(lead.get("email", ""), 254),
        "Phone":       sanitise(lead.get("phone", ""), 40),
        "Company":     sanitise(lead.get("company") or "Individual Physicians", 255),
        "Title":       sanitise(lead.get("title", ""), 128),
        "LeadSource":  sanitise(lead.get("lead_source", "Clinical Trial"), 40),
        "Description": sanitise(" | ".join(desc_parts), 32000),
    }

    # GenderIdentity — standard Salesforce picklist, works directly with REST API
    if gender_identity:
        payload["GenderIdentity"] = gender_identity

    # Custom fields — must exist in Salesforce org
    if npi_number:
        payload["NPI_Number__c"] = sanitise(npi_number, 20)
    if specialization:
        payload["Specialization__c"] = sanitise(specialization, 255)

    # Remove empty strings — REST API prefers omission over "" for optional fields
    payload = {k: v for k, v in payload.items() if v != ""}

    return payload


# ── REST API push ──────────────────────────────────────────────────────────────

def _push_via_rest_api(lead: Dict) -> Tuple[bool, int, str, str]:
    """
    Create a Salesforce Lead via the REST API.

    Returns:
        Tuple of (success, http_status, response_snippet, error_message)
    """
    global _last_sf_payload

    email = lead.get("email", "")
    if _is_invalid_email(email):
        logger.info(
            "Skipping SF REST push for lead %s — invalid email '%s'",
            lead.get("id"), email,
        )
        return True, 0, "", ""

    payload = _build_rest_payload(lead)
    _last_sf_payload = copy.deepcopy(payload)

    logger.info(
        "SF REST payload | lead_id=%s | fields=%s | GenderIdentity=%s | NPI_Number__c=%s",
        lead.get("id"),
        list(payload.keys()),
        payload.get("GenderIdentity", "<not set>"),
        payload.get("NPI_Number__c", "<not set>"),
    )

    # Step 1 — Get OAuth token
    try:
        access_token, token_instance_url = _get_access_token()
    except RuntimeError as ex:
        logger.error("SF REST auth failed: %s", ex)
        return False, 0, "", str(ex)

    # Use env instance_url if set, otherwise use the one from the token response
    base_url = (cfg.SF_INSTANCE_URL or token_instance_url).rstrip("/")
    api_version = getattr(cfg, "SF_API_VERSION", "59.0")
    endpoint = f"{base_url}/services/data/v{api_version}/sobjects/Lead/"

    # Step 2 — POST lead JSON
    try:
        resp = requests.post(
            endpoint,
            json=payload,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type":  "application/json",
            },
            timeout=cfg.REQUEST_TIMEOUT,
        )
    except requests.Timeout:
        msg = f"SF REST request timed out after {cfg.REQUEST_TIMEOUT}s"
        logger.error(msg)
        return False, 0, "", msg
    except Exception as ex:
        msg = f"SF REST request exception: {type(ex).__name__}: {ex}"
        logger.error(msg)
        return False, 0, "", msg

    snippet = (resp.text or "")[:500]

    # 401 — token expired, clear cache so next call re-authenticates
    if resp.status_code == 401:
        logger.warning("SF REST 401 — clearing token cache")
        _invalidate_token_cache()
        return False, 401, snippet, "Salesforce token expired — will retry on next request"

    # 201 Created — success
    if resp.status_code == 201:
        sf_lead_id = resp.json().get("id", "unknown")
        logger.info(
            "SF REST lead created | sf_id=%s | lead_id=%s | email=%s | GenderIdentity=%s",
            sf_lead_id, lead.get("id"), email, payload.get("GenderIdentity", "<not set>"),
        )
        return True, 201, snippet, ""

    # Anything else — failure
    logger.warning(
        "SF REST push failed | HTTP=%d | lead_id=%s | response=%s",
        resp.status_code, lead.get("id"), snippet,
    )
    return False, resp.status_code, snippet, f"Salesforce returned HTTP {resp.status_code}"


# ── Web-to-Lead fallback ───────────────────────────────────────────────────────

def _build_web_to_lead_payload(lead: Dict) -> dict:
    """Build Web-to-Lead form payload (fallback when REST creds are absent)."""
    gender_identity = _normalise_gender_identity(lead.get("gender_identity", ""))
    physician_name  = lead.get("physician_name", "")
    npi             = lead.get("npi", "")
    npi_number      = lead.get("npi_number") or npi
    specialization  = lead.get("specialization", "")
    nct_id          = lead.get("nct_id", "")
    site            = lead.get("site", "")
    message         = lead.get("message", "")
    ctx             = lead.get("search_context", {})

    desc_parts = ["Clinical Trial Navigator Lead"]
    if physician_name:  desc_parts.append(f"Physician: {physician_name}")
    if npi:             desc_parts.append(f"NPI: {npi}")
    if npi_number:      desc_parts.append(f"NPI Number: {npi_number}")
    if specialization:  desc_parts.append(f"Specialization: {specialization}")
    if gender_identity: desc_parts.append(f"Gender Identity: {gender_identity}")
    if nct_id:          desc_parts.append(f"Trial: {nct_id}")
    if site:            desc_parts.append(f"Site: {site}")
    if message:         desc_parts.append(f"Message: {message}")
    if ctx.get("address"):      desc_parts.append(f"Location: {ctx['address']}")
    if ctx.get("descriptions"): desc_parts.append(f"Specialty: {', '.join(ctx['descriptions'])}")
    if ctx.get("total_results"): desc_parts.append(f"Results: {ctx['total_results']}")

    return {
        "oid":        cfg.SF_OID,
        "retURL":     cfg.SF_RET_URL or "https://www.aquarient.com",
        "first_name": sanitise(lead.get("first_name", ""), 80),
        "last_name":  sanitise(lead.get("last_name", "Unknown"), 80),
        "email":      sanitise(lead.get("email", ""), 254),
        "phone":      sanitise(lead.get("phone", ""), 40),
        "company":    sanitise(lead.get("company") or "Individual Physicians", 120),
        "title":      sanitise(lead.get("title", ""), 80),
        "lead_source": sanitise(lead.get("lead_source", "Clinical Trial"), 40),
        "description": sanitise(" | ".join(desc_parts), 2000),
    }


def _push_via_web_to_lead(lead: Dict) -> Tuple[bool, int, str, str]:
    """Push lead via Web-to-Lead form (fallback only)."""
    global _last_sf_payload

    if not cfg.SF_OID:
        msg = "SF_OID not set — Web-to-Lead fallback also unavailable"
        logger.warning(msg)
        return False, 0, "", msg

    email = lead.get("email", "")
    if _is_invalid_email(email):
        logger.info(
            "Skipping Web-to-Lead push for lead %s — invalid email '%s'",
            lead.get("id"), email,
        )
        return True, 0, "", ""

    sf_payload = _build_web_to_lead_payload(lead)
    _last_sf_payload = copy.deepcopy(sf_payload)

    logger.info("SF Web-to-Lead push | OID=%s | email=%s", cfg.SF_OID, email)

    try:
        resp = http_client.post(
            cfg.SF_WEB_TO_LEAD_URL,
            data=sf_payload,
            timeout=cfg.REQUEST_TIMEOUT,
            allow_redirects=True,
        )
        snippet    = (resp.text or "")[:500]
        body_lower = snippet.lower()
        has_error  = (
            "error"          in body_lower
            and "debugemail" not in body_lower
            and "successfully" not in body_lower
        )
        if has_error:
            logger.warning("Web-to-Lead response suggests failure: %.300s", snippet)

        success = resp.status_code in (200, 301, 302) and not has_error
        logger.info("SF Web-to-Lead HTTP %d | success=%s", resp.status_code, success)
        return success, resp.status_code, snippet, ""

    except requests.Timeout:
        msg = f"Web-to-Lead request timed out after {cfg.REQUEST_TIMEOUT}s"
        logger.error(msg)
        return False, 0, "", msg
    except Exception as ex:
        msg = f"{type(ex).__name__}: {ex}"
        logger.error("Web-to-Lead push exception: %s", msg)
        return False, 0, "", msg


# ── Main entry point ───────────────────────────────────────────────────────────

def push_to_salesforce(lead: Dict) -> Tuple[bool, int, str, str]:
    """
    Push a lead to Salesforce.

    Routing logic:
      - If SF_CLIENT_ID is set → use REST API  (GenderIdentity works correctly)
      - Otherwise              → fall back to Web-to-Lead (GenderIdentity in description only)

    Args:
        lead: Lead dict as built by api/leads.py

    Returns:
        Tuple of (success, http_status, response_snippet, error_message)
    """
    if cfg.SF_CLIENT_ID:
        logger.info(
            "SF push via REST API | lead_id=%s | email=%s",
            lead.get("id"), lead.get("email", ""),
        )
        return _push_via_rest_api(lead)

    # Fallback — REST credentials not configured
    logger.info(
        "SF_CLIENT_ID not set — falling back to Web-to-Lead | lead_id=%s",
        lead.get("id"),
    )
    return _push_via_web_to_lead(lead)


def push_lead(lead: Dict) -> None:
    """
    Convenience wrapper — raises RuntimeError on failure.
    Called by api/leads.py _push_to_salesforce().
    """
    success, status, snippet, err = push_to_salesforce(lead)
    if not success:
        raise RuntimeError(
            f"Salesforce push failed (HTTP {status}): {err or snippet[:200]}"
        )
