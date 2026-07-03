# Clinical Trial Finder

Clinical Trial Finder is a two-tier web application for searching ClinicalTrials.gov studies, reviewing site locations on an interactive map, finding nearby specialist physicians, and exploring AI-enriched physician research insights.

## Documentation

- [User Playbook](docs/USER_PLAYBOOK.md)
- [Functional Specification](docs/FUNCTIONAL_SPEC.md)
- [Technical Specification](docs/TECHNICAL_SPEC.md)
- [Deployment Notes](DEPLOYMENT.md)

## What’s Included

- Trial search by condition with optional filters for city, state, phase, and status
- Paginated trial results with site detail and interactive mapping
- Physician discovery near selected trial sites with automatic specialty matching and radius controls
- Lead capture for trials and physicians with optional Salesforce Web-to-Lead integration
- AI physician enrichment that surfaces publication metrics, research areas, and concise physician summaries

## Local Development

### Backend

```powershell
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

### Environment

1. Copy `backend/.env.example` to `backend/.env`.
2. Populate the required API keys and deployment settings.
3. Configure `GROQ_API_KEY` if you want physician AI summaries.
4. For Salesforce Web-to-Lead, set `SF_OID`, `SF_RET_URL`, `SF_WEB_TO_LEAD_URL`, `SF_DEBUG_EMAIL`, `SF_NPI_FIELD`, `SF_SPECIALIZATION_FIELD`, and `SF_GENDER_IDENTITY_FIELD` as needed.
5. Set `DEBUG_SECRET` if you want to access the Salesforce debug endpoint.
6. Do not commit `backend/.env` to source control.

### Frontend

```powershell
cd frontend
npm install
npm run dev
```
