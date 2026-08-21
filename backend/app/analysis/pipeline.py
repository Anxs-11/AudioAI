"""
Main analysis pipeline: orchestrates all sub-modules to produce a single
AnalysisResult for a given audio file.

Pipeline flow:
  ┌──────────────────────────────────────────────────────────────────────┐
  │  1. Load & preprocess audio  (→ 16 kHz mono float32)               │
  │  2. Run in parallel:                                               │
  │       a. Whisper transcription → text                              │
  │       b. Acoustic feature extraction (librosa)                     │
  │  3. Run emotion classifiers:                                       │
  │       a. Audio emotion  (wav2vec2 on waveform)                     │
  │       b. Text emotion   (distilRoBERTa on transcript)              │
  │  4. Background noise analysis  (from acoustic features)            │
  │  5. Audio quality assessment   (from acoustic features + signal)   │
  │  6. Ensemble → final AnalysisResult                                │
  └──────────────────────────────────────────────────────────────────────┘

All models are loaded lazily as singletons on first use.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import librosa
import numpy as np

from app.config import SAMPLE_RATE
from app.schemas import AnalysisResult

from app.analysis.acoustic import extract_features
from app.analysis.transcription import transcribe
from app.analysis.emotion_model import classify_audio_emotion, classify_text_emotion, classify_acoustic_emotion
from app.analysis.noise import analyze_noise
from app.analysis.quality import assess_quality
from app.analysis.ensemble import build_result
from app.analysis.diarization import diarize_call

logger = logging.getLogger(__name__)

# Supported audio extensions
SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".wma", ".aac", ".webm", ".mp4", ".mpeg"}


def analyze_audio_file(file_path: str | Path) -> AnalysisResult:
    """
    Run the full analysis pipeline on a single audio file.

    Args:
        file_path: Path to an audio file (WAV, MP3, etc.).

    Returns:
        AnalysisResult with all required output fields.

    Raises:
        ValueError: If the file format is unsupported or the file is too short.
        Exception:  Propagated from sub-modules on processing errors.
    """
    file_path = Path(file_path)

    # ── Validate file ──────────────────────────────────────────────────────
    if file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported audio format: {file_path.suffix}")

    logger.info("Analyzing: %s", file_path.name)

    # ── Step 1: Load and preprocess ────────────────────────────────────────
    audio, sr = _load_audio(file_path)
    logger.info("  Loaded: %.1f sec, %d Hz", len(audio) / sr, sr)

    if len(audio) < sr * 0.5:
        raise ValueError("Audio too short (< 0.5 seconds)")

    # ── Step 2: Parallel — Whisper, acoustic features, Wav2Vec2 ─────────
    logger.info("  Running transcription, acoustic extraction, and audio emotion in parallel...")
    with ThreadPoolExecutor(max_workers=3) as executor:
        future_transcript = executor.submit(transcribe, audio, sr)
        future_acoustic = executor.submit(extract_features, audio, sr)
        future_audio_emotion = executor.submit(classify_audio_emotion, audio, sr)

        transcript = future_transcript.result()
        acoustic_feat = future_acoustic.result()
        audio_emotion = future_audio_emotion.result()

    logger.info("  Language: %s (%.0f%%), Transcript: %s",
                transcript.language, transcript.language_probability * 100,
                transcript.text[:80] + "..." if len(transcript.text) > 80 else transcript.text)
    logger.info("  Audio emotion: %s (%.2f)", audio_emotion.label, audio_emotion.score)

    # ── Step 3: Speaker diarization — separate agent from customer ─────────
    logger.info("  Separating speakers...")
    diarization = diarize_call(audio, sr, transcript.word_timestamps)
    logger.info("  Customer text: %s", diarization.customer_text[:80] + "..." if len(diarization.customer_text) > 80 else diarization.customer_text)

    customer_text = diarization.customer_text if diarization.customer_text else transcript.text

    # ── Step 4: Remaining classifiers (sequential — need outputs above) ────
    acoustic_emotion = classify_acoustic_emotion(acoustic_feat)
    logger.info("  Acoustic emotion: %s (%.2f)", acoustic_emotion.label, acoustic_emotion.score)

    text_emotion = classify_text_emotion(customer_text)
    logger.info("  Text emotion: %s (%.2f)", text_emotion.label, text_emotion.score)

    noise_result = analyze_noise(audio, sr, acoustic_feat)
    quality_result = assess_quality(audio, sr, acoustic_feat)

    # ── Step 5: Supplement overlap detection using diarization ──────────────
    if len(diarization.segments) >= 3:
        short_gap_count = 0
        for i in range(1, len(diarization.segments)):
            gap = diarization.segments[i].start_sec - diarization.segments[i-1].end_sec
            if gap < 0.3 and diarization.segments[i].speaker != diarization.segments[i-1].speaker:
                short_gap_count += 1
        if short_gap_count >= 2:
            acoustic_feat.speaker_overlap_detected = True

    # ── Step 9: Ensemble ─────────────────────────────────────────────────
    logger.info("  Building ensemble result...")
    result = build_result(
        audio_emotion=audio_emotion,
        text_emotion=text_emotion,
        acoustic_emotion=acoustic_emotion,
        acoustic_feat=acoustic_feat,
        noise_result=noise_result,
        quality_result=quality_result,
        transcript=transcript,
        customer_text=customer_text,
    )

    logger.info("  Result: tone=%s, intensity=%s, noise=%s, quality=%s, confidence=%.2f",
                result.emotional_tone.value,
                result.emotional_intensity.value,
                result.background_noise_severity.value,
                result.audio_quality.value,
                result.confidence)

    return result


def _load_audio(file_path: Path) -> tuple[np.ndarray, int]:
    """
    Load any supported audio file and convert to 16 kHz mono float32.
    Uses librosa which internally handles WAV, FLAC, and (via soundfile/ffmpeg) MP3.
    """
    audio, sr = librosa.load(str(file_path), sr=SAMPLE_RATE, mono=True)
    return audio.astype(np.float32), sr
