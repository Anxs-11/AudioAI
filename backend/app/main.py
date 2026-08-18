"""
FastAPI application entry point.

Sets up:
  - CORS middleware (for frontend dev server).
  - Database initialization and default admin user creation.
  - Router registration for auth and batch endpoints.
  - Static file serving for the production frontend build.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from app.auth import hash_password
from app.config import DEFAULT_PASSWORD, DEFAULT_USERNAME
from app.database import async_session, init_db
from app.models import User
from app.routers import auth_router, batch_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: create tables and seed the default admin user."""
    await init_db()

    async with async_session() as db:
        result = await db.execute(select(User).where(User.username == DEFAULT_USERNAME))
        if result.scalar_one_or_none() is None:
            admin = User(
                username=DEFAULT_USERNAME,
                hashed_password=hash_password(DEFAULT_PASSWORD),
            )
            db.add(admin)
            await db.commit()
            logger.info("Created default admin user: %s", DEFAULT_USERNAME)

    logger.info("Voice Analyzer API ready.")
    yield
    logger.info("Shutting down.")


app = FastAPI(
    title="AutoAce Voice Analyzer",
    description="Emotional tone and background noise analysis for production call audio.",
    version="1.0.0",
    lifespan=lifespan,
)

# ── CORS (allow frontend dev server) ──────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(auth_router.router)
app.include_router(batch_router.router)

# ── Serve frontend static build (if it exists) ────────────────────────────────
frontend_build = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if frontend_build.is_dir():
    app.mount("/", StaticFiles(directory=str(frontend_build), html=True), name="frontend")
