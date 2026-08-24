"""
Application configuration.
All settings are loaded from environment variables with sensible defaults for development.
"""

import os
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# ── JWT Authentication ─────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY", "autoace-dev-secret-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("TOKEN_EXPIRE_MINUTES", "480"))

if os.getenv("RAILWAY_ENVIRONMENT") and SECRET_KEY.startswith("autoace-dev"):
    import logging as _log
    _log.warning("SECRET_KEY not set — using dev default. Set SECRET_KEY env var for production.")

# ── Database ───────────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite+aiosqlite:///{BASE_DIR / 'voice_analyzer.db'}",
)

# ── Default admin account (override via env vars in production) ────────────────
DEFAULT_USERNAME = os.getenv("ADMIN_USERNAME", "autoace")
DEFAULT_PASSWORD = os.getenv("ADMIN_PASSWORD", "autoace2024")

# ── Audio & model settings ─────────────────────────────────────────────────────
WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "base")
SAMPLE_RATE = 16_000  # all audio is resampled to 16 kHz mono

# ── Model identifiers (HuggingFace) ───────────────────────────────────────────
AUDIO_EMOTION_MODEL = "superb/wav2vec2-base-superb-er"
TEXT_EMOTION_MODEL = "j-hartmann/emotion-english-distilroberta-base"
DIMENSIONAL_EMOTION_MODEL = "audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim"

# ── Thresholds (tunable with labeled data) ─────────────────────────────────────
LONG_SILENCE_THRESHOLD_SEC = 5.0   # pauses longer than this → long_silence_present
OVERLAP_ENERGY_RATIO = 2.0         # energy spike ratio hinting at speaker overlap
SNR_HIGH_NOISE_DB = 5.0            # SNR below this → high noise severity
SNR_MEDIUM_NOISE_DB = 15.0         # SNR below this → medium noise severity
SNR_LOW_NOISE_DB = 25.0            # SNR below this → low noise severity
