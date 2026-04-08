import logging
import os

import httpx

logger = logging.getLogger(__name__)

MAPQUEST_API_KEY = os.getenv("MAPQUEST_API_KEY")
GEOCODE_URL = "https://www.mapquestapi.com/geocoding/v1/address"


async def geocode_address(address: str) -> dict:
    """Return lat/lon for a given address string using the MapQuest Geocoding API."""
    if not MAPQUEST_API_KEY:
        logger.warning("MAPQUEST_API_KEY is not set; skipping geocoding.")
        return {"lat": None, "lon": None}

    if not address or not address.strip():
        return {"lat": None, "lon": None}

    params = {
        "key": MAPQUEST_API_KEY,
        "location": address,
    }

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(GEOCODE_URL, params=params)
            response.raise_for_status()
            data = response.json()
            location = data["results"][0]["locations"][0]["latLng"]

            if location["lat"] == 0.0 and location["lng"] == 0.0:
                logger.warning("MapQuest could not geocode: %s", address)
                return {"lat": None, "lon": None}

            return {"lat": location["lat"], "lon": location["lng"]}

    except (KeyError, IndexError) as exc:
        logger.warning("Unexpected MapQuest response for '%s': %s", address, exc)
        return {"lat": None, "lon": None}
    except httpx.HTTPStatusError as exc:
        logger.error("MapQuest HTTP error for '%s': %s", address, exc.response.status_code)
        return {"lat": None, "lon": None}
    except httpx.RequestError as exc:
        logger.error("MapQuest request failed for '%s': %s", address, exc)
        return {"lat": None, "lon": None}
