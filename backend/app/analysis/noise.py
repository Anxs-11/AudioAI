"""
Background noise detection and classification.

Uses a noise-floor analysis approach: examines the spectral content of
the quietest frames (non-speech segments) to determine if there's
meaningful non-speech sound. This works even when noise is mixed with
speech (unlike simple SNR which fails on real phone calls with TV/static).
"""

import numpy as np
import librosa

from app.config import SAMPLE_RATE
from app.analysis.acoustic import AcousticFeatures
from app.schemas import BackgroundNoiseSeverity


class NoiseAnalysisResult:
    def __init__(self):
        self.present: bool = False
        self.noise_type: str = ""
        self.severity: BackgroundNoiseSeverity = BackgroundNoiseSeverity.NONE


def analyze_noise(
    audio: np.ndarray,
    sr: int,
    acoustic_feat: AcousticFeatures,
) -> NoiseAnalysisResult:
    """
    Detect background noise by analyzing the spectral floor of the audio.

    Strategy (designed for real phone calls):
      1. Find the quietest frames using energy-based VAD.
      2. Compute the noise floor: average spectral energy of those frames.
      3. If the noise floor has meaningful energy → noise is present.
      4. Severity is based on noise floor energy relative to speech energy.
      5. Classify noise type from the spectral shape of the noise floor.
    """
    result = NoiseAnalysisResult()

    # Normalize loudness so thresholds are gain-invariant
    speech_rms = np.sqrt(np.mean(audio ** 2))
    if speech_rms > 1e-6:
        audio = audio * (0.05 / speech_rms)

    frame_length = int(0.025 * sr)
    hop = int(0.010 * sr)

    # Compute per-frame energy
    rms = librosa.feature.rms(y=audio, frame_length=frame_length, hop_length=hop)[0]
    if len(rms) < 20:
        return result

    # Identify noise-only frames
    # Use the 15th percentile as the speech/silence boundary
    # Frames below this are likely noise-only (or silence)
    energy_threshold = np.percentile(rms, 20)
    noise_frames_mask = rms <= energy_threshold

    # Extract actual audio from noise-only regions
    noise_segments = []
    for i, is_noise in enumerate(noise_frames_mask):
        if is_noise:
            start = i * hop
            end = start + frame_length
            if end <= len(audio):
                noise_segments.append(audio[start:end])

    if len(noise_segments) < 5:
        # Very few quiet frames → likely continuous speech, check spectral floor differently
        # Use the lowest 10% energy frames
        sorted_indices = np.argsort(rms)
        bottom_10 = sorted_indices[:max(3, len(rms) // 10)]
        for idx in bottom_10:
            start = idx * hop
            end = start + frame_length
            if end <= len(audio):
                noise_segments.append(audio[start:end])

    if not noise_segments:
        return result

    # Compute noise floor spectrum
    noise_spectra = []
    for seg in noise_segments:
        spec = np.abs(np.fft.rfft(seg, n=512)) ** 2
        noise_spectra.append(spec)
    noise_floor = np.mean(noise_spectra, axis=0)

    # Determine if noise is meaningful
    # Compare noise floor energy to the median speech frame energy
    speech_mask = rms > np.percentile(rms, 50)
    speech_energy = np.mean(rms[speech_mask] ** 2) if np.any(speech_mask) else 1e-10
    noise_energy = np.mean(noise_floor)

    # Ratio: how loud is the noise relative to speech
    if speech_energy < 1e-10:
        return result

    noise_ratio = noise_energy / speech_energy

    # Absolute noise floor energy (for detecting quiet but present noise)
    noise_rms = np.sqrt(np.mean(np.array(noise_segments) ** 2)) if noise_segments else 0

    # Thresholds based on noise_rms (ratio is unreliable due to scale mismatch)
    if noise_rms > 0.012:
        result.severity = BackgroundNoiseSeverity.HIGH
        result.present = True
    elif noise_rms > 0.004:
        result.severity = BackgroundNoiseSeverity.MEDIUM
        result.present = True
    elif noise_rms > 0.0015:
        result.severity = BackgroundNoiseSeverity.LOW
        result.present = True
    else:
        result.severity = BackgroundNoiseSeverity.NONE
        result.present = False
        return result

    # Classify noise type
    result.noise_type = _classify_noise_type(noise_floor, sr, noise_segments)

    return result


def _classify_noise_type(noise_spectrum: np.ndarray, sr: int, noise_segments: list = None) -> str:
    """
    Classify the dominant noise type using hand-crafted spectral rules.

    Categories (from spec examples):
      - office chatter: speech-like spectral shape in background
      - music: strong harmonic peaks, moderate bandwidth
      - road noise: low-frequency dominant, broadband
      - television: mixed speech + music signature
      - keyboard typing: impulsive, mid-high frequency energy
      - wind: very low frequency, rapid modulation
      - mechanical noise: narrow low-frequency peak (hum)
      - sharp static: impulsive crackling/popping (high crest + energy variance)
    """
    if noise_spectrum is None or np.max(noise_spectrum) < 1e-12:
        return ""

    # Check for impulsive noise (static/crackle) first
    if noise_segments and len(noise_segments) > 5:
        noise_concat = np.concatenate(noise_segments)
        n_rms = np.sqrt(np.mean(noise_concat ** 2))
        peak = np.max(np.abs(noise_concat))
        crest_factor = peak / n_rms if n_rms > 1e-8 else 0
        frame_energies = [np.sqrt(np.mean(s ** 2)) for s in noise_segments]
        energy_cv = np.std(frame_energies) / np.mean(frame_energies) if np.mean(frame_energies) > 1e-8 else 0
        # High crest + high energy variance = impulsive crackling/static
        if crest_factor > 50 and energy_cv > 3.0:
            return "sharp static"

    total_energy = np.sum(noise_spectrum)
    if total_energy < 1e-12:
        return ""

    n_bins = len(noise_spectrum)
    # Divide spectrum into bands (assuming 512-point FFT at given sr)
    low_cutoff = int(n_bins * 300 / (sr / 2))     # 0–300 Hz
    mid_cutoff = int(n_bins * 2000 / (sr / 2))    # 300–2000 Hz
    # 2000+ Hz = high band

    low_energy = np.sum(noise_spectrum[:low_cutoff])
    mid_energy = np.sum(noise_spectrum[low_cutoff:mid_cutoff])
    high_energy = np.sum(noise_spectrum[mid_cutoff:])

    low_ratio = low_energy / total_energy
    mid_ratio = mid_energy / total_energy
    high_ratio = high_energy / total_energy

    # Spectral flatness of noise profile (flat = broadband, peaked = tonal)
    geo_mean = np.exp(np.mean(np.log(noise_spectrum + 1e-12)))
    arith_mean = np.mean(noise_spectrum)
    flatness = geo_mean / arith_mean if arith_mean > 1e-12 else 0.0

    # Classification rules
    # Static / digital artifacts: high-frequency dominant, very flat spectrum
    if high_ratio > 0.4 and flatness > 0.4:
        return "sharp static"

    # Wind: dominated by very low frequencies
    if low_ratio > 0.7 and flatness < 0.3:
        return "wind"

    # Mechanical hum: narrow low-frequency peak
    if low_ratio > 0.6 and flatness < 0.15:
        return "mechanical noise"

    # Road noise: broadband but low-frequency heavy
    if low_ratio > 0.45 and flatness > 0.3:
        return "road noise"

    # Keyboard typing: impulsive mid-to-high frequency
    if high_ratio > 0.35 and mid_ratio > 0.3:
        return "keyboard typing"

    # Office chatter / TV: mid-frequency dominant (speech range)
    if mid_ratio > 0.40:
        if flatness > 0.30:
            return "office chatter"
        return "TV"

    # Music: harmonic peaks across spectrum
    if flatness < 0.2 and mid_ratio > 0.3:
        return "music"

    # Broadband high-frequency noise → static
    if high_ratio > 0.3:
        return "static"

    return "ambient noise"
