"""
NPPES (National Provider Enumeration System) service.
Fetches physician data from the CMS NPPES registry.

Fix v2.1.2:
  - batch_geocode_for_display() now sets p["_geocoded"] = True only when
    address-level coordinates are successfully obtained from Geoapify.
    When geocoding fails, the flag is explicitly set to False so callers
    can distinguish "has address coords" from "fell back to ZIP centroid".
  - geocode_address() no longer stores the ZIP centroid fallback in the
    LRU cache — caching a centroid under an address key would prevent a
    future successful geocode of the same address after a transient error.
  - No changes to fetch(), fetch_with_retry(), or apply_coord_jitter().

Fix v2.1.3:
  - parse_physician() now calls _clean_display_name() to strip NPI registry
    artifacts (leading/trailing dashes, honorific prefixes like Dr./Mr.) from
    the assembled name before returning. Credentials (M.D., MD, etc.) are
    preserved because they are appended separately from the NPPES credential
    field and carry clinical meaning in the UI.
"""

import logging
import re
import time
from typing import Dict, List, Optional, Tuple

from requests import Timeout  # For exception handling

from core.config import cfg
from core.helpers import LRUCache
from services.http_client import http_client


logger = logging.getLogger(__name__)

NPPES_BASE_URL = "https://npiregistry.cms.hhs.gov/api/"

# Cache for geocoded addresses — only stores successful address-level results.
_addr_cache = LRUCache(cfg.GEOCODE_CACHE_SIZE)


# ── Display-name cleaning ─────────────────────────────────────────────────────

def _clean_display_name(raw: str) -> str:
    """
    Strip NPI registry artifacts from an assembled physician name.

    Handles:
      - Leading/trailing dash sequences  e.g. "-- WILLIAM BURTON DAVIS --"
      - Honorific prefixes               e.g. "Dr.", "Mr.", "Mrs.", "Prof."
      - Isolated dashes that are not     part of a hyphenated name
      - Excess whitespace

    Credentials (M.D., MD, etc.) are NOT removed here — they are appended
    separately in parse_physician() from the NPPES credential field.
    """
    name = raw

    # Remove -- artifacts like "-- WILLIAM --" or "--ALAN--"
    name = re.sub(r'\s*--+\s*', ' ', name)

    # Remove honorific titles (Dr., Mr., Mrs., Ms., Prof.)
    name = re.sub(
        r'\b(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?)\b',
        '',
        name,
        flags=re.IGNORECASE,
    )

    # Remove isolated dashes that are NOT part of a hyphenated name
    # e.g. "DAVIS -," → "DAVIS ," but keeps "Jean-Pierre"
    name = re.sub(r'(?<!\w)-(?!\w)', ' ', name)

    # Collapse multiple spaces and strip
    return " ".join(name.split()).strip()


# ── NPPES fetch helpers ───────────────────────────────────────────────────────

def fetch(params: Dict) -> Tuple[List, int]:
    """
    Fetch physician data from NPPES registry.

    Args:
        params: Query parameters (postal_code, taxonomy_description, etc.)

    Returns:
        Tuple of (results list, total count)
    """
    clean = {k: str(v).strip() for k, v in params.items() if v and str(v).strip()}
    query = {
        "version": "2.1",
        "enumeration_type": "NPI-1",
        "limit": 200,
        "skip": 0,
        "country_code": "US",
        **clean,
    }
    try:
        resp = http_client.get(NPPES_BASE_URL, params=query, timeout=cfg.REQUEST_TIMEOUT)
        resp.raise_for_status()
        d = resp.json()
        return d.get("results") or [], int(d.get("result_count") or 0)
    except Timeout:
        logger.warning("NPPES timeout | params=%s", clean)
        return [], 0
    except Exception as e:
        logger.warning("NPPES fetch failed: %s | params=%s", e, clean)
        return [], 0


def fetch_with_retry(params: Dict, retries: int = 2) -> Tuple[List, int]:
    """
    Fetch from NPPES with retry logic for transient failures.

    Args:
        params: Query parameters
        retries: Number of retry attempts

    Returns:
        Tuple of (results list, total count)
    """
    delay = 0.5
    for attempt in range(retries + 1):
        rows, total = fetch(params)
        if rows or attempt == retries:
            return rows, total
        time.sleep(delay)
        delay *= 2
    return [], 0


def parse_physician(result: Dict) -> Optional[Dict]:
    """
    Parse physician data from NPPES result.

    Args:
        result: Raw NPPES result dict

    Returns:
        Processed physician dict or None
    """
    basic      = result.get("basic", {})
    addresses  = result.get("addresses", [])
    taxonomies = result.get("taxonomies", [])

    addr = next(
        (a for a in addresses if a.get("address_purpose") == "LOCATION"),
        addresses[0] if addresses else {},
    )
    primary_tax = next(
        (t for t in taxonomies if t.get("primary")),
        taxonomies[0] if taxonomies else {},
    )

    prefix = str(basic.get("name_prefix") or "").strip()
    first  = str(basic.get("first_name")  or "").strip()
    middle = str(basic.get("middle_name") or "").strip()
    last   = str(basic.get("last_name")   or "").strip()
    suffix = str(basic.get("name_suffix") or "").strip()
    cred   = str(basic.get("credential")  or "").strip()

    # Assemble raw name from NPPES parts, then strip registry artifacts
    # (dashes, honorifics) before presenting to the UI.
    name_parts = [prefix, first, middle, last, suffix]
    raw_name   = " ".join([p for p in name_parts if p]).strip() or "Unknown Provider"
    name       = _clean_display_name(raw_name)

    # Re-attach credential (M.D., MD, etc.) — kept intentionally for display.
    if cred:
        name += f", {cred}"

    addr1    = str(addr.get("address_1")        or "")
    addr2    = str(addr.get("address_2")        or "")
    city     = str(addr.get("city")             or "")
    state    = str(addr.get("state")            or "")
    zipcode  = str(addr.get("postal_code")      or "")[:5]
    phone    = str(addr.get("telephone_number") or "")

    full_address = ", ".join(p for p in [addr1, addr2, city, state, zipcode] if p)
    all_tax = [
        {"code": str(t.get("code") or ""), "desc": str(t.get("desc") or "")}
        for t in taxonomies
    ]

    return {
        "npi":           str(result.get("number") or ""),
        "name":          name,
        "taxonomy_code": str(primary_tax.get("code") or ""),
        "taxonomy_desc": str(primary_tax.get("desc") or ""),
        "all_taxonomies": all_tax,
        "address":       full_address,
        "address_1":     addr1,
        "city":          city,
        "state":         state,
        "zip":           zipcode,
        "phone":         phone,
        "lat":           None,
        "lng":           None,
        "distance_miles": None,
        # _geocoded is set by batch_geocode_for_display(); False here means
        # "only ZIP centroid coords assigned so far" (set in app.py).
        "_geocoded":     False,
    }


# ── Geocoding ─────────────────────────────────────────────────────────────────

def geocode_address(
    addr1:   str,
    city:    str,
    state:   str,
    zipcode: str,
) -> Tuple[Optional[float], Optional[float], bool]:
    """
    Geocode an address to coordinates using Geoapify API.
    Successful results are cached to avoid repeated requests.

    Args:
        addr1:   Street address
        city:    City name
        state:   State code
        zipcode: ZIP code

    Returns:
        Tuple of (latitude, longitude, is_address_level).
        is_address_level is True only when Geoapify returned a result —
        False means we fell back to the ZIP centroid or got nothing.
    """
    from services import zip_database

    key = (
        f"{addr1.lower().strip()},"
        f"{city.lower().strip()},"
        f"{state.upper().strip()},"
        f"{zipcode[:5]}"
    )
    cached = _addr_cache.get(key)
    if cached is not None:
        # Cache only holds address-level successes
        return cached[0], cached[1], True

    if cfg.GEOAPIFY_API_KEY:
        query = ", ".join(p for p in [addr1, city, state, zipcode[:5], "US"] if p.strip())
        try:
            resp = http_client.get(
                "https://api.geoapify.com/v1/geocode/search",
                params={
                    "text":   query,
                    "limit":  1,
                    "filter": "countrycode:us",
                    "apiKey": cfg.GEOAPIFY_API_KEY,
                },
                timeout=cfg.REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
            features = resp.json().get("features", [])
            if features:
                coords = features[0]["geometry"]["coordinates"]
                lat, lng = coords[1], coords[0]
                # Only cache successful address-level geocodes.
                # Do NOT cache ZIP centroid fallbacks — a future retry
                # should be allowed to get the real address coordinates.
                _addr_cache.set(key, (lat, lng))
                return lat, lng, True
        except Exception as e:
            logger.debug("Addr geocode failed '%s': %s", query, e)

    # Fallback to ZIP centroid — not cached intentionally (see above)
    lat, lng = zip_database.get_zip_coords(zipcode)
    return lat, lng, False


def batch_geocode_for_display(physicians: List[Dict]) -> None:
    """
    Geocode addresses for display using thread pool.
    Updates physician dicts in-place with lat/lng.

    Sets p["_geocoded"] = True only when Geoapify returned address-level
    coordinates. When falling back to ZIP centroid or on error,
    p["_geocoded"] = False so the distance filter knows the precision level.

    Args:
        physicians: List of physician dicts to geocode
    """
    import concurrent.futures

    def geocode_one(p: Dict) -> None:
        if not p.get("address_1"):
            p["_geocoded"] = False
            return
        lat, lng, is_address_level = geocode_address(
            p["address_1"], p["city"], p["state"], p["zip"]
        )
        if lat is not None and lng is not None:
            p["lat"]      = lat
            p["lng"]      = lng
            p["_geocoded"] = is_address_level
        else:
            p["_geocoded"] = False

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(geocode_one, physicians))


def apply_coord_jitter(physicians: List[Dict]) -> None:
    """
    Apply slight jitter to coordinates to avoid marker overlap on map.
    Updates physician dicts in-place.

    Args:
        physicians: List of physician dicts to jitter
    """
    import math

    seen: Dict[Tuple, int] = {}
    for p in physicians:
        lat, lng = p.get("lat"), p.get("lng")
        if lat is None or lng is None:
            continue
        key   = (round(lat, 6), round(lng, 6))
        count = seen.get(key, 0)
        if count > 0:
            angle  = (count * 137.5) % 360
            radius = 0.00008 * math.ceil(count / 4)
            p["lat"] = lat + radius * math.cos(math.radians(angle))
            p["lng"] = lng + radius * math.sin(math.radians(angle))
        seen[key] = count + 1