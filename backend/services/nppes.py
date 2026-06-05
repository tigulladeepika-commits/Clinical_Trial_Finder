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
 
Fix v2.1.4:
  - _clean_display_name() now strips leading dots/punctuation that appear
    in some NPPES name_prefix fields (e.g. ". DEE MCLEOD" -> "Dee Mcleod").
  - parse_physician() now uses a smarter primary taxonomy selection.
 
Fix v2.1.5:
  - _is_generic_desc() introduced to identify overly broad taxonomy
    descriptions (e.g. "Allopathic & Osteopathic Physicians", "Specialist")
    that carry no clinical meaning in the UI.
 
Fix v2.1.6:
  - _is_primary() introduced to safely handle NPPES returning the primary
    field as either a boolean (True/False) or a string ("Y"/"N"/"YES"/"NO").
    Previously t.get("primary") on a string "N" would be truthy in Python,
    causing wrong taxonomy selection.
  - _select_primary_taxonomy() extracted as a standalone function with
    clearly documented priority order:
      P1: primary=True  AND specific (non-generic) desc
      P2: any taxonomy  with specific (non-generic) desc
      P3: primary=True  with any non-empty desc
      P4: any taxonomy  with any non-empty desc
      P5: first taxonomy (absolute fallback)
"""
 
import logging
import re
import time
from typing import Dict, List, Optional, Tuple
 
from requests import Timeout
 
from core.config import cfg
from core.helpers import LRUCache
from services.http_client import http_client
 
 
logger = logging.getLogger(__name__)
 
NPPES_BASE_URL = "https://npiregistry.cms.hhs.gov/api/"
 
# Cache for geocoded addresses — only stores successful address-level results.
_addr_cache = LRUCache(cfg.GEOCODE_CACHE_SIZE)
 
# Generic taxonomy descriptions that carry no clinical meaning in the UI.
_GENERIC_TAXONOMY_DESCS = frozenset({
    "",
    "allopathic & osteopathic physicians",
    "specialist",
    "doctor of medicine",
    "physician",
    "medical doctor",
    "doctors of medicine",
})
 
 
# ── Taxonomy helpers ──────────────────────────────────────────────────────────
 
def _is_primary(t: dict) -> bool:
    """
    Safely check if a taxonomy entry is marked as primary.
 
    NPPES API can return the 'primary' field as:
      - boolean  True / False
      - string   "Y" / "N" / "YES" / "NO" / "true" / "false"
      - missing  (treat as False)
 
    Using plain t.get("primary") is unsafe because the string "N" is
    truthy in Python, which would incorrectly treat a non-primary taxonomy
    as primary.
    """
    val = t.get("primary")
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.upper() in ("Y", "YES", "TRUE", "1")
    return False
 
 
def _is_generic_desc(desc: str) -> bool:
    """Return True if the taxonomy description is too broad to be useful in the UI."""
    return desc.lower().strip() in _GENERIC_TAXONOMY_DESCS
 
 
def _select_primary_taxonomy(taxonomies: list) -> dict:
    """
    Select the best taxonomy entry for display from an NPPES taxonomy list.
 
    Priority:
      P1 — primary=True  AND specific (non-generic) desc   <- ideal
      P2 — any taxonomy  with specific (non-generic) desc  <- fallback when
                                                              primary is generic
      P3 — primary=True  with any non-empty desc           <- generic primary
      P4 — any taxonomy  with any non-empty desc           <- last resort
      P5 — first taxonomy entry                            <- absolute fallback
    """
    if not taxonomies:
        return {}
 
    # P1 — primary AND specific
    p1 = next(
        (
            t for t in taxonomies
            if _is_primary(t)
            and not _is_generic_desc(str(t.get("desc") or ""))
        ),
        None,
    )
    if p1:
        return p1
 
    # P2 — any specific (non-generic) desc
    p2 = next(
        (
            t for t in taxonomies
            if not _is_generic_desc(str(t.get("desc") or ""))
        ),
        None,
    )
    if p2:
        return p2
 
    # P3 — primary with any non-empty desc
    p3 = next(
        (
            t for t in taxonomies
            if _is_primary(t) and str(t.get("desc") or "").strip()
        ),
        None,
    )
    if p3:
        return p3
 
    # P4 — any non-empty desc
    p4 = next(
        (t for t in taxonomies if str(t.get("desc") or "").strip()),
        None,
    )
    if p4:
        return p4
 
    # P5 — absolute fallback
    return taxonomies[0]
 
 
# ── Display-name cleaning ─────────────────────────────────────────────────────
 
def _clean_display_name(raw: str) -> str:
    """
    Strip NPI registry artifacts from an assembled physician name.
 
    Handles:
      - Leading/trailing dash sequences  e.g. "-- WILLIAM BURTON DAVIS --"
      - Honorific prefixes               e.g. "Dr.", "Mr.", "Mrs.", "Prof."
      - Isolated dashes not part of a hyphenated name
      - Leading dots/punctuation         e.g. ". DEE MCLEOD"
      - Excess whitespace
 
    Credentials (M.D., MD, etc.) are NOT removed here — they are appended
    separately in parse_physician() from the NPPES credential field.
    """
    name = raw
 
    # Remove -- artifacts e.g. "-- WILLIAM --" or "--ALAN--"
    name = re.sub(r'\s*--+\s*', ' ', name)
 
    # Remove honorific titles
    name = re.sub(
        r'\b(Dr\.?|Mr\.?|Mrs\.?|Ms\.?|Prof\.?)\b',
        '',
        name,
        flags=re.IGNORECASE,
    )
 
    # Remove isolated dashes not part of a hyphenated name
    name = re.sub(r'(?<!\w)-(?!\w)', ' ', name)
 
    # Remove leading dots/punctuation e.g. ". DEE MCLEOD"
    name = re.sub(r'^[\s\.\,]+', '', name)
 
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
        "version":          "2.1",
        "enumeration_type": "NPI-1",
        "limit":            200,
        "skip":             0,
        "country_code":     "US",
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
 
    # Smart taxonomy selection — see _select_primary_taxonomy() for priority rules
    primary_tax = _select_primary_taxonomy(taxonomies)
 
    prefix = str(basic.get("name_prefix") or "").strip()
    first  = str(basic.get("first_name")  or "").strip()
    middle = str(basic.get("middle_name") or "").strip()
    last   = str(basic.get("last_name")   or "").strip()
    suffix = str(basic.get("name_suffix") or "").strip()
    cred   = str(basic.get("credential")  or "").strip()
 
    # Assemble raw name then strip registry artifacts before presenting to UI
    name_parts = [prefix, first, middle, last, suffix]
    raw_name   = " ".join([p for p in name_parts if p]).strip() or "Unknown Provider"
    name       = _clean_display_name(raw_name)
 
    # Re-attach credential (M.D., MD, etc.) — kept intentionally for display
    if cred:
        name += f", {cred}"
 
    addr1   = str(addr.get("address_1")        or "")
    addr2   = str(addr.get("address_2")        or "")
    city    = str(addr.get("city")             or "")
    state   = str(addr.get("state")            or "")
    zipcode = str(addr.get("postal_code")      or "")[:5]
    phone   = str(addr.get("telephone_number") or "")
 
    full_address = ", ".join(p for p in [addr1, addr2, city, state, zipcode] if p)
 
    all_tax = [
        {"code": str(t.get("code") or ""), "desc": str(t.get("desc") or "")}
        for t in taxonomies
    ]
 
    return {
        "npi":            str(result.get("number") or ""),
        "name":           name,
        "taxonomy_code":  str(primary_tax.get("code") or ""),
        "taxonomy_desc":  str(primary_tax.get("desc") or ""),
        "all_taxonomies": all_tax,
        "address":        full_address,
        "address_1":      addr1,
        "city":           city,
        "state":          state,
        "zip":            zipcode,
        "phone":          phone,
        "lat":            None,
        "lng":            None,
        "distance_miles": None,
        # _geocoded is set by batch_geocode_for_display(); False here means
        # "only ZIP centroid coords assigned so far".
        "_geocoded":      False,
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
                _addr_cache.set(key, (lat, lng))
                return lat, lng, True
        except Exception as e:
            logger.debug("Addr geocode failed '%s': %s", query, e)
 
    # Fallback to ZIP centroid — not cached intentionally
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
            p["lat"]       = lat
            p["lng"]       = lng
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