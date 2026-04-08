import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

try:
    from .trials import router as trials_router
except ImportError:
    from trials import router as trials_router

load_dotenv(Path(__file__).with_name(".env"))


def _parse_csv_env(name: str) -> list[str]:
    value = os.getenv(name, "")
    return [item.strip().rstrip("/") for item in value.split(",") if item.strip()]


default_cors_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
cors_origins = _parse_csv_env("CORS_ORIGINS") or default_cors_origins
cors_origin_regex = os.getenv("CORS_ORIGIN_REGEX") or None

app = FastAPI(title="Clinical Trial Locator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trials_router, prefix="/api/trials", tags=["trials"])


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
