"""
SQLAlchemy ORM models for users, batches, and per-file results.
"""

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(150), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)

    batches = relationship("Batch", back_populates="user")


class Batch(Base):
    __tablename__ = "batches"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String(20), default="pending")  # pending | processing | completed | failed
    total_files = Column(Integer, default=0)
    processed_files = Column(Integer, default=0)
    failed_files = Column(Integer, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    user = relationship("User", back_populates="batches")
    results = relationship("FileResult", back_populates="batch", cascade="all, delete-orphan")


class FileResult(Base):
    __tablename__ = "file_results"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=False)
    filename = Column(String(500), nullable=False)
    status = Column(String(20), default="pending")  # pending | processing | completed | failed
    result_json = Column(Text, nullable=True)        # JSON string of AnalysisResult
    detail_json = Column(Text, nullable=True)        # per-model scores, transcript, quality issues
    error = Column(Text, nullable=True)

    batch = relationship("Batch", back_populates="results")
