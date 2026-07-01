# ClinTrial Navigator

A two-tier web application for searching ClinicalTrials.gov studies, finding nearby specialist physicians, and exploring AI-enriched physician research insights.

**Live URLs:**
- Frontend: Vercel (auto-deploys on push to `main`)
- Backend: `https://clinical-trial-finder.onrender.com` (auto-deploys on push to `main`)

---

## Architecture

```
Frontend (Next.js/TypeScript) — Vercel
        ↓ REST API calls
Backend (FastAPI/Python) — Render free tier
        ↓
┌─────────────────────────────────────────────┐
│  External APIs                              │
│  ClinicalTrials.gov — trial search/sites    │
│  NPPES — physician NPI lookup               │
│  PubMed — primary publication source        │
│  EuropePMC — secondary publication source   │
│  Semantic Scholar (S2) — author disambig.   │
│  Groq AI — publication verification + AI   │
│             summary (3-model fallback)      │
│  MapQuest — map tiles                       │
│  Salesforce — lead capture (optional)       │
└─────────────────────────────────────────────┘
```

---

## Key Backend Files

```
backend/
├── main.py                          # FastAPI entry point, all route definitions
├── services/
│   ├── physician_insights_service.py # Main enrichment orchestrator (Steps 1-6)
│   ├── publication_verifier.py       # Groq AI title verification (3-model fallback)
│   ├── pubmed_service.py             # PubMed author search + disambiguation
│   ├── europepmc_service.py          # EuropePMC fallback publication source
│   ├── semantic_scholar_service.py   # S2 author ID matching + affiliation verify
│   ├── background_enrichment.py      # Async batch enrichment (staggered, semaphore)
│   ├── ai_cache_service.py           # In-memory cache keyed by (npi, disease)
│   ├── ai_search_service.py          # Groq-powered search spell correction
│   ├── clinicaltrials_api.py         # ClinicalTrials.gov API wrapper
│   ├── nppes.py                      # NPPES NPI registry lookup
│   ├── taxonomy.py                   # NUCC taxonomy + specialty resolution
│   ├── citations_cache.py            # Citation count caching
│   ├── mapquest_api.py               # MapQuest geocoding
│   └── salesforce.py                 # Salesforce Web-to-Lead integration
```

## Key Frontend Files

```
frontend/
├── app/
│   └── page.tsx                     # Main page — search, results, physician panel
├── components/
│   ├── physicians/
│   │   ├── PhysicianMap.tsx         # Leaflet map (inline + modal), clustering, flyTo
│   │   ├── PhysicianPanel.tsx       # Physician list panel with map integration
│   │   ├── PhysicianCard.tsx        # Individual physician card with data-npi attr
│   │   ├── PhysicianDetailPanel.tsx # Full physician detail view
│   │   └── AIInsightsView.tsx       # AI Summary + Verified Publications display
│   └── trials/
│       └── TrialSiteMap.tsx         # Trial site map (Leaflet + MapQuest)
└── lib/
    └── api.ts                       # All API call functions
```

---

## Enrichment Pipeline (physician_insights_service.py)

```
Step 1: PubMed search by name + specialty (confidence scored)
Step 2: EuropePMC search (parallel)
Step 3: Semantic Scholar author ID match (parallel)
        → If S2 finds no author AND name is "common" AND PubMed conf < 85:
          strip papers with no affiliation (collision risk)
        → If PubMed conf >= 85: skip strip, defer to Groq verification
Step 4: Merge + deduplicate by PMID/title
Step 5: Groq AI title verification (3-model fallback chain)
        → openai/gpt-oss-120b (primary, 8K TPM)
        → openai/gpt-oss-20b  (fallback, separate rate limit)
        → llama-3.1-8b-instant (tertiary, highest availability)
        → keyword fallback (no AI, last resort)
Step 6: Groq AI summary generation (same 3-model fallback)
```

---

## Groq Model Configuration

All 3 files use the same constants:
```python
GROQ_MODEL = "openai/gpt-oss-120b"
GROQ_FALLBACK_MODELS = [
    "openai/gpt-oss-120b",   # primary  — 8K TPM free tier
    "openai/gpt-oss-20b",    # secondary — separate rate limit bucket
    "llama-3.1-8b-instant",  # tertiary  — 6K TPM, most available
]
```

Files using Groq:
- `backend/services/publication_verifier.py` — title verification
- `backend/services/physician_insights_service.py` — AI summary
- `backend/services/ai_search_service.py` — spell correction

---

## Cache Architecture

`ai_cache_service.py` — pure in-memory Python dict, keyed by `(npi, disease)`.
- **No TTL** — entries live until server restart (Render restart clears all)
- **No persistence** — resets on every deploy
- Used in `background_enrichment.py` lines 32-45

---

## Background Enrichment (background_enrichment.py)

- `_MAX_CONCURRENT = 2` — max 2 physicians enriched simultaneously
- `_ENRICH_DELAY = 3.0` — 3s stagger between physician start times
- Inner sleep: `2.5s` before each enrichment starts
- Called automatically when physician search results load

---

## Environment Variables (backend/.env)

```
GROQ_API_KEY=           # Required for AI features
NCBI_API_KEY=           # PubMed higher rate limits
MAPQUEST_KEY=           # Map tiles
SALESFORCE_*=           # Optional lead capture
```

---

## Known Issues / Active Work

### 1. `current_model` scoping bug in publication_verifier.py
The 3-model fallback loop uses `_current_model` as the loop variable but the
exception handler references `current_model` (missing underscore prefix),
causing `NameError` on the first two models and only the third model succeeds.

**File:** `backend/services/publication_verifier.py`
**Fix:** Replace `current_model` with `_current_model` in the except block.

### 2. Cache TTL missing in ai_cache_service.py
In-memory cache has no expiry. Stale enrichment results (e.g. wrong publication
counts from before bug fixes) get served indefinitely until server restart.

**File:** `backend/services/ai_cache_service.py`
**Fix:** Add 30-minute TTL — store `(data, timestamp)` tuples, check age on `get()`.

### 3. Wrong publications for Jingnan Han (NPI: 1134689219)
Still showing 11 wrong papers (ophthalmology, public health, social science)
despite those fields being in the Groq NO list. Root cause is issues #1 and #2
above — once fixed, Groq should correctly filter to ~9 cardiology papers.

### 4. Semantic Scholar (S2) rate limits
S2 free tier hits 429 on almost every batch. Retries with backoff (1s/2s/4s)
but often exhausts all 3 attempts. Non-critical — falls back to PubMed/EuropePMC.

---

## Local Development

### Backend
```powershell
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend
```powershell
cd frontend
npm install
npm run dev
```

### Environment Setup
1. Copy `backend/.env.example` to `backend/.env`
2. Add your API keys (GROQ_API_KEY, NCBI_API_KEY, MAPQUEST_KEY)
3. Never commit `backend/.env` to source control

---

## Git / Deployment

- **Repo:** `https://github.com/tigulladeepika-commits/Clinical_Trial_Finder`
- **Branch:** `main` — both Vercel and Render auto-deploy on push
- **Commit identity:** `tigulladeepika-commits` / `tigulladeepikawork@gmail.com`
- **Render:** free tier, spins down after inactivity (50s+ cold start)
- **Vercel:** always live, no cold start
