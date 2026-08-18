"""
Acoustic feature extraction using librosa.

Extracts objective, deterministic features from the audio waveform:
  - Pitch (F0) statistics
  - Energy / RMS statistics
  - Spectral centroid, bandwidth, flatness
  - MFCCs (mean & std of first 13 coefficients)
  - Zero-crossing rate
  - Speaking-rate proxy (voiced-frame density)
  - Silence segments (for long_silence_present detection)
  - Energy profile for speaker-overlap heuristic

These features feed into the ensemble and are also used directly
for background-noise severity, audio-quality, overlap, and silence fields.
"""

from dataclasses import dataclass, field

import librosa
import numpy as np

from app.config import LONG_SILENCE_THRESHOLD_SEC, OVERLAP_ENERGY_RATIO, SAMPLE_RATE


@dataclass
class AcousticFeatures:
    """Container for all extracted acoustic features."""
    # Pitch
    pitch_mean: float = 0.0
    pitch_std: float = 0.0
    pitch_range: float = 0.0

    # Energy
    rms_mean: float = 0.0
    rms_std: float = 0.0
    rms_max: float = 0.0

    # Spectral
    spectral_centroid_mean: float = 0.0
    spectral_bandwidth_mean: float = 0.0
    spectral_flatness_mean: float = 0.0
    zcr_mean: float = 0.0

    # MFCCs (mean of first 13 coefficients)
    mfcc_means: list[float] = field(default_factory=list)

    # Temporal
    duration_sec: float = 0.0
    voiced_ratio: float = 0.0  # fraction of frames that are voiced

    # Derived flags
    long_silence_detected: bool = False
    max_silence_duration_sec: float = 0.0
    speaker_overlap_detected: bool = False

    # Signal-to-noise ratio estimate
    snr_db: float = 40.0

    # Clipping ratio (fraction of samples at max amplitude)
    clipping_ratio: float = 0.0


def extract_features(audio: np.ndarray, sr: int = SAMPLE_RATE) -> AcousticFeatures:
    """
    Extract a comprehensive set of acoustic features from a mono audio signal.

    Args:
        audio: 1-D float32 numpy array (mono, already at target sample rate).
        sr:    Sample rate of the audio.

    Returns:
        AcousticFeatures dataclass with all computed values.
    """
    feat = AcousticFeatures()
    feat.duration_sec = len(audio) / sr

    if len(audio) < sr * 0.1:  # less than 100 ms → not enough data
        return feat

    # ── Pitch (F0) via pyin ────────────────────────────────────────────────
    f0, voiced_flag, _ = librosa.pyin(
        audio, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C7"), sr=sr,
    )
    voiced_f0 = f0[voiced_flag] if voiced_flag is not None else np.array([])
    if len(voiced_f0) > 0:
        feat.pitch_mean = float(np.nanmean(voiced_f0))
        feat.pitch_std = float(np.nanstd(voiced_f0))
        feat.pitch_range = float(np.nanmax(voiced_f0) - np.nanmin(voiced_f0))
    feat.voiced_ratio = float(np.mean(voiced_flag)) if voiced_flag is not None else 0.0

    # ── RMS energy ─────────────────────────────────────────────────────────
    rms = librosa.feature.rms(y=audio)[0]
    feat.rms_mean = float(np.mean(rms))
    feat.rms_std = float(np.std(rms))
    feat.rms_max = float(np.max(rms))

    # ── Spectral features ──────────────────────────────────────────────────
    feat.spectral_centroid_mean = float(np.mean(librosa.feature.spectral_centroid(y=audio, sr=sr)))
    feat.spectral_bandwidth_mean = float(np.mean(librosa.feature.spectral_bandwidth(y=audio, sr=sr)))
    feat.spectral_flatness_mean = float(np.mean(librosa.feature.spectral_flatness(y=audio)))
    feat.zcr_mean = float(np.mean(librosa.feature.zero_crossing_rate(audio)))

    # ── MFCCs ──────────────────────────────────────────────────────────────
    mfccs = librosa.feature.mfcc(y=audio, sr=sr, n_mfcc=13)
    feat.mfcc_means = [float(np.mean(mfccs[i])) for i in range(13)]

    # ── Silence detection ──────────────────────────────────────────────────
    feat.long_silence_detected, feat.max_silence_duration_sec = _detect_long_silence(
        rms, sr, hop_length=512,
    )

    # ── Speaker overlap heuristic ──────────────────────────────────────────
    feat.speaker_overlap_detected = _detect_overlap(rms)

    # ── SNR estimation ─────────────────────────────────────────────────────
    feat.snr_db = _estimate_snr(audio, sr)

    # ── Clipping detection ─────────────────────────────────────────────────
    feat.clipping_ratio = float(np.mean(np.abs(audio) > 0.99))

    return feat


# ── Private helpers ────────────────────────────────────────────────────────────

def _detect_long_silence(
    rms: np.ndarray,
    sr: int,
    hop_length: int = 512,
) -> tuple[bool, float]:
    """
    Find the longest contiguous run of low-energy frames.
    Returns (is_long_silence, max_silence_seconds).
    """
    threshold = np.percentile(rms, 10) * 1.5  # adaptive silence threshold
    is_silent = rms < max(threshold, 1e-6)

    max_run = 0
    current_run = 0
    for s in is_silent:
        if s:
            current_run += 1
            max_run = max(max_run, current_run)
        else:
            current_run = 0

    sec_per_frame = hop_length / sr
    max_silence_sec = max_run * sec_per_frame
    return max_silence_sec >= LONG_SILENCE_THRESHOLD_SEC, max_silence_sec


def _detect_overlap(rms: np.ndarray) -> bool:
    """
    Heuristic for speaker overlap detection.
    Looks for regions where energy is significantly above the local trend,
    combined with rapid energy fluctuations that indicate two voices.
    Calibrated: single emotional speaker (call_001) should NOT trigger,
    but two speakers talking over each other (call_002/003) should.
    """
    if len(rms) < 20:
        return False

    # Only look at voiced frames (above 30th percentile)
    voiced_threshold = np.percentile(rms, 30)
    voiced_rms = rms[rms > voiced_threshold]
    if len(voiced_rms) < 10:
        return False

    median_rms = np.median(voiced_rms)
    if median_rms < 1e-6:
        return False

    # Check for rapid alternating energy pattern (characteristic of overlap)
    # Compute frame-to-frame energy differences in voiced regions
    voiced_indices = np.where(rms > voiced_threshold)[0]
    if len(voiced_indices) < 10:
        return False

    diffs = np.abs(np.diff(rms[voiced_indices]))
    mean_diff = np.mean(diffs)
    rapid_change_ratio = np.mean(diffs > median_rms * 0.4)

    # Overlap causes rapid energy fluctuations AND sustained high energy
    spikes = rms > (median_rms * OVERLAP_ENERGY_RATIO)
    spike_ratio = np.mean(spikes)

    # Both conditions must hold: rapid changes AND energy spikes
    return rapid_change_ratio > 0.15 and spike_ratio > 0.04


def _estimate_snr(audio: np.ndarray, sr: int) -> float:
    """
    Estimate signal-to-noise ratio by comparing energy in voiced vs unvoiced segments.
    Uses a simple energy-based voice activity detector.
    """
    frame_length = int(0.025 * sr)  # 25 ms frames
    hop = int(0.010 * sr)           # 10 ms hop

    rms = librosa.feature.rms(y=audio, frame_length=frame_length, hop_length=hop)[0]
    if len(rms) < 4:
        return 40.0

    # Adaptive threshold: frames below 30th percentile are "noise"
    threshold = np.percentile(rms, 30)
    speech_energy = np.mean(rms[rms >= threshold] ** 2)
    noise_energy = np.mean(rms[rms < threshold] ** 2) if np.any(rms < threshold) else 1e-10

    if noise_energy < 1e-10:
        return 50.0  # essentially no noise
    return float(10 * np.log10(speech_energy / noise_energy))
