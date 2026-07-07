"""
services/salesforce_rest_api.py — Salesforce REST API Lead Integration
=======================================================================

PURPOSE
-------
This is a REPLACEMENT for the current Web-to-Lead approach in salesforce.py.
Instead of posting to Salesforce's Web-to-Lead HTML form endpoint (which
silently drops unknown fields like GenderIdentity), this module uses the
Salesforce REST API with OAuth2 authentication to create Lead records directly.

WHY THIS FIXES THE GENDER IDENTITY ISSUE
-----------------------------------------
Web-to-Lead only accepts fields that are mapped via a generated form in
Salesforce Setup. Any field key not in that mapping is silently ignored.

The REST API uses actual Salesforce API field names (e.g. "GenderIdentity",
"NPI_Number__c") directly in a JSON payload — no form ID mapping needed.
Every field you send lands exactly where you intend.

FIELDS SENT TO SALESFORCE
--------------------------
Standard Salesforce Lead fields:
  FirstName         → Lead first name
  LastName          → Lead last name
  Email             → Lead email
  Phone             → Lead phone
  Company           → Lead company / organisation
  Title             → Lead title (used for specialization text)
  LeadSource        → Always "Clinical Trial"
  Description       → Full context summary (physician, NPI, trial, site, etc.)
  GenderIdentity    → Picklist: Male | Female | Nonbinary | Not Listed

Custom fields (must exist in Salesforce as custom fields — see setup guide):
  NPI_Number__c     → Physician NPI number
  Specialization__c → Physician specialization / taxonomy

AUTHENTICATION
--------------
Uses OAuth2 Username-Password flow (simplest for server-to-server).
Requires a Connected App in Salesforce with OAuth enabled.

Required environment variables (add to .env):
  SF_CLIENT_ID       — Connected App Consumer Key
  SF_CLIENT_SECRET   — Connected App Consumer Secret
  SF_USERNAME        — Salesforce login username (API user)
  SF_PASSWORD        — Salesforce password + security token appended
                       e.g. if password is "MyPass" and token is "ABC123"
                       then SF_PASSWORD = "MyPassABC123"
  SF_INSTANCE_URL    — Your Salesforce org URL
                       e.g. https://yourcompany.salesforce.com
                       or   https://yourcompany.my.salesforce.com

Optional:
  SF_API_VERSION     — Salesforce API version (default: "59.0")

HOW TO INTEGRATE (when approved)
---------------------------------
1. In backend/core/config.py — add the 5 new env vars (shown in section below)
2. In backend/services/salesforce.py — replace push_to_salesforce() to call
   push_lead_via_rest_api() from this file instead of the Web-to-Lead POST
3. In backend/.env — add the 5 new credential values
4. Remove old Web-to-Lead env vars: SF_OID, SF_WEB_TO_LEAD_URL (optional, can keep)

DOES NOT TOUCH
--------------
  - frontend/ (zero changes)
  - backend/api/leads.py (zero changes)
  - backend/core/config.py (only additions, no removals)
  - All other services
"""

import logging
import copy
import re
from typing import Dict, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Salesforce OAuth2 token endpoint (same for all orgs)
SF_TOKEN_URL = "https://login.salesforce.com/services/oauth2/token"

# Salesforce API version to use
DEFAULT_API_VERSION = "59.0"

# GenderIdentity picklist — exact values as configured in Salesforce
# (must match Setup → Object Manager → Lead → Fields → GenderIdentity → Values)
GENDER_PICKLIST_VALUES = {"Male", "Female", "Nonbinary", "Not Listed"}

# Regex for basic email validation
_EMAIL_REGEX = re.compile(
    r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$'
)

# ---------------------------------------------------------------------------
# In-memory cache for the OAuth access token
# Avoids fetching a new token on every lead push.
# Token is re-fetched automatically when it expires or is invalid.
# ---------------------------------------------------------------------------
_token_cache: dict = {
    "access_token": None,
    "instance_url": None,
}

# Stores last REST API payload for debug endpoint inspection
_last_rest_payload: Optional[dict] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_last_rest_payload() -> Optional[dict]:
    """Return the last REST API payload sent (or None). Used by debug endpoint."""
    return _last_rest_payload


def _normalise_gender_identity(value: str) -> str:
    """
    Normalise raw gender string to a value that matches the
    Salesforce GenderIdentity picklist exactly.

    Picklist values: Male | Female | Nonbinary | Not Listed

    NPPES returns: "M", "F", "U" (unknown)
    User may type: "male", "FEMALE", "non-binary", etc.
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
    # Unknown / not listed / anything unrecognised → "Not Listed"
    # NOTE: Previous Web-to-Lead code returned "Unknown" here which is NOT
    # in the picklist — that was silently dropped by Salesforce.
    if normalized in ("u", "unknown", "unk", "not listed", "other"):
        return "Not Listed"

    # Attempt title-case match for anything else
    title_cased = " ".join(part.capitalize() for part in raw.split())
    if title_cased in GENDER_PICKLIST_VALUES:
        return title_cased

    # Cannot map — return empty so field is left blank rather than wrong value
    logger.warning("Unrecognised gender value '%s' — leaving GenderIdentity blank", raw)
    return ""


def _is_invalid_email(email: str) -> bool:
    """Return True if email is present but malformed. Blank email is allowed."""
    lower = email.strip().lower()
    if not lower:
        return False
    return not bool(_EMAIL_REGEX.match(lower))


def _sanitise(value: str, max_len: int = 255) -> str:
    """
    Basic sanitisation: strip HTML tags, control characters, and trim length.
    Mirrors core/helpers.py sanitise() so this file stays self-contained
    for review purposes. When integrated, use sanitise() from core.helpers.
    """
    import html as _html
    import re as _re
    if not isinstance(value, str):
        value = str(value)
    value = _re.sub(r"<[^>]+>", "", value)        # strip HTML tags
    value = _html.unescape(value)                  # decode HTML entities
    value = _re.sub(r"[\x00-\x1f\x7f]", "", value) # strip control chars
    return value.strip()[:max_len]


# ---------------------------------------------------------------------------
# OAuth2 — get access token
# ---------------------------------------------------------------------------

def _get_access_token(
    client_id: str,
    client_secret: str,
    username: str,
    password: str,
) -> Tuple[str, str]:
    """
    Obtain a Salesforce OAuth2 access token using the Username-Password flow.

    Args:
        client_id     : Connected App Consumer Key
        client_secret : Connected App Consumer Secret
        username      : Salesforce API user email / login
        password      : Salesforce password + security token (concatenated)

    Returns:
        Tuple of (access_token, instance_url)

    Raises:
        RuntimeError if authentication fails.
    """
    # Return cached token if available
    if _token_cache["access_token"] and _token_cache["instance_url"]:
        logger.debug("Using cached Salesforce access token")
        return _token_cache["access_token"], _token_cache["instance_url"]

    logger.info("Fetching new Salesforce OAuth2 access token")

    payload = {
        "grant_type":    "password",
        "client_id":     client_id,
        "client_secret": client_secret,
        "username":      username,
        "password":      password,
    }

    try:
        resp = requests.post(SF_TOKEN_URL, data=payload, timeout=15)
    except requests.Timeout:
        raise RuntimeError("Salesforce OAuth2 token request timed out after 15s")
    except Exception as ex:
        raise RuntimeError(f"Salesforce OAuth2 request failed: {ex}") from ex

    if resp.status_code != 200:
        # Avoid logging full response in case it contains sensitive info
        raise RuntimeError(
            f"Salesforce OAuth2 failed with HTTP {resp.status_code}. "
            f"Check SF_CLIENT_ID, SF_CLIENT_SECRET, SF_USERNAME, SF_PASSWORD."
        )

    data = resp.json()

    if "access_token" not in data:
        raise RuntimeError(
            f"Salesforce OAuth2 response missing access_token. "
            f"Error: {data.get('error')} — {data.get('error_description')}"
        )

    access_token = data["access_token"]
    instance_url = data.get("instance_url", "")

    # Cache for subsequent calls
    _token_cache["access_token"] = access_token
    _token_cache["instance_url"] = instance_url

    logger.info("Salesforce OAuth2 token obtained | instance_url=%s", instance_url)
    return access_token, instance_url


def _invalidate_token_cache() -> None:
    """Clear the cached token (called on 401 so next call re-authenticates)."""
    _token_cache["access_token"] = None
    _token_cache["instance_url"] = None


# ---------------------------------------------------------------------------
# Payload builder
# ---------------------------------------------------------------------------

def _build_rest_payload(lead: Dict) -> dict:
    """
    Build a Salesforce Lead JSON payload using real API field names.

    This is the core fix vs Web-to-Lead:
    - Web-to-Lead: needs obscure generated field IDs for custom/non-standard fields
    - REST API: uses the actual API field names directly, no mapping required

    Field name reference:
    ┌─────────────────────┬──────────────────────────────────────────────────┐
    │ API Field Name      │ Notes                                            │
    ├─────────────────────┼──────────────────────────────────────────────────┤
    │ FirstName           │ Standard — Lead first name                       │
    │ LastName            │ Standard — Lead last name (required)             │
    │ Email               │ Standard — Lead email                            │
    │ Phone               │ Standard — Lead phone                            │
    │ Company             │ Standard — Lead company (required)               │
    │ Title               │ Standard — Used for specialization label         │
    │ LeadSource          │ Standard — Always "Clinical Trial"               │
    │ Description         │ Standard — Full context text                     │
    │ GenderIdentity      │ Standard picklist — Male/Female/Nonbinary/Not    │
    │                     │ Listed  ← THIS IS THE FIELD THAT WAS BROKEN      │
    │ NPI_Number__c       │ Custom — Physician NPI (must exist in SF org)    │
    │ Specialization__c   │ Custom — Physician specialty (must exist in SF)  │
    └─────────────────────┴──────────────────────────────────────────────────┘
    """
    physician_name = lead.get("physician_name", "")
    npi            = lead.get("npi", "")
    npi_number     = lead.get("npi_number") or npi
    specialization = lead.get("specialization", "")
    gender_identity = _normalise_gender_identity(lead.get("gender_identity", ""))
    nct_id         = lead.get("nct_id", "")
    site           = lead.get("site", "")
    message        = lead.get("message", "")
    ctx            = lead.get("search_context", {})

    # Build description text — same structure as current Web-to-Lead
    desc_parts = ["Clinical Trial Navigator Lead"]
    if physician_name:
        desc_parts.append(f"Physician: {physician_name}")
    if npi:
        desc_parts.append(f"NPI: {npi}")
    if npi_number:
        desc_parts.append(f"NPI Number: {npi_number}")
    if specialization:
        desc_parts.append(f"Specialization: {specialization}")
    if gender_identity:
        desc_parts.append(f"Gender Identity: {gender_identity}")
    if nct_id:
        desc_parts.append(f"Trial: {nct_id}")
    if site:
        desc_parts.append(f"Site: {site}")
    if message:
        desc_parts.append(f"Message: {message}")
    if ctx.get("address"):
        desc_parts.append(f"Location: {ctx['address']}")
    if ctx.get("descriptions"):
        desc_parts.append(f"Specialty: {', '.join(ctx['descriptions'])}")

    # Core payload — standard Salesforce Lead fields
    payload: dict = {
        "FirstName":   _sanitise(lead.get("first_name", ""), 80),
        "LastName":    _sanitise(lead.get("last_name") or "Unknown", 80),
        "Email":       _sanitise(lead.get("email", ""), 254),
        "Phone":       _sanitise(lead.get("phone", ""), 40),
        "Company":     _sanitise(lead.get("company") or "Individual Physicians", 255),
        "Title":       _sanitise(lead.get("title", ""), 128),
        "LeadSource":  _sanitise(lead.get("lead_source", "Clinical Trial"), 40),
        "Description": _sanitise(" | ".join(desc_parts), 32000),
    }

    # GenderIdentity — standard picklist on Lead object
    # With REST API this just works — no field ID needed, no form mapping needed
    if gender_identity:
        payload["GenderIdentity"] = gender_identity

    # Custom fields — must exist in Salesforce org (see setup guide below)
    if npi_number:
        payload["NPI_Number__c"] = _sanitise(npi_number, 20)

    if specialization:
        payload["Specialization__c"] = _sanitise(specialization, 255)

    # Remove empty string values — Salesforce REST API prefers omission over ""
    # for optional fields to avoid validation errors on required picklists
    payload = {k: v for k, v in payload.items() if v != ""}

    return payload


# ---------------------------------------------------------------------------
# Main push function
# ---------------------------------------------------------------------------

def push_lead_via_rest_api(
    lead: Dict,
    client_id: str,
    client_secret: str,
    username: str,
    password: str,
    instance_url: str,
    api_version: str = DEFAULT_API_VERSION,
) -> Tuple[bool, int, str, str]:
    """
    Push a lead to Salesforce via the REST API.

    This is a DROP-IN REPLACEMENT for push_to_salesforce() in salesforce.py.
    Same return signature: Tuple[success, http_status, response_snippet, error_msg]

    Args:
        lead          : Lead dict as built by api/leads.py
        client_id     : SF Connected App Consumer Key  (from env SF_CLIENT_ID)
        client_secret : SF Connected App Consumer Secret (from env SF_CLIENT_SECRET)
        username      : SF API user login               (from env SF_USERNAME)
        password      : SF password + security token    (from env SF_PASSWORD)
        instance_url  : SF org URL                      (from env SF_INSTANCE_URL)
        api_version   : Salesforce API version          (from env SF_API_VERSION, default "59.0")

    Returns:
        Tuple of (success: bool, http_status: int, response_snippet: str, error_msg: str)
    """
    global _last_rest_payload

    email = lead.get("email", "")

    # Skip leads with malformed emails
    if _is_invalid_email(email):
        msg = (
            f"Skipping SF REST push for lead {lead.get('id')} — "
            f"invalid email '{email}'"
        )
        logger.info(msg)
        return True, 0, "", ""

    # Build the JSON payload
    payload = _build_rest_payload(lead)
    _last_rest_payload = copy.deepcopy(payload)

    logger.info(
        "SF REST payload | lead_id=%s | fields=%s | GenderIdentity=%s | NPI_Number__c=%s",
        lead.get("id"),
        list(payload.keys()),
        payload.get("GenderIdentity", "<not set>"),
        payload.get("NPI_Number__c", "<not set>"),
    )

    # Step 1 — Get OAuth access token
    try:
        access_token, resolved_instance_url = _get_access_token(
            client_id, client_secret, username, password
        )
        # Use env instance_url as override if provided, otherwise use token response value
        base_url = instance_url.rstrip("/") or resolved_instance_url.rstrip("/")
    except RuntimeError as ex:
        logger.error("SF REST auth failed: %s", ex)
        return False, 0, "", str(ex)

    # Step 2 — POST to Salesforce Lead object endpoint
    leads_endpoint = f"{base_url}/services/data/v{api_version}/sobjects/Lead/"

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type":  "application/json",
    }

    try:
        resp = requests.post(
            leads_endpoint,
            json=payload,
            headers=headers,
            timeout=25,
        )
    except requests.Timeout:
        msg = "SF REST API request timed out after 25s"
        logger.error(msg)
        return False, 0, "", msg
    except Exception as ex:
        msg = f"SF REST request exception: {type(ex).__name__}: {ex}"
        logger.error(msg)
        return False, 0, "", msg

    snippet = (resp.text or "")[:500]

    # Handle 401 — token expired, clear cache so next call re-authenticates
    if resp.status_code == 401:
        logger.warning("SF REST 401 — invalidating token cache for retry")
        _invalidate_token_cache()
        return False, 401, snippet, "Salesforce token expired — will retry on next request"

    # 201 = Created (success for POST to sobjects)
    if resp.status_code == 201:
        response_data = resp.json()
        sf_lead_id = response_data.get("id", "unknown")
        logger.info(
            "SF REST lead created | sf_id=%s | lead_id=%s | email=%s",
            sf_lead_id, lead.get("id"), email,
        )
        return True, 201, snippet, ""

    # Any other status = failure
    logger.warning(
        "SF REST push failed | HTTP=%d | lead_id=%s | response=%s",
        resp.status_code, lead.get("id"), snippet,
    )
    return False, resp.status_code, snippet, f"Salesforce returned HTTP {resp.status_code}"


# ---------------------------------------------------------------------------
# Convenience wrapper — reads credentials from config
# Same signature as the current push_to_salesforce() for easy drop-in swap
# ---------------------------------------------------------------------------

def push_to_salesforce_rest(lead: Dict) -> Tuple[bool, int, str, str]:
    """
    Convenience wrapper that reads credentials from cfg and calls
    push_lead_via_rest_api().

    To integrate: in salesforce.py, replace the call to push_to_salesforce()
    with push_to_salesforce_rest() from this module.
    """
    try:
        from core.config import cfg
    except ModuleNotFoundError:
        from backend.core.config import cfg

    # Validate all required credentials are present
    missing = [
        name for name, val in [
            ("SF_CLIENT_ID",    cfg.SF_CLIENT_ID),
            ("SF_CLIENT_SECRET", cfg.SF_CLIENT_SECRET),
            ("SF_USERNAME",     cfg.SF_USERNAME),
            ("SF_PASSWORD",     cfg.SF_PASSWORD),
            ("SF_INSTANCE_URL", cfg.SF_INSTANCE_URL),
        ]
        if not val
    ]

    if missing:
        msg = f"Salesforce REST API credentials not configured: {', '.join(missing)}"
        logger.warning(msg)
        return False, 0, "", msg

    return push_lead_via_rest_api(
        lead         = lead,
        client_id    = cfg.SF_CLIENT_ID,
        client_secret= cfg.SF_CLIENT_SECRET,
        username     = cfg.SF_USERNAME,
        password     = cfg.SF_PASSWORD,
        instance_url = cfg.SF_INSTANCE_URL,
        api_version  = getattr(cfg, "SF_API_VERSION", DEFAULT_API_VERSION),
    )
