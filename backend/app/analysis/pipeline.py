"""
Main analysis pipeline: orchestrates all sub-modules to produce a single
AnalysisResult for a given audio file.

All models are loaded lazily as singletons on first use.
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import librosa
import numpy as np

from app.config import SAMPLE_RATE
from app.schemas import AnalysisResult

from app.analysis.acoustic import extract_features
from app.analysis.transcription import transcribe
from app.analysis.emotion_model import classify_audio_emotion, classify_text_emotion, classify_acoustic_emotion, classify_dimensional_emotion, EmotionPrediction
from app.analysis.noise import analyze_noise
from app.analysis.quality import assess_quality
from app.analysis.ensemble import build_result
from app.analysis.diarization import diarize_call

logger = logging.getLogger(__name__)

# Supported audio extensions
SUPPORTED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".wma", ".aac", ".webm", ".mp4", ".mpeg"}


def analyze_audio_file(file_path: str | Path) -> tuple[AnalysisResult, dict]:
    """
    Run the full analysis pipeline on a single audio file.

    Args:
        file_path: Path to an audio file (WAV, MP3, etc.).

    Returns:
        Tuple of (AnalysisResult, detail_dict) where detail_dict contains
        transcript, per-model scores, quality issues, and speaker turns.

    Raises:
        ValueError: If the file format is unsupported or the file is too short.
    """
    file_path = Path(file_path)
    t0 = time.time()

    # Validate file
    if file_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported audio format: {file_path.suffix}")

    logger.info("Analyzing: %s", file_path.name)

    # Load and preprocess
    audio, sr = _load_audio(file_path)
    logger.info("  Loaded: %.1f sec, %d Hz", len(audio) / sr, sr)

    if len(audio) < sr * 0.5:
        raise ValueError("Audio too short (< 0.5 seconds)")

    # Parallel — Whisper, acoustic features, Wav2Vec2
    logger.info("  Running transcription, acoustic extraction, and audio emotion in parallel...")
    t_step = time.time()
    with ThreadPoolExecutor(max_workers=4) as executor:
        future_transcript = executor.submit(transcribe, audio, sr)
        future_acoustic = executor.submit(extract_features, audio, sr)
        future_audio_emotion = executor.submit(classify_audio_emotion, audio, sr)
        future_dim_emotion = executor.submit(classify_dimensional_emotion, audio, sr)

        transcript = future_transcript.result()
        acoustic_feat = future_acoustic.result()
        audio_emotion = future_audio_emotion.result()
        dim_emotion = future_dim_emotion.result()
    parallel_sec = round(time.time() - t_step, 2)

    logger.info("  Language: %s (%.0f%%), Transcript: %s",
                transcript.language, transcript.language_probability * 100,
                transcript.text[:80] + "..." if len(transcript.text) > 80 else transcript.text)
    logger.info("  Audio emotion: %s (%.2f)", audio_emotion.label, audio_emotion.score)

    # Speaker diarization — separate agent from customer
    logger.info("  Separating speakers...")
    t_step = time.time()
    diarization = diarize_call(audio, sr, transcript.word_timestamps)
    diarization_sec = round(time.time() - t_step, 2)
    logger.info("  Customer text: %s", diarization.customer_text[:80] + "..." if len(diarization.customer_text) > 80 else diarization.customer_text)

    customer_text = diarization.customer_text if diarization.customer_text else transcript.text

    # Re-score emotion on customer-only audio when diarization found 2 speakers
    if diarization.num_speakers == 2 and len(diarization.customer_audio) >= sr * 2:
        customer_emotion = classify_audio_emotion(diarization.customer_audio, sr)
        blended = {
            k: 0.7 * customer_emotion.all_scores.get(k, 0) + 0.3 * audio_emotion.all_scores.get(k, 0)
            for k in set(customer_emotion.all_scores) | set(audio_emotion.all_scores)
        }
        top = max(blended, key=lambda k: blended[k])
        audio_emotion = EmotionPrediction(label=top, score=float(blended[top]), all_scores=blended)
        logger.info("  Customer-only emotion: %s (%.2f)", audio_emotion.label, audio_emotion.score)

    # Remaining classifiers (sequential — need outputs above)
    t_step = time.time()
    acoustic_emotion = classify_acoustic_emotion(acoustic_feat)
    logger.info("  Acoustic emotion: %s (%.2f)", acoustic_emotion.label, acoustic_emotion.score)

    text_emotion = classify_text_emotion(customer_text)
    logger.info("  Text emotion: %s (%.2f)", text_emotion.label, text_emotion.score)

    noise_result = analyze_noise(audio, sr, acoustic_feat)
    quality_result = assess_quality(audio, sr, acoustic_feat)
    classifiers_sec = round(time.time() - t_step, 2)

    # Supplement overlap detection using diarization
    if len(diarization.segments) >= 3:
        short_gap_count = 0
        for i in range(1, len(diarization.segments)):
            gap = diarization.segments[i].start_sec - diarization.segments[i-1].end_sec
            if gap < 0.3 and diarization.segments[i].speaker != diarization.segments[i-1].speaker:
                short_gap_count += 1
        if short_gap_count >= 2:
            acoustic_feat.speaker_overlap_detected = True

    # Ensemble
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
        dim_emotion=dim_emotion,
    )

    logger.info("  Result: tone=%s, intensity=%s, noise=%s, quality=%s, confidence=%.2f",
                result.emotional_tone.value,
                result.emotional_intensity.value,
                result.background_noise_severity.value,
                result.audio_quality.value,
                result.confidence)

    detail = {
        "transcript": transcript.text,
        "language": transcript.language,
        "duration_sec": round(len(audio) / sr, 1),
        "processing_time_sec": round(time.time() - t0, 1),
        "stage_timings": {
            "parallel_sec": parallel_sec,
            "diarization_sec": diarization_sec,
            "classifiers_sec": classifiers_sec,
        },
        "audio_emotion": audio_emotion.all_scores,
        "text_emotion": text_emotion.all_scores,
        "acoustic_emotion": acoustic_emotion.all_scores,
        "dim_emotion": dim_emotion.all_scores,
        "quality_issues": quality_result.issues,
        "snr_db": round(acoustic_feat.snr_db, 1) if hasattr(acoustic_feat, 'snr_db') and acoustic_feat.snr_db else None,
        "speaking_rate_wpm": transcript.speaking_rate_wpm,
        "num_speakers": diarization.num_speakers,
        "speaker_turns": [
            {"speaker": s.speaker, "start": round(s.start_sec, 1), "end": round(s.end_sec, 1), "text": s.text}
            for s in diarization.segments
        ],
    }

    return result, detail


def _load_audio(file_path: Path) -> tuple[np.ndarray, int]:
    """
    Load any supported audio file and convert to 16 kHz mono float32.
    Uses librosa which internally handles WAV, FLAC, and (via soundfile/ffmpeg) MP3.
    """
    audio, sr = librosa.load(str(file_path), sr=SAMPLE_RATE, mono=True)
    return audio.astype(np.float32), sr
