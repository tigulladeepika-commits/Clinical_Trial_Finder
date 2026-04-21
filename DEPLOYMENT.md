# Deployment

## Frontend on Vercel

1. Import this repository into Vercel.
2. Set the project Root Directory to `frontend`.
3. Add these environment variables in Vercel:
   - `API_URL=https://your-render-service.onrender.com`
   - `NEXT_PUBLIC_MAPQUEST_KEY=...`
4. Deploy.

`API_URL` is the preferred setup because Next.js rewrites proxy `/api/*` requests to Render without exposing the backend URL to the browser.

## Backend on Render

1. Create a new Blueprint on Render from this repository, or create a web service manually using:
   - Build Command: `pip install -r backend/requirements.txt`
   - Start Command: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
2. Add environment variables:
   - `MAPQUEST_API_KEY=...`
3. Confirm the service health endpoint returns `200` at `/health`.

If you use the Vercel `API_URL` rewrite setup, the frontend can call `/api/*` through Vercel without exposing the backend URL to the browser.

The current backend implementation uses permissive CORS (`allow_origins=["*"]`). If you want stricter origin controls for production, update `backend/main.py` before deployment.
