"""
ZIP code database service.
Manages loading and querying US ZIP code coordinates.

Fix v2.1.2:
  - initialize() now accepts background=True/False parameter.
  - When background=False (used on Render via cfg.ZIP_LOAD_SYNC),
    _load_zip_database() is called directly on the calling thread so
    the worker blocks until the ZIP DB is fully ready before accepting
    any requests. This eliminates the "ZIPs in radius: 0" cold-start
    race condition seen in production logs.
  - No other logic changed; background=True preserves original behaviour
    for local development.

Fix v2.1.3:
  - Cast local_cache (PosixPath) to str before concatenating ".tmp" suffix
    to fix: unsupported operand type(s) for +: 'PosixPath' and 'str'

Fix v2.1.4:
  - BUG FIX: GeoNames US.txt column layout is:
      [0] country_code  [1] postal_code  [2] place_name  [3] admin_name1
      [4] admin_code1   [5] admin_name2  [6] admin_code2 ...
      [9] latitude      [10] longitude
    Previously parts[3] was used for the state, which is admin_name1 (full
    state name, e.g. "Massachusetts"). The city/state lookup must store the
    2-letter state abbreviation (admin_code1 = parts[4]) so that
    get_cities_by_state() returns {"MA": [...]} rather than
    {"Massachusetts": [...]}, matching the 2-letter codes the frontend sends.
    This was the root cause of "Boston is not a city in massachusetts" — the
    lookup cities_by_state.get("MA") always returned [] because the data was
    keyed by full state name.
"""

import io
import json
import logging
import math
import os
import threading
import zipfile
from typing import Dict, List, Optional, Set, Tuple
from core.config import cfg

logger = logging.getLogger(__name__)

from services.http_client import http_client

GEONAMES_ZIP_URL = "https://download.geonames.org/export/zip/US.zip"

# Global state
_zip_db: Dict[str, Tuple[float, float]] = {}
_zip_db_ready = threading.Event()
_zip_db_lock = threading.Lock()
_zip_index: Dict[Tuple[int, int], List] = {}
_zip_index_lock = threading.Lock()

# City/State lookup: ZIP code -> (city, state_code)
# state_code is the 2-letter abbreviation (e.g. "MA"), NOT the full name.
_zip_location: Dict[str, Tuple[str, str]] = {}
_zip_location_lock = threading.Lock()

_ZIP_FALLBACK: Dict[str, Tuple[float, float]] = {
    "10001": (40.7506, -73.9971), "90210": (34.0901, -118.4065),
    "60601": (41.8859, -87.6181), "77030": (29.7079, -95.4010),
    "94102": (37.7793, -122.4192), "98101": (47.6089, -122.3352),
    "30301": (33.7627, -84.4229), "02115": (42.3437, -71.0992),
    "19103": (39.9527, -75.1797), "20001": (38.9123, -77.0177),
    "33101": (25.7959, -80.2870), "75201": (32.7884, -96.7989),
    "48201": (42.3533, -83.0524), "80201": (39.7392, -104.9903),
    "97201": (45.5169, -122.6809), "89101": (36.1756, -115.1391),
    "92101": (32.7264, -117.1552), "28201": (35.2271, -80.8431),
}


def _build_spatial_index(db: Dict) -> None:
    """Build spatial index for efficient ZIP code lookup."""
    idx: Dict = {}
    for z, (lat, lng) in db.items():
        cell = (int(math.floor(lat)), int(math.floor(lng)))
        idx.setdefault(cell, []).append((lat, lng, z))
    with _zip_index_lock:
        _zip_index.clear()
        _zip_index.update(idx)
    logger.info("Spatial index built: %d cells", len(_zip_index))


def _load_zip_database() -> None:
    """Load ZIP database from cache or download from GeoNames."""
    local_cache = cfg.ZIP_DB_PATH

    def _apply(db: Dict, locations: Dict) -> None:
        with _zip_db_lock:
            _zip_db.clear()
            _zip_db.update(db)
        with _zip_location_lock:
            _zip_location.clear()
            _zip_location.update(locations)
        _build_spatial_index(db)
        _zip_db_ready.set()
        logger.info("ZIP db ready: %d entries", len(_zip_db))

    # Cache version — bump this whenever the cache schema changes.
    # v2.1.4: state codes changed from full names ("Massachusetts") to
    # 2-letter abbreviations ("MA"). Any cache without this version tag
    # is deleted and re-downloaded fresh.
    CACHE_VERSION = "2.1.4"

    if os.path.exists(local_cache):
        try:
            with open(local_cache) as f:
                raw = json.load(f)
            cached_version = raw.get("version", "")
            if cached_version != CACHE_VERSION:
                logger.warning(
                    "ZIP cache version mismatch (cached=%r, expected=%r) — "
                    "deleting and re-downloading",
                    cached_version, CACHE_VERSION,
                )
                os.remove(local_cache)
            else:
                # Safety net: also check for full-state-name format
                locs = raw.get("locations", {})
                if locs:
                    sample_state = next(iter(locs.values()))[1]
                    if len(sample_state) > 2:
                        logger.warning(
                            "ZIP cache has full state names (e.g. %r) — "
                            "deleting and re-downloading",
                            sample_state,
                        )
                        os.remove(local_cache)
        except Exception as e:
            logger.warning("ZIP cache pre-check failed, will re-download: %s", e)
            try:
                os.remove(local_cache)
            except Exception:
                pass

    # Try loading from disk cache first
    if os.path.exists(local_cache):
        try:
            with open(local_cache) as f:
                raw = json.load(f)
            # Check if it's the new format with locations
            if "zips" in raw:
                db = {k: (float(v[0]), float(v[1])) for k, v in raw["zips"].items()}
                locs = raw.get("locations", {})
                _apply(db, locs)
            else:
                # Old format - just coordinates
                db = {k: (float(v[0]), float(v[1])) for k, v in raw.items()}
                _apply(db, {})
            logger.info("ZIP db loaded from disk cache")
            return
        except Exception as e:
            logger.warning("ZIP disk cache corrupt, re-downloading: %s", e)

    # Download from GeoNames.
    # Uses ZIP_DL_TIMEOUT (90s) — this is either a background thread at startup
    # or the main worker thread on Render (sync mode). Either way it is NOT
    # subject to Render's per-request 30s proxy deadline.
    try:
        logger.info("Downloading GeoNames US ZIP database...")
        resp = http_client.get(GEONAMES_ZIP_URL, timeout=cfg.ZIP_DL_TIMEOUT)
        resp.raise_for_status()
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        with zf.open("US.txt") as f:
            content = f.read().decode("utf-8", errors="replace")

        db: Dict = {}
        locations: Dict[str, Tuple[str, str]] = {}
        for line in content.splitlines():
            parts = line.split("\t")
            if len(parts) >= 10:
                try:
                    zipcode = parts[1].strip()
                    city    = parts[2].strip()   # admin_name (place name)
                    # FIX v2.1.4: use parts[4] (admin_code1) for the 2-letter
                    # state abbreviation, NOT parts[3] (admin_name1) which is
                    # the full state name like "Massachusetts".
                    state   = parts[4].strip()   # admin_code1 = 2-letter state code
                    lat     = float(parts[9])
                    lng     = float(parts[10])

                    if zipcode and lat and lng:
                        db[zipcode] = (lat, lng)
                        if city and state:
                            locations[zipcode] = (city, state)
                except (ValueError, IndexError):
                    pass

        # FIX v2.1.3: cast to str before concatenating ".tmp" to avoid
        # TypeError: unsupported operand type(s) for +: 'PosixPath' and 'str'
        tmp = str(local_cache) + ".tmp"
        cache_data = {
            "version": CACHE_VERSION,
            "zips": {k: list(v) for k, v in db.items()},
            "locations": locations,
        }
        with open(tmp, "w") as f:
            json.dump(cache_data, f)
        os.replace(tmp, local_cache)
        _apply(db, locations)

    except Exception as e:
        logger.error("ZIP db download failed: %s — using fallback", e)
        _apply(_ZIP_FALLBACK, {})


def initialize(background: bool = True) -> None:
    """
    Load the ZIP database.

    Args:
        background: If True (default / local dev), load in a background
                    daemon thread so the server starts immediately.
                    If False (Render production), load synchronously on
                    the calling thread — the worker blocks until the DB
                    is fully ready before accepting any traffic, which
                    eliminates the cold-start "ZIPs in radius: 0" bug.
    """
    if background:
        threading.Thread(
            target=_load_zip_database, daemon=False, name="zip-loader"
        ).start()
    else:
        logger.info("ZIP db: loading synchronously (ZIP_LOAD_SYNC=True)")
        _load_zip_database()
        logger.info("ZIP db: synchronous load complete — worker ready")


def get_zip_coords(zipcode: str) -> Tuple[Optional[float], Optional[float]]:
    """Get latitude and longitude for a ZIP code."""
    z = str(zipcode or "")[:5].strip()
    with _zip_db_lock:
        v = _zip_db.get(z)
    return (float(v[0]), float(v[1])) if v else (None, None)


def is_ready() -> bool:
    """Check if ZIP database is loaded and ready."""
    return _zip_db_ready.is_set()


def wait_for_ready(timeout: Optional[float] = None) -> bool:
    """Wait for ZIP database to be ready."""
    return _zip_db_ready.wait(timeout=timeout)


def count() -> int:
    """Get number of ZIP codes in database."""
    with _zip_db_lock:
        return len(_zip_db)


def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in miles using Haversine formula."""
    R = 3958.8  # Earth radius in miles
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(a))


def find_zips_in_radius(
    center_lat: float,
    center_lng: float,
    radius_miles: float,
) -> List[str]:
    """Find all ZIP codes within radius of center point."""
    deg_lat = radius_miles / 69.0
    deg_lng = radius_miles / (69.0 * math.cos(math.radians(center_lat)) + 1e-9)

    cell_lat_min = int(math.floor(center_lat - deg_lat))
    cell_lat_max = int(math.floor(center_lat + deg_lat))
    cell_lng_min = int(math.floor(center_lng - deg_lng))
    cell_lng_max = int(math.floor(center_lng + deg_lng))

    result: List[Tuple[float, str]] = []
    with _zip_index_lock:
        for clat in range(cell_lat_min, cell_lat_max + 1):
            for clng in range(cell_lng_min, cell_lng_max + 1):
                for (zlat, zlng, z) in _zip_index.get((clat, clng), []):
                    d = haversine(center_lat, center_lng, zlat, zlng)
                    if d <= radius_miles:
                        result.append((d, z))

    # Fallback for when spatial index is empty (should not happen in sync mode)
    if not result and not _zip_index:
        with _zip_db_lock:
            for z, (zlat, zlng) in _zip_db.items():
                d = haversine(center_lat, center_lng, zlat, zlng)
                if d <= radius_miles:
                    result.append((d, z))

    result.sort()
    return [z for _, z in result]


def get_zip_location(zipcode: str) -> Tuple[Optional[str], Optional[str]]:
    """Get city and state code for a ZIP code."""
    z = str(zipcode or "")[:5].strip()
    with _zip_location_lock:
        v = _zip_location.get(z)
    return (v[0], v[1]) if v else (None, None)


def get_cities_by_state() -> Dict[str, List[str]]:
    """
    Get all cities grouped by 2-letter state code for frontend validation.

    Returns e.g. {"MA": ["Boston", "Cambridge", ...], "CA": [...], ...}

    Keys are always uppercase 2-letter state abbreviations (admin_code1 from
    GeoNames) so they match the state codes the frontend sends to
    /api/trials/validate-city-state.

    Falls back to a hardcoded dataset of major US cities if the ZIP DB
    has no location data (e.g. GeoNames download failed on cold start).
    """
    cities_by_state: Dict[str, Set[str]] = {}
    with _zip_location_lock:
        for zipcode, (city, state_code) in _zip_location.items():
            if state_code and city:
                key = state_code.strip().upper()
                if key not in cities_by_state:
                    cities_by_state[key] = set()
                cities_by_state[key].add(city)

    # If ZIP DB has no location data (download failed / fallback mode),
    # use a comprehensive hardcoded dataset so validation never returns {}.
    if not cities_by_state:
        logger.warning(
            "ZIP location data is empty — using hardcoded city fallback for validation"
        )
        return _HARDCODED_CITIES_BY_STATE

    return {state: sorted(list(cities)) for state, cities in cities_by_state.items()}


# Comprehensive hardcoded US cities by state (2-letter code).
# Used as fallback when GeoNames ZIP DB has no location data.
# Covers all major cities and most mid-size cities for each state.
_HARDCODED_CITIES_BY_STATE: Dict[str, List[str]] = {
    "AL": ["Birmingham","Montgomery","Huntsville","Mobile","Tuscaloosa","Hoover","Dothan","Auburn","Decatur","Madison"],
    "AK": ["Anchorage","Fairbanks","Juneau","Sitka","Ketchikan","Wasilla","Kenai","Kodiak","Bethel","Palmer"],
    "AZ": ["Phoenix","Tucson","Mesa","Chandler","Scottsdale","Glendale","Gilbert","Tempe","Peoria","Surprise"],
    "AR": ["Little Rock","Fort Smith","Fayetteville","Springdale","Jonesboro","North Little Rock","Conway","Rogers","Pine Bluff","Bentonville"],
    "CA": ["Los Angeles","San Diego","San Jose","San Francisco","Fresno","Sacramento","Long Beach","Oakland","Bakersfield","Anaheim","Santa Ana","Riverside","Stockton","Chula Vista","Irvine","Fremont","San Bernardino","Modesto","Fontana","Moreno Valley","Glendale","Huntington Beach","Santa Clarita","Garden Grove","Oceanside","Rancho Cucamonga","Santa Rosa","Ontario","Lancaster","Elk Grove","Corona","Palmdale","Salinas","Pomona","Escondido","Sunnyvale","Torrance","Pasadena","Orange","Fullerton","Santa Barbara","San Luis Obispo","Berkeley","San Mateo","Redding","Visalia","Burbank","Inglewood"],
    "CO": ["Denver","Colorado Springs","Aurora","Fort Collins","Lakewood","Thornton","Arvada","Westminster","Pueblo","Boulder","Centennial","Highlands Ranch","Greeley","Longmont","Loveland","Broomfield","Castle Rock","Commerce City","Parker","Northglenn"],
    "CT": ["Bridgeport","New Haven","Hartford","Stamford","Waterbury","Norwalk","Danbury","New Britain","Greenwich","Meriden","Bristol","West Hartford","Milford","Middletown","Hamden","Naugatuck","Manchester","Torrington"],
    "DE": ["Wilmington","Dover","Newark","Middletown","Smyrna","Milford","Seaford","Georgetown","Elsmere","New Castle"],
    "FL": ["Jacksonville","Miami","Tampa","Orlando","St. Petersburg","Hialeah","Tallahassee","Fort Lauderdale","Port St. Lucie","Cape Coral","Pembroke Pines","Hollywood","Miramar","Gainesville","Coral Springs","Miami Gardens","Clearwater","Palm Bay","Pompano Beach","West Palm Beach","Lakeland","Davie","Miami Beach","Boca Raton","Deltona","Plantation","Sunrise","Fort Myers","Palm Coast","Deerfield Beach"],
    "GA": ["Atlanta","Augusta","Columbus","Macon","Savannah","Athens","Sandy Springs","South Fulton","Roswell","Johns Creek","Warner Robins","Albany","Alpharetta","Marietta","Smyrna","Valdosta","Brookhaven","Dunwoody","Peachtree City","Gainesville"],
    "HI": ["Honolulu","Pearl City","Hilo","Kailua","Waipahu","Kaneohe","Mililani","Kahului","Ewa Beach","Kihei","Makakilo","Wahiawa","Kapolei","Wailuku","Kapaa"],
    "ID": ["Boise","Meridian","Nampa","Idaho Falls","Pocatello","Caldwell","Coeur d'Alene","Twin Falls","Lewiston","Post Falls"],
    "IL": ["Chicago","Aurora","Joliet","Naperville","Rockford","Springfield","Elgin","Peoria","Champaign","Waukegan","Cicero","Bloomington","Arlington Heights","Evanston","Decatur","Schaumburg","Bolingbrook","Palatine","Skokie","Des Plaines"],
    "IN": ["Indianapolis","Fort Wayne","Evansville","South Bend","Carmel","Fishers","Bloomington","Hammond","Gary","Lafayette","Muncie","Terre Haute","Kokomo","Noblesville","Anderson","Greenwood","Elkhart","Mishawaka"],
    "IA": ["Des Moines","Cedar Rapids","Davenport","Sioux City","Iowa City","Waterloo","Council Bluffs","Ames","West Des Moines","Ankeny","Dubuque","Urbandale","Cedar Falls"],
    "KS": ["Wichita","Overland Park","Kansas City","Olathe","Topeka","Lawrence","Shawnee","Manhattan","Lenexa","Salina","Hutchinson","Leavenworth","Leawood"],
    "KY": ["Louisville","Lexington","Bowling Green","Owensboro","Covington","Hopkinsville","Richmond","Florence","Georgetown","Henderson","Elizabethtown","Nicholasville","Jeffersontown"],
    "LA": ["New Orleans","Baton Rouge","Shreveport","Metairie","Lafayette","Lake Charles","Kenner","Bossier City","Monroe","Alexandria","Prairieville","Youngsville"],
    "ME": ["Portland","Lewiston","Bangor","South Portland","Auburn","Biddeford","Sanford","Brunswick","Augusta","Scarborough"],
    "MD": ["Baltimore","Columbia","Germantown","Silver Spring","Waldorf","Glen Burnie","Ellicott City","Frederick","Dundalk","Rockville","Gaithersburg","Bethesda","Towson","Bowie","Aspen Hill","Annapolis"],
    "MA": ["Boston","Worcester","Springfield","Lowell","Cambridge","New Bedford","Brockton","Quincy","Lynn","Fall River","Newton","Lawrence","Somerville","Framingham","Haverhill","Waltham","Malden","Brookline","Plymouth","Medford","Taunton","Chicopee","Weymouth","Revere","Peabody","Methuen","Barnstable","Pittsfield","Attleboro","Salem","Westfield","Marlborough","Chelsea","Woburn","Leominster","Holyoke","Fitchburg","Beverly","Northampton","Gloucester"],
    "MI": ["Detroit","Grand Rapids","Warren","Sterling Heights","Ann Arbor","Lansing","Flint","Dearborn","Livonia","Troy","Westland","Kalamazoo","Wyoming","Southfield","Rochester Hills","Taylor","Pontiac","St. Clair Shores","Royal Oak","Novi","Dearborn Heights","Battle Creek","Saginaw","Farmington Hills","Roseville","Clinton Township","Kentwood"],
    "MN": ["Minneapolis","Saint Paul","Rochester","Duluth","Bloomington","Brooklyn Park","Plymouth","Saint Cloud","Eagan","Woodbury","Maple Grove","Coon Rapids","Burnsville","Apple Valley","Edina","Blaine","Lakeville","Minnetonka","Moorhead","Mankato"],
    "MS": ["Jackson","Gulfport","Southaven","Hattiesburg","Biloxi","Meridian","Tupelo","Greenville","Olive Branch","Horn Lake","Pearl","Madison","Rankin County"],
    "MO": ["Kansas City","Saint Louis","Springfield","Columbia","Independence","Lee's Summit","O'Fallon","St. Joseph","St. Charles","Blue Springs","Joplin","Chesterfield","Jefferson City","Cape Girardeau","Florissant","St. Peters"],
    "MT": ["Billings","Missoula","Great Falls","Bozeman","Butte","Helena","Kalispell","Havre","Anaconda","Miles City"],
    "NE": ["Omaha","Lincoln","Bellevue","Grand Island","Kearney","Fremont","Hastings","Norfolk","Columbus","Papillion","La Vista","Scottsbluff"],
    "NV": ["Las Vegas","Henderson","Reno","North Las Vegas","Sparks","Carson City","Fernley","Elko","Mesquite","Boulder City","Fallon"],
    "NH": ["Manchester","Nashua","Concord","Derry","Dover","Rochester","Salem","Merrimack","Hudson","Londonderry","Keene","Bedford"],
    "NJ": ["Newark","Jersey City","Paterson","Elizabeth","Edison","Woodbridge","Lakewood","Toms River","Hamilton","Trenton","Clifton","Camden","Brick","Cherry Hill","Passaic","Middletown","Union City","Gloucester","East Orange","Bayonne"],
    "NM": ["Albuquerque","Las Cruces","Rio Rancho","Santa Fe","Roswell","Farmington","South Valley","Clovis","Hobbs","Alamogordo","Carlsbad","Gallup"],
    "NY": ["New York","Buffalo","Rochester","Yonkers","Syracuse","Albany","New Rochelle","Mount Vernon","Schenectady","Utica","White Plains","Hempstead","Troy","Niagara Falls","Binghamton","Freeport","Valley Stream","Long Beach","Rome","North Tonawanda","Ithaca","Poughkeepsie","Jamestown","Elmira"],
    "NC": ["Charlotte","Raleigh","Greensboro","Durham","Winston-Salem","Fayetteville","Cary","Wilmington","High Point","Concord","Asheville","Gastonia","Jacksonville","Chapel Hill","Rocky Mount","Burlington","Huntersville","Kannapolis","Wilson","Apex"],
    "ND": ["Fargo","Bismarck","Grand Forks","Minot","West Fargo","Williston","Mandan","Dickinson","Jamestown","Wahpeton"],
    "OH": ["Columbus","Cleveland","Cincinnati","Toledo","Akron","Dayton","Parma","Canton","Youngstown","Lorain","Hamilton","Springfield","Kettering","Elyria","Lakewood","Cuyahoga Falls","Euclid","Middletown","Newark","Mansfield"],
    "OK": ["Oklahoma City","Tulsa","Norman","Broken Arrow","Edmond","Lawton","Moore","Midwest City","Enid","Stillwater","Muskogee","Owasso","Bartlesville","Shawnee"],
    "OR": ["Portland","Eugene","Salem","Gresham","Hillsboro","Beaverton","Bend","Medford","Springfield","Corvallis","Albany","Tigard","Lake Oswego","Keizer","Grants Pass","Oregon City","McMinnville","Redmond","Tualatin"],
    "PA": ["Philadelphia","Pittsburgh","Allentown","Erie","Reading","Scranton","Bethlehem","Lancaster","Harrisburg","Altoona","York","Wilkes-Barre","Chester","Norristown","State College","Easton","Lebanon","Hazleton","New Castle","Johnstown"],
    "RI": ["Providence","Cranston","Warwick","Pawtucket","East Providence","Woonsocket","Coventry","Cumberland","North Providence","South Kingstown","West Warwick","Johnston"],
    "SC": ["Columbia","Charleston","North Charleston","Mount Pleasant","Rock Hill","Greenville","Summerville","Goose Creek","Hilton Head Island","Sumter","Florence","Spartanburg","Myrtle Beach","Conway","Anderson"],
    "SD": ["Sioux Falls","Rapid City","Aberdeen","Brookings","Watertown","Mitchell","Yankton","Pierre","Huron","Vermillion"],
    "TN": ["Nashville","Memphis","Knoxville","Chattanooga","Clarksville","Murfreesboro","Franklin","Jackson","Johnson City","Bartlett","Hendersonville","Kingsport","Collierville","Smyrna","Cleveland"],
    "TX": ["Houston","San Antonio","Dallas","Austin","Fort Worth","El Paso","Arlington","Corpus Christi","Plano","Laredo","Lubbock","Garland","Irving","Amarillo","Grand Prairie","Brownsville","Pasadena","McKinney","Mesquite","McAllen","Killeen","Frisco","Waco","Carrollton","Denton","Midland","Abilene","Beaumont","Round Rock","Odessa","Richardson","Pearland","College Station","Tyler","League City","Wichita Falls","Allen","San Angelo","Lewisville","Edinburg","Longview","Sugar Land","Conroe"],
    "UT": ["Salt Lake City","West Valley City","Provo","West Jordan","Sandy","Ogden","St. George","Layton","South Jordan","Lehi","Millcreek","Taylorsville","Logan","Murray","Draper","Bountiful","Riverton","Herriman","Spanish Fork","Roy"],
    "VT": ["Burlington","South Burlington","Rutland","Barre","Montpelier","Winooski","St. Albans","Newport","Vergennes","Middlebury"],
    "VA": ["Virginia Beach","Norfolk","Chesapeake","Richmond","Newport News","Alexandria","Hampton","Roanoke","Portsmouth","Suffolk","Lynchburg","Harrisonburg","Leesburg","Charlottesville","Danville","Blacksburg","Manassas","Petersburg"],
    "WA": ["Seattle","Spokane","Tacoma","Vancouver","Bellevue","Kent","Everett","Renton","Spokane Valley","Kirkland","Bellingham","Kennewick","Yakima","Federal Way","Redmond","Marysville","Pasco","South Hill","Shoreline","Richland"],
    "WV": ["Charleston","Huntington","Parkersburg","Morgantown","Wheeling","Weirton","Fairmont","Martinsburg","Beckley","Clarksburg"],
    "WI": ["Milwaukee","Madison","Green Bay","Kenosha","Racine","Appleton","Waukesha","Eau Claire","Oshkosh","Janesville","West Allis","La Crosse","Sheboygan","Wauwatosa","Fond du Lac","New Berlin","Wausau","Brookfield","Greenfield","Beloit"],
    "WY": ["Cheyenne","Casper","Laramie","Gillette","Rock Springs","Sheridan","Green River","Evanston","Riverton","Jackson"],
    "DC": ["Washington"],
}