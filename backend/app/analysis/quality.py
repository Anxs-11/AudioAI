"""
Audio quality assessment using signal-processing metrics.

Evaluates the technical quality of the audio independent of emotional content.
Checks for: distortion, clipping, echo, static, low volume, muffled speech,
robotic artifacts, and potential packet loss.

Returns one of: clear | slightly_impaired | severely_impaired.
"""

import numpy as np
import librosa

from app.analysis.acoustic import AcousticFeatures
from app.schemas import AudioQuality


class QualityAnalysisResult:
    def __init__(self):
        self.quality: AudioQuality = AudioQuality.CLEAR
        self.issues: list[str] = []  # human-readable list of detected problems


def assess_quality(
    audio: np.ndarray,
    sr: int,
    acoustic_feat: AcousticFeatures,
) -> QualityAnalysisResult:
    """
    Assess overall audio quality from signal characteristics.

    Each check adds a penalty. The total penalty determines the quality tier:
      0 penalties    → clear
      1-2 penalties  → slightly_impaired
      3+ penalties   → severely_impaired

    Args:
        audio:         1-D float32 mono signal.
        sr:            Sample rate.
        acoustic_feat: Pre-computed acoustic features.

    Returns:
        QualityAnalysisResult with quality enum and list of issues.
    """
    result = QualityAnalysisResult()
    penalties = 0

    # ── Clipping (digital distortion) — phone codecs often cause micro-peaks ──
    if acoustic_feat.clipping_ratio > 0.03:
        result.issues.append("clipping detected")
        penalties += 2 if acoustic_feat.clipping_ratio > 0.08 else 1

    # ── Very low volume ────────────────────────────────────────────────────
    if acoustic_feat.rms_mean < 0.005:
        result.issues.append("very low volume")
        penalties += 1

    # ── Muffled speech (extremely narrow bandwidth — below telephone standard 300-3400Hz) ──
    if acoustic_feat.spectral_bandwidth_mean < 400:
        result.issues.append("muffled or narrow-band audio")
        penalties += 1

    # ── Echo detection (autocorrelation peak) ──────────────────────────────
    if _detect_echo(audio, sr):
        result.issues.append("echo or reverberation")
        penalties += 1

    # ── Packet-loss gaps (short silent dropouts in speech) ─────────────────
    gap_count = _detect_packet_loss(audio, sr)
    if gap_count > 3:
        result.issues.append(f"potential packet loss ({gap_count} gaps)")
        penalties += 2
    elif gap_count > 0:
        result.issues.append(f"minor packet loss ({gap_count} gaps)")
        penalties += 1

    # ── Robotic / digital artifacts (unusual spectral flatness) ────────────
    if acoustic_feat.spectral_flatness_mean > 0.6:
        result.issues.append("robotic or synthetic audio artifacts")
        penalties += 1

    # ── Map penalties to quality tier ──────────────────────────────────────
    if penalties >= 4:
        result.quality = AudioQuality.SEVERELY_IMPAIRED
    elif penalties >= 2:
        result.quality = AudioQuality.SLIGHTLY_IMPAIRED
    else:
        result.quality = AudioQuality.CLEAR

    return result


def _detect_echo(audio: np.ndarray, sr: int) -> bool:
    """
    Detect strong echo (not mild phone handset reflections).
    Threshold raised to 0.45 to avoid false positives on normal phone calls.
    """
    min_lag = int(0.05 * sr)   # 50 ms
    max_lag = int(0.5 * sr)    # 500 ms

    mid = len(audio) // 2
    segment_len = min(sr * 2, len(audio))
    segment = audio[max(0, mid - segment_len // 2): mid + segment_len // 2]

    if len(segment) < max_lag * 2:
        return False

    autocorr = np.correlate(segment, segment, mode="full")
    autocorr = autocorr[len(autocorr) // 2:]

    # Normalize by zero-lag value
    if autocorr[0] < 1e-10:
        return False
    autocorr = autocorr / autocorr[0]

    # Check for a significant secondary peak in the echo range
    echo_region = autocorr[min_lag:max_lag]
    if len(echo_region) == 0:
        return False

    peak_value = np.max(echo_region)
    return peak_value > 0.45  # raised from 0.3 — normal phone calls have mild reflections


def _detect_packet_loss(audio: np.ndarray, sr: int) -> int:
    """
    Count abrupt silent gaps (10-50 ms) surrounded by speech energy,
    indicating network packet loss (not natural pauses).
    Natural speech has many short low-energy frames — only count
    truly abrupt near-zero dropouts preceded and followed by speech.
    """
    frame_ms = 10
    frame_len = int(frame_ms * sr / 1000)
    hop = frame_len

    rms = librosa.feature.rms(y=audio, frame_length=frame_len, hop_length=hop)[0]
    if len(rms) < 20:
        return 0

    # Active speech energy baseline
    active_energy = np.percentile(rms, 70)
    if active_energy < 1e-6:
        return 0

    # A packet-loss gap is near-zero energy surrounded by active speech
    silent_threshold = active_energy * 0.005  # much stricter: 0.5% of speech energy

    gap_count = 0
    for i in range(2, len(rms) - 2):
        # Frame must be near-silent
        if rms[i] >= silent_threshold:
            continue
        # Surrounding frames must be active speech (not a natural pause)
        before = max(rms[i-2], rms[i-1])
        after = max(rms[i+1], rms[i+2])
        if before > active_energy * 0.3 and after > active_energy * 0.3:
            gap_count += 1

    return gap_count
