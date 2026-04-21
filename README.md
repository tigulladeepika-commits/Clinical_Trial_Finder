# Clinical Trial Finder

Clinical Trial Finder is a two-tier web application for searching ClinicalTrials.gov studies and viewing site locations on an interactive map.

## Documentation

- [User Playbook](docs/USER_PLAYBOOK.md)
- [Functional Specification](docs/FUNCTIONAL_SPEC.md)
- [Technical Specification](docs/TECHNICAL_SPEC.md)
- [Deployment Notes](DEPLOYMENT.md)

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
