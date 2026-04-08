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

app = FastAPI(title="Clinical Trial Locator API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(trials_router, prefix="/api/trials", tags=["trials"])


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}