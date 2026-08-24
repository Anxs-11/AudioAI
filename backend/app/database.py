"""
Async SQLite database setup using SQLAlchemy 2.0+ async engine.
"""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import DATABASE_URL

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency that yields a database session."""
    async with async_session() as session:
        yield session


async def init_db():
    """Create all tables on startup and add missing columns for schema upgrades."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Add detail_json column if missing (schema upgrade from earlier version)
        try:
            await conn.execute(__import__("sqlalchemy").text(
                "ALTER TABLE file_results ADD COLUMN detail_json TEXT"
            ))
        except Exception:
            pass  # column already exists
