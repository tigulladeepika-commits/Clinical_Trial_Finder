# Technical Specification

## Overview

Clinical Trial Finder is implemented as a Next.js frontend paired with a FastAPI backend. The frontend handles user input, list rendering, map-based site review, and physician search with radius controls. The backend queries ClinicalTrials.gov, transforms upstream study data into an application-specific shape, enriches missing coordinates through MapQuest geocoding, searches the NPPES physician registry, maps trial conditions to medical specialties, captures user leads, and optionally integrates with Salesforce CRM.

![System architecture](assets/technical-architecture.svg)

*Figure 1. Runtime architecture showing the browser, Next.js frontend, FastAPI backend, and external dependencies.*

## Design Goals

- Keep the product simple enough to deploy as a small two-tier application
- Use public clinical trial data and physician registries without introducing a local database
- Provide a fast search-to-detail workflow in a single page
- Support geographic exploration without making the map the only source of truth
- Degrade safely when external services fail or return partial data
- Automatically match trial conditions to medical specialties
- Surface AI-enriched physician insights using publication metadata, OpenAlex metrics, and Groq summaries
- Capture user interest and streamline coordinator follow-up through optional CRM integration

## Runtime Topology

| Layer | Technology | Responsibility |
| --- | --- | --- |
| Browser | React client runtime | Render UI, submit searches, display results and map |
| Frontend app | Next.js 15 + TypeScript | Route handling, page composition, API proxy rewrites |
| Backend API | FastAPI + Uvicorn | Search endpoints, normalization, pagination metadata, lead capture |
| External trial source | ClinicalTrials.gov API v2 | Upstream study search and study detail |
| Physician registry | NPPES API (via nppes.py) | National provider lookup and specialty matching |
| Geocoding service | MapQuest Geocoding API, Geoapify API | Fallback latitude/longitude lookup, physician address geocoding |
| Map SDK | MapQuest JS SDK | Browser-side interactive map rendering |
| CRM service | Salesforce Web-to-Lead API | Optional lead push for coordinator follow-up |

## Repository Structure

| Path | Purpose |
| --- | --- |
| `backend/main.py` | FastAPI app creation, CORS setup, health endpoint |
| `backend/api/trials.py` | API routes for trial search, sites, condition-specialty mapping |
| `backend/api/physicians.py` | API routes for physician search and suggested specialists |
| `backend/api/publications.py` | API routes for physician publication lookup |
| `backend/api/leads.py` | API routes for lead capture and CRM integration |
| `backend/services/clinicaltrials_api.py` | Upstream study fetch, mapping, local filtering with advanced gates |
| `backend/services/nppes.py` | NPPES physician registry queries with caching and geocoding |
| `backend/services/physician_insights_service.py` | AI enrichment pipeline for physician research and profile summaries |
| `backend/services/openalex_service.py` | Publication and citation metrics lookup for physicians |
| `backend/services/publication_verifier.py` | Publication relevance verification before AI summarization |
| `backend/services/mapquest_api.py` | Fallback address geocoding via MapQuest |
| `backend/services/zip_database.py` | US ZIP code radius queries for physician location search |
| `backend/services/taxonomy.py` | Condition-to-specialty mapping with 4-pass resolution algorithm |
| `backend/services/salesforce.py` | Lead push to Salesforce Web-to-Lead form |
| `backend/services/rate_limiting.py` | Per-IP rate limit configuration |
| `backend/core/config.py` | Environment variable configuration and validation |
| `backend/core/validation.py` | Input validation and normalization |
| `backend/data/leads.json` | Persistent lead capture storage |
| `backend/data/us_zip_db.json` | US ZIP code database indexed by state |
| `frontend/app/page.tsx` | Main client page and UI orchestration |
| `frontend/components/trials/SearchForm.tsx` | Search form and quick condition filters |
| `frontend/components/trials/TrialList.tsx` | Results list and load-more action |
| `frontend/components/trials/TrialSiteMap.tsx` | Map, summary counters, and site list |
| `frontend/components/physicians/PhysicianPanel.tsx` | Physician search results and suggested specialists |
| `frontend/components/physicians/PhysicianCard.tsx` | Individual physician detail card |
| `frontend/components/physicians/PhysicianMap.tsx` | Physician location map with radius control |
| `frontend/components/shared/LeadCaptureModal.tsx` | Lead capture form modal |
| `frontend/hooks/useTrials.ts` | Client data fetching and trial pagination state |
| `frontend/hooks/usePhysicians.ts` | Client data fetching for physician search with auto-relax tracking |
| `frontend/lib/api.ts` | Typed API client for all backend endpoints |
| `frontend/lib/validation.ts` | Client-side input validation |
| `frontend/types/trial.ts` | Trial and site TypeScript interfaces |
| `frontend/types/physician.ts` | Physician and search result TypeScript interfaces |
| `docs/` | Project documentation and embedded diagrams |

## Frontend Design

### Primary Components

| Component | Responsibility |
| --- | --- |
| `SearchForm` | Collect the required condition and optional filters (with 1000+ validated city/state pairs) |
| `useTrials` | Execute trial search requests, track loading and pagination state, handle client-side sorting |
| `TrialList` | Render the trial cards and load-more control with status highlighting |
| `TrialSiteMap` | Render site metrics, map markers, legend, and location cards with status-based colors |
| `PhysicianPanel` | Manage physician search state including radius control, auto-relax tracking, and suggested specialists |
| `PhysicianCard` | Display individual physician details with NPI, specialty, address, and distance |
| `PhysicianMap` | Interactive map showing physician locations with radius control slider (5-100 miles) |
| `usePhysicians` | Execute physician search with auto-relax algorithm, handle specialty expansion, manage deduplication |
| `LeadCaptureModal` | Collect user information (name, email, phone, NPI) for lead capture and CRM integration |
| `page.tsx` | Coordinate filters, selected trial, physician search state, and detail panel visibility |

### Frontend Request Behavior

1. The user submits search criteria from `SearchForm`.
2. `page.tsx` stores the active filter set in local state.
3. `useTrials` calls `GET /api/trials/` using `condition`, filters, `limit`, and `offset`.
4. The results list updates with the returned trial page.
5. When the user selects a trial, `page.tsx` calls `fetchTrialSites`.
6. `TrialSiteMap` receives site data and renders map plus list views.

### Frontend Pagination Model

- The page size is fixed at 10 records.
- Additional pages are fetched incrementally rather than replacing the list.
- `totalCount` and `hasMore` are derived from backend pagination metadata.

## Backend Design

### FastAPI Application

`backend/main.py` creates the application and mounts three routers:
- Trials router under `/api/trials`
- Physicians router under `/api/physicians`
- Leads router under `/api/leads`

It also exposes `GET /health` for readiness checks. CORS is configured with explicit origins and regex patterns for production safety.

### Search Pipeline

`backend/api/trials.py` accepts query parameters and builds the filter object. `backend/services/clinicaltrials_api.py` is responsible for:

- Requesting study pages from ClinicalTrials.gov
- Applying advanced filtering gates (noise filter, domain synonym matching, status, phase, location normalization)
- Mapping the upstream payload into the app response model
- Normalizing strings for local filtering
- Applying phase, status, city, and state filters
- Returning a sliced result set plus total matched count

The current upstream fetch strategy uses:
- `DEFAULT_PAGE_SIZE = 100`
- `MAX_PAGES = 10`
- Local pagination through `limit` and `offset`

### Site Detail Pipeline

`GET /api/trials/{nct_id}/sites` loads one study detail record and extracts site-level locations. When a site does not include embedded coordinates, the backend builds a location string and passes it to `mapquest_api.py` for fallback geocoding. The response now includes multiple contacts (central contacts, overall officials, location-specific contacts).

### Physician Search Pipeline

`backend/api/physicians.py` provides two endpoints:

1. **`GET /api/physicians/search`** - Main physician discovery
   - Takes: latitude, longitude, radius, initial_specialty
   - Calls `backend/services/nppes.py` to query the NPPES registry
   - `nppes.py` uses `zip_database.py` to find all ZIPs within radius (+ 10-mile buffer)
   - Queries NPPES for each (ZIP, specialty) pair asynchronously (12 concurrent)
   - Geocodes missing physician addresses via Geoapify API with LRU caching
   - Calculates distance and sorts by proximity
   - Returns up to 10 physicians with NPI, name, address, distance, and filtering metadata

2. **`GET /api/physicians/suggested`** - Related specialists
   - Takes: initial_specialty
   - Returns up to 5 related specialties (from SPECIALTY_HIERARCHY)
   - Useful for showing alternative specialists to the user

**Auto-Relax Algorithm:**

If fewer than 5 physicians found:
- **Level 1**: Broaden to parent specialties via SPECIALTY_HIERARCHY
- **Level 2**: Try domain-specific fallbacks (specialty_hierarchy.py)
- **Level 3**: Fall back to Internal Medicine (catch-all)

Each level returns with a `filter_relaxed` flag to inform the UI.

### Condition-Specialty Mapping Pipeline

`GET /api/trials/condition/{condition}/specialties` maps trial conditions to medical specialties using a 4-pass algorithm in `backend/services/taxonomy.py`:

1. **Exact Match**: Direct lookup in CONDITION_MAP
2. **Prefix Match**: "Metastatic" → finds "Metastatic High Grade Sarcoma"
3. **Substring Match**: Multi-word trial conditions (NEW in V4)
4. **Token Overlap**: Partial token-level matches (NEW in V4)

Handles multi-condition inputs (comma/and-separated). Results are cached for 24 hours.

### Lead Capture Pipeline

`backend/api/leads.py` accepts POST requests with:
- Name, Email, Phone (required)
- NPI, Trial ID, Site, Message (optional)

The system:
1. Validates email format
2. Stores lead in `backend/data/leads.json` (persistent JSON array)
3. If SF_OID configured, pushes to Salesforce Web-to-Lead form
4. Maps NPI to Salesforce custom field for provider tracking
5. Always persists locally even if Salesforce push fails

## Request Lifecycles

![Search and site detail request flow](assets/technical-request-flow.svg)

*Figure 2. Search and site-detail request lifecycles across the browser, frontend, backend, and external services.*

### Search Request Lifecycle

1. The browser submits search filters.
2. The frontend constructs `GET /api/trials/?condition=...`.
3. The backend queries ClinicalTrials.gov with `query.cond`.
4. The backend maps and filters returned studies (applying all gates).
5. The backend returns `trials` plus `pagination`.
6. The frontend updates the results list and `hasMore` state.

### Site Detail Request Lifecycle

1. The user selects a trial from the list.
2. The frontend requests `GET /api/trials/{nct_id}/sites`.
3. The backend fetches study detail from ClinicalTrials.gov.
4. The backend uses embedded coordinates when available.
5. The backend geocodes missing coordinates through MapQuest or Geoapify.
6. The frontend renders the site map and the full location list.

### Physician Search Request Lifecycle

1. The user selects a trial site and clicks "Find Physicians".
2. The frontend requests condition-specialty mapping: `GET /api/trials/condition/{condition}/specialties`.
3. The backend returns matched specialties using 4-pass algorithm.
4. The frontend requests physician search: `GET /api/physicians/search?lat=...&lng=...&radius=...&specialty=...`.
5. The backend queries ZIP codes within radius via `zip_database.py`.
6. The backend queries NPPES registry for each ZIP/specialty pair (async, 12 concurrent).
7. The backend geocodes missing physician addresses.
8. The backend calculates distances and sorts by proximity.
9. If fewer than 5 results, the backend auto-relaxes to parent specialties (Level 1→2→3).
10. The backend returns up to 10 physicians with filter metadata.
11. The frontend displays physicians on map and in list with auto-relax notification.

### Lead Capture Request Lifecycle

1. The user clicks "Express Interest" for a trial and/or physician.
2. A modal form appears, pre-populated with trial ID or physician NPI if applicable.
3. The user enters name, email, phone, and optional NPI.
4. The frontend submits: `POST /api/leads` with the form data.
5. The backend validates email format.
6. The backend stores the lead in `backend/data/leads.json`.
7. If Salesforce integration enabled (SF_OID set), the backend submits to Salesforce Web-to-Lead.
8. The backend returns success status to the frontend.
9. The frontend displays confirmation message.
10. Research coordinators receive notification for follow-up (via Salesforce or manual review).

## API Surface

### `GET /health`

| Attribute | Value |
| --- | --- |
| Purpose | Health or readiness check |
| Response | `{"status": "ok"}` |

### `GET /api/trials/`

| Parameter | Required | Notes |
| --- | --- | --- |
| `condition` | Yes | Main search term |
| `city` | No | Optional local filter |
| `state` | No | Optional local filter |
| `status` | No | Optional local filter |
| `phase` | No | Optional local filter |
| `limit` | No | Defaults to 10 in frontend usage |
| `offset` | No | Used for pagination |

Example response:

```json
{
  "condition": "Diabetes",
  "trials": [
    {
      "nctId": "NCT00000000",
      "title": "Example Trial",
      "status": "RECRUITING",
      "description": "Example summary",
      "conditions": ["Diabetes"],
      "sponsor": "Example Sponsor",
      "phases": ["PHASE1"],
      "locations": []
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 1,
    "page": 1,
    "has_more": false
  }
}
```

### `GET /api/trials/{nct_id}/sites`

| Attribute | Value |
| --- | --- |
| Purpose | Return site locations for one study |
| Key identifier | `nct_id` |
| Output | Title, study status, and list of site objects |

Example response:

```json
{
  "nctId": "NCT00000000",
  "title": "Example Trial",
  "status": "RECRUITING",
  "sites": [
    {
      "facility": "Example Hospital",
      "city": "Boston",
      "state": "MA",
      "country": "United States",
      "status": "RECRUITING",
      "lat": 42.36,
      "lon": -71.05
    }
  ]
}
```

### `GET /api/trials/condition/{condition}/specialties`

| Attribute | Value |
| --- | --- |
| Purpose | Map a trial condition to medical specialties |
| Path Parameter | `{condition}` - The trial condition name |
| Cache | 24 hours (HTTP public) |

Uses 4-pass resolution algorithm: exact → prefix → substring → token overlap. Handles multi-condition inputs (comma/and-separated).

Example response:

```json
{
  "condition": "Metastatic Breast Cancer",
  "specialties": ["Medical Oncology", "Surgical Oncology", "Radiology"]
}
```

### `GET /api/trials/cities-by-state`

| Attribute | Value |
| --- | --- |
| Purpose | List validated US cities indexed by state |
| Response | `{"AL": ["Birmingham", "Montgomery", ...], "AK": [...], ...}` |
| Cache | 30 days (HTTP public) |

### `GET /api/trials/validate-city-state`

| Parameter | Required | Notes |
| --- | --- | --- |
| `city` | Yes | City name |
| `state` | Yes | Two-letter state code |

Response: `{"isValid": true/false}`

### `GET /api/physicians/search`

| Parameter | Required | Notes |
| --- | --- | --- |
| `lat` | Yes | Latitude of search center |
| `lng` | Yes | Longitude of search center |
| `radius` | Yes | Search radius in miles (5, 10, 25, 50, 100) |
| `initial_specialty` | Yes | Medical specialty to search for |

Returns up to 10 physicians with NPI, name, address, distance. Includes auto-relax metadata and total result count. Suggested related specialties (up to 5) included in response.

Example response:

```json
{
  "physicians": [
    {
      "npi": "1234567890",
      "name": "Dr. John Smith",
      "specialty": "Medical Oncology",
      "address": "123 Main St, Boston, MA 02108",
      "distance_miles": 2.5
    }
  ],
  "suggested_specialties": ["Surgical Oncology", "Hematology"],
  "filter_relaxed": false,
  "total_count": 8,
  "zips_searched": 12
}
```

### `GET /api/physicians/suggested`

| Parameter | Required | Notes |
| --- | --- | --- |
| `specialty` | Yes | Medical specialty to find related specialties for |

Returns up to 5 related specialties from SPECIALTY_HIERARCHY.

### `POST /api/leads`

| Parameter | Required | Notes |
| --- | --- | --- |
| `name` | Yes | Full name |
| `email` | Yes | Email address (validated) |
| `phone` | Yes | Phone number |
| `npi` | No | NPI if healthcare provider |
| `trial_id` | No | NCT ID if related to trial |
| `site` | No | Trial site location |
| `message` | No | Optional additional information |

Response: `{"status": "success", "lead_id": "uuid"}`

Side effects: Stores in `backend/data/leads.json` and optionally pushes to Salesforce if SF_OID configured.

## Data Contracts

### Trial Model

| Field | Type | Notes |
| --- | --- | --- |
| `nctId` | string | Study identifier |
| `title` | string | Brief title |
| `status` | string | Overall study status |
| `description` | string or null | Brief summary |
| `conditions` | string[] | Conditions list |
| `sponsor` | string or null | Lead sponsor |
| `phases` | string[] | Study phase list |
| `locations` | TrialLocation[] | Returned location list |
| `inclusionCriteria` | string or undefined | Harvested from ClinicalTrials.gov when available |
| `exclusionCriteria` | string or undefined | Harvested from ClinicalTrials.gov when available |
| `contacts` | Contact[] | Array of central and site-specific contacts |
| `pointOfContact` | Contact or null | Backwards compatibility alias to contacts[0] |

### Contact Model

| Field | Type |
| --- | --- |
| `name` | string or null |
| `email` | string or null |
| `phone` | string or null |
| `title` | string or null |

### Physician Search Result Model

| Field | Type |
| --- | --- |
| `npi` | string |
| `name` | string |
| `specialty` | string |
| `address` | string |
| `distance_miles` | number |

### Lead Model

| Field | Type |
| --- | --- |
| `id` | string (UUID) |
| `name` | string |
| `email` | string |
| `phone` | string |
| `npi` | string or null |
| `trial_id` | string or null |
| `site` | string or null |
| `message` | string or null |
| `created_at` | ISO datetime |
| `salesforce_push_status` | "pending" \| "success" \| "failed" |

### Trial Location Model

| Field | Type |
| --- | --- |
| `facility` | string or null |
| `city` | string or null |
| `state` | string or null |
| `country` | string or null |
| `status` | string or null |
| `lat` | number or null |
| `lon` | number or null |

## Configuration

### Frontend Environment Variables

| Variable | Purpose | Required |
| --- | --- | --- |
| `API_URL` | Preferred backend URL for Next.js rewrite proxying | No |
| `NEXT_PUBLIC_API_URL` | Optional direct browser-visible backend URL | No |
| `NEXT_PUBLIC_MAPQUEST_KEY` | Browser-side key required for map rendering | Yes (for map) |

### Backend Environment Variables

| Variable | Purpose | Required |
| --- | --- | --- |
| `MAPQUEST_API_KEY` | Server-side key used for fallback geocoding | Yes |
| `GEOAPIFY_API_KEY` | Geoapify key for physician address geocoding (NPPES) | Yes (for physician search) |
| `SF_OID` | Salesforce Organization ID for Web-to-Lead integration | No |
| `FRONTEND_URL` | Frontend origin for CORS configuration | No (defaults to localhost) |
| `DEBUG_SECRET` | Secret key for debug endpoints (optional, unsafe for production) | No |
| `RATE_LIMIT_REQUESTS` | Requests per time window (default: 100) | No |
| `RATE_LIMIT_WINDOW_SECONDS` | Time window for rate limiting (default: 3600) | No |

## Deployment Model

- Frontend is intended to deploy from `frontend/` on Vercel.
- Backend is intended to deploy as a Render web service.
- Next.js rewrites can proxy `/api/*` and `/health` to the backend.
- The frontend can run locally against `http://localhost:8000` in development.

## Operational Notes

- The map requires browser access to the MapQuest JS SDK.
- The backend depends on ClinicalTrials.gov, MapQuest, Geoapify, NPPES, and optional Salesforce availability.
- Physician search is cached via LRU cache for NPPES queries (reduces API calls).
- Lead capture data persists in `backend/data/leads.json` (local JSON file).
- If Salesforce integration fails, leads are still stored locally and can be manually synced.
- The ZIP database service indexes ~1000+ US cities for efficient radius queries.
- NPPES queries run asynchronously (12 concurrent) for performance.
- The project currently has a basic persistence layer (JSON files for leads).
- The project currently has no automated test suite in the repository.

## Technical Risks And Limitations

- The 10-page upstream cap can undercount deeper result sets for broad conditions.
- Local post-fetch filtering means upstream queries are not fully optimized for all filters.
- CORS configuration is now more restrictive (explicit origins) but should be tightened further for production.
- Some studies may return partial site coordinates, leaving the list more complete than the map.
- Physician search depends on NPPES data accuracy and coverage (may miss newly registered providers).
- Auto-relax algorithm may broaden search results significantly if initial specialty returns few physicians.
- Rate limiting is configured but not currently enforced in middleware.
- Specialty mapping uses static CONDITION_MAP and SPECIALTY_HIERARCHY (requires manual updates for new conditions).
- Salesforce integration is fragile if fields or API endpoints change.
- Lead capture has no deduplication logic (same user can submit multiple times).

## Recommended Next Improvements

1. Implement and enforce rate limiting middleware.
2. Add comprehensive automated test suite (unit, integration, E2E).
3. Degrade gracefully when external APIs (Geoapify, Salesforce) are unavailable.
4. Implement lead deduplication logic (email-based).
5. Add structured logging and monitoring for all external API calls.
6. Create database layer for leads (replace JSON file with proper DB).
7. Add Redis caching layer for NPPES and condition-specialty queries.
8. Improve upstream query strategy to reduce reliance on post-fetch filtering.
9. Enable GitHub Actions CI/CD for automated testing and deployment.
10. Add TypeScript strict mode and comprehensive type coverage.
