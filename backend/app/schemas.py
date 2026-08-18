"""
Pydantic models matching the required output schema and API request/response shapes.
Enum values and field types follow the spec exactly.
"""

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ── Output enums (must match spec exactly) ─────────────────────────────────────

class EmotionalTone(str, Enum):
    NEUTRAL = "neutral"
    SATISFIED = "satisfied"
    FRUSTRATED = "frustrated"
    UPSET = "upset"
    DISTRESSED = "distressed"


class EmotionalIntensity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class BackgroundNoiseSeverity(str, Enum):
    NONE = "none"
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class AudioQuality(str, Enum):
    CLEAR = "clear"
    SLIGHTLY_IMPAIRED = "slightly_impaired"
    SEVERELY_IMPAIRED = "severely_impaired"


# ── Core analysis result (returned per audio clip) ────────────────────────────

class AnalysisResult(BaseModel):
    emotional_tone: EmotionalTone
    emotional_intensity: EmotionalIntensity
    background_noise_present: bool
    background_noise_type: str = ""
    background_noise_severity: BackgroundNoiseSeverity
    audio_quality: AudioQuality
    speaker_overlap_present: bool
    long_silence_present: bool
    confidence: float = Field(ge=0.0, le=1.0)


# ── Authentication ─────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── Batch tracking ─────────────────────────────────────────────────────────────

class BatchStatusResponse(BaseModel):
    id: int
    status: str
    total_files: int
    processed_files: int
    failed_files: int
    created_at: str


class FileResultResponse(BaseModel):
    filename: str
    status: str
    result: Optional[AnalysisResult] = None
    error: Optional[str] = None
