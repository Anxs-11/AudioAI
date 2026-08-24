"""
Speech-to-text transcription using faster-whisper (CTranslate2 backend).

Provides:
  - Full transcript text (used downstream for text-based emotion classification).
  - Word-level timestamps (used for speaking-rate and pause analysis).
  - Whisper metadata (no-speech probability, language detection).

The model is loaded lazily as a singleton to avoid repeated initialization.
"""

import logging
from dataclasses import dataclass, field

import numpy as np

logger = logging.getLogger(__name__)

# Lazy singleton — loaded on first call
_whisper_model = None


@dataclass
class TranscriptionResult:
    text: str = ""
    language: str = "en"
    language_probability: float = 0.0
    word_timestamps: list[dict] = field(default_factory=list)  # [{word, start, end}, ...]
    avg_no_speech_prob: float = 0.0
    speaking_rate_wpm: float = 0.0  # words per minute


def _get_model():
    """Lazy-load the Whisper model (singleton)."""
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        from app.config import WHISPER_MODEL_SIZE

        logger.info("Loading Whisper model '%s' ...", WHISPER_MODEL_SIZE)
        _whisper_model = WhisperModel(
            WHISPER_MODEL_SIZE,
            device="cpu",
            compute_type="int8",
        )
        logger.info("Whisper model loaded.")
    return _whisper_model


def transcribe(audio: np.ndarray, sr: int = 16_000) -> TranscriptionResult:
    """
    Transcribe audio using faster-whisper and return structured results.

    Args:
        audio: 1-D float32 array, mono, 16 kHz.
        sr:    Sample rate (must be 16000 for Whisper).

    Returns:
        TranscriptionResult with text, timestamps, and metadata.
    """
    model = _get_model()

    segments, info = model.transcribe(
        audio,
        beam_size=1,
        word_timestamps=True,
        vad_filter=True,
    )

    result = TranscriptionResult()
    result.language = info.language
    result.language_probability = info.language_probability

    all_text_parts = []
    no_speech_probs = []
    word_list = []

    for segment in segments:
        all_text_parts.append(segment.text)
        no_speech_probs.append(segment.no_speech_prob)

        if segment.words:
            for w in segment.words:
                word_list.append({
                    "word": w.word.strip(),
                    "start": w.start,
                    "end": w.end,
                })

    result.text = " ".join(all_text_parts).strip()
    result.word_timestamps = word_list
    result.avg_no_speech_prob = float(np.mean(no_speech_probs)) if no_speech_probs else 0.0

    # Speaking rate: words per minute
    if word_list and len(word_list) >= 2:
        total_speech_sec = word_list[-1]["end"] - word_list[0]["start"]
        if total_speech_sec > 0:
            result.speaking_rate_wpm = (len(word_list) / total_speech_sec) * 60

    return result
