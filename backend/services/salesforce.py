"""
services/salesforce.py — Salesforce Lead Integration
=====================================================
Pushes leads to Salesforce Web-to-Lead endpoint.

Fields sent:
  first_name, last_name, email, phone, company, title,
  lead_source ("Clinical Trial"), description (physician + trial context)
"""

import logging
import re
import copy
from typing import Dict, Tuple, Optional

import requests

from core.config import cfg
from core.helpers import sanitise
from services.http_client import http_client

logger = logging.getLogger(__name__)

_EMAIL_REGEX = re.compile(
    r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$'
)


def _normalise_gender_identity(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""

    normalized = raw.lower()
    if normalized in ("m", "male"):
        return "Male"
    if normalized in ("f", "female"):
        return "Female"
    if normalized in ("u", "unknown", "unk"):
        return "Unknown"

    # Title-case common multi-word values for Salesforce picklists.
    return " ".join(part.capitalize() for part in raw.split())


# Stores the last SF payload posted (for debug endpoint inspection)
_last_sf_payload: Optional[dict] = None


def get_last_payload() -> Optional[dict]:
    """Return the last Salesforce payload sent by the server (or None)."""
    return _last_sf_payload


def _add_custom_field(payload: dict, value: str, custom_field: str, default_names: list[str]) -> None:
    if not value:
        return

    if custom_field:
        payload[custom_field] = sanitise(value, 80)
        return

    for field_name in default_names:
        payload[field_name] = sanitise(value, 80)



def _is_invalid_email(email: str) -> bool:
    """Return True if email is empty or doesn't match a valid email pattern."""
    lower = email.strip().lower()
    if not lower:
        return True
    return not bool(_EMAIL_REGEX.match(lower))


def push_lead(lead: Dict) -> None:
    """
    Push a lead dict (as produced by api/leads.py) to Salesforce Web-to-Lead.
    Called by _push_to_salesforce() in api/leads.py.
    Raises on failure so the caller can log a warning.
    """
    success, status, snippet, err = push_to_salesforce(lead)
    if not success:
        raise RuntimeError(
            f"Salesforce push failed (HTTP {status}): {err or snippet[:200]}"
        )


def push_to_salesforce(lead: Dict) -> Tuple[bool, int, str, str]:
    """
    Push lead to Salesforce Web-to-Lead form.

    Args:
        lead: Lead data dict (as saved to leads.json by api/leads.py)

    Returns:
        Tuple of (success, http_status, response_snippet, error_message)
    """
    if not cfg.SF_OID:
        msg = "SF_OID not set — cannot push to Salesforce"
        logger.warning(msg)
        return False, 0, "", msg

    email = lead.get("email", "")

    # Skip leads with invalid or malformed email addresses —
    # Salesforce will silently drop or reject them.
    if _is_invalid_email(email):
        msg = (
            f"Skipping Salesforce push for lead {lead.get('id')} — "
            f"invalid email '{email}' does not match a valid email pattern."
        )
        logger.info(msg)
        return True, 0, "", ""   # return success=True so caller doesn't log a warning

    # Build description from all available context
    physician_name = lead.get("physician_name", "")
    npi            = lead.get("npi", "")
    npi_number     = lead.get("npi_number") or npi
    specialization = lead.get("specialization", "")
    gender_identity = _normalise_gender_identity(lead.get("gender_identity", ""))
    nct_id         = lead.get("nct_id", "")
    site           = lead.get("site", "")
    message        = lead.get("message", "")
    ctx            = lead.get("search_context", {})

    desc_parts = ["Clinical Trial Navigator Lead"]
    if physician_name:          desc_parts.append(f"Physician: {physician_name}")
    if npi:                     desc_parts.append(f"NPI: {npi}")
    if npi_number:              desc_parts.append(f"NPI Number: {npi_number}")
    if specialization:          desc_parts.append(f"Specialization: {specialization}")
    if gender_identity:         desc_parts.append(f"Gender Identity: {gender_identity}")
    if nct_id:                  desc_parts.append(f"Trial: {nct_id}")
    if site:                    desc_parts.append(f"Site: {site}")
    if message:                 desc_parts.append(f"Message: {message}")
    if ctx.get("address"):      desc_parts.append(f"Location: {ctx['address']}")
    if ctx.get("descriptions"): desc_parts.append(f"Specialty: {', '.join(ctx['descriptions'])}")
    if ctx.get("total_results"):desc_parts.append(f"Results: {ctx['total_results']}")

    sf_payload = {
        "oid":         cfg.SF_OID,
        "retURL":      cfg.SF_RET_URL or "https://www.aquarient.com",
        "first_name":  sanitise(lead.get("first_name", ""),                  80),
        "last_name":   sanitise(lead.get("last_name",  "Unknown"),            80),
        "email":       sanitise(email,                                       254),
        "phone":       sanitise(lead.get("phone",      ""),                   40),
        "company":     sanitise(lead.get("company")    or "Individual Physicians", 120),
        "title":       sanitise(lead.get("title",      ""),                   80),
        "lead_source": sanitise(lead.get("lead_source","Clinical Trial"),     40),
        "description": sanitise(" | ".join(desc_parts),                     2000),
    }

    _add_custom_field(
        sf_payload,
        specialization,
        cfg.SF_SPECIALIZATION_FIELD,
        ["Specialization__c", "Specialty__c", "Specialization"],
    )
    # Send only the single standard field name `GenderIdentity` as requested.
    _add_custom_field(
        sf_payload,
        gender_identity,
        cfg.SF_GENDER_IDENTITY_FIELD or cfg.SF_GENDER_FIELD,
        ["GenderIdentity"],
    )
    _add_custom_field(
        sf_payload,
        npi_number,
        cfg.SF_NPI_FIELD,
        ["NPI_Number__c", "NPI_Number", "NPI__c"],
    )

    # Helpful debug logging: show which keys we're sending and the
    # critical custom fields so we can verify Salesforce receives them.
    try:
        logger.info("SF payload keys: %s", list(sf_payload.keys()))
        logger.info(
            "SF payload sample: %s",
            {
                k: sf_payload.get(k) for k in (
                    "Specialization__c", "Specialty__c", "Specialization",
                    "GenderIdentity", "GenderIdentity__c", "Gender_Identity__c", "Gender",
                    "NPI_Number__c", "NPI_Number", "NPI__c",
                )
                if k in sf_payload
            },
        )
    except Exception:
        logger.exception("Failed to log SF payload debug info")

    if cfg.SF_DEBUG_EMAIL:
        sf_payload["debug"]      = "1"
        sf_payload["debugEmail"] = cfg.SF_DEBUG_EMAIL

    logger.info(
        "Pushing to SF | OID=%s | email=%s | auto=%s",
        cfg.SF_OID, email, lead.get("auto"),
    )

    # Save the payload copy for debugging/inspection before sending.
    try:
        global _last_sf_payload
        _last_sf_payload = copy.deepcopy(sf_payload)

        resp = http_client.post(
            "https://webto.salesforce.com/servlet/servlet.WebToLead?encoding=UTF-8",
            data=sf_payload,
            timeout=cfg.REQUEST_TIMEOUT,
            allow_redirects=True,
        )
        snippet    = (resp.text or "")[:500]
        body_lower = snippet.lower()
        has_error  = (
            "error"            in body_lower
            and "debugEmail"   not in snippet
            and "successfully" not in body_lower
        )
        if has_error:
            logger.warning("SF response suggests failure: %.300s", snippet)

        success = resp.status_code in (200, 301, 302) and not has_error
        logger.info(
            "SF HTTP %d | success=%s | email=%s",
            resp.status_code, success, email,
        )
        return success, resp.status_code, snippet, ""

    except requests.Timeout:
        msg = f"SF request timed out after {cfg.REQUEST_TIMEOUT}s"
        logger.error(msg)
        return False, 0, "", msg

    except Exception as ex:
        msg = f"{type(ex).__name__}: {ex}"
        logger.error("SF push exception: %s", msg)
        return False, 0, "", msg