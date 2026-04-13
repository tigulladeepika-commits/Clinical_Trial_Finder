import asyncio

from fastapi import APIRouter, Query

try:
    from .clinicaltrials_api import fetch_study_detail, fetch_trials_with_filters
    from .mapquest_api import geocode_address
except ImportError:
    from clinicaltrials_api import fetch_study_detail, fetch_trials_with_filters
    from mapquest_api import geocode_address

router = APIRouter()


@router.get("/")
async def get_trials(
    condition: str = Query(...),
    city: str = Query(""),
    state: str = Query(""),
    status: str = Query(""),
    phase: str = Query(""),
    limit: int = Query(10, ge=1),
    offset: int = Query(0, ge=0),
):
    filters = {
        "condition": condition.strip(),
        "city": city.strip(),
        "state": state.strip(),
        "status": status.strip(),
        "phase": phase.strip(),
        "us_only": True,
    }

    trials, total_count = await asyncio.to_thread(
        fetch_trials_with_filters, filters, limit, offset
    )

    return {
        "condition": condition,
        "trials": trials,
        "pagination": {
            "limit": limit,
            "offset": offset,
            "total": total_count,
            "page": (offset // limit) + 1 if limit > 0 else 1,
            "has_more": (offset + limit) < total_count,
        },
    }


@router.get("/{nct_id}/sites")
async def get_trial_sites(nct_id: str):
    """
    Return geocoded site locations for a specific trial.
    Uses lat/lon embedded in the ClinicalTrials.gov API response when available.
    Falls back to MapQuest geocoding for sites missing coordinates.
    """
    try:
        data = await asyncio.to_thread(fetch_study_detail, nct_id)
    except Exception as exc:
        return {"nctId": nct_id, "sites": [], "error": str(exc)}

    protocol = data.get("protocolSection", {})
    locations_module = protocol.get("contactsLocationsModule", {})
    raw_locations = locations_module.get("locations", [])

    overall_status = protocol.get("statusModule", {}).get("overallStatus")

    sites = []
    geocode_tasks = []

    for location in raw_locations:
        geo_point = location.get("geoPoint") or {}
        lat = geo_point.get("lat")
        lon = geo_point.get("lon")

        site_status = location.get("recruitmentStatus") or None
        resolved_status = site_status if site_status else overall_status

        site = {
            "facility": location.get("facility"),
            "city": location.get("city"),
            "state": location.get("state"),
            "country": location.get("country"),
            "status": resolved_status,
            "lat": lat,
            "lon": lon,
        }
        sites.append(site)

        if lat is None or lon is None:
            address = ", ".join(filter(None, [
                location.get("city"),
                location.get("state"),
                location.get("country"),
            ]))
            geocode_tasks.append((len(sites) - 1, address))

    if geocode_tasks:
        async def do_geocode() -> None:
            results = await asyncio.gather(
                *[geocode_address(address) for _, address in geocode_tasks]
            )
            for (index, _), coords in zip(geocode_tasks, results):
                sites[index]["lat"] = coords.get("lat")
                sites[index]["lon"] = coords.get("lon")

        await do_geocode()

    return {
        "nctId": nct_id,
        "title": protocol.get("identificationModule", {}).get("briefTitle"),
        "status": overall_status,
        "sites": sites,
    }