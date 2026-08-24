"""
Tests for noise detection and quality assessment using synthetic audio signals.
No ML models required — tests pure signal-processing logic.
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.analysis.acoustic import extract_features
from app.analysis.noise import analyze_noise
from app.analysis.quality import assess_quality
from app.schemas import BackgroundNoiseSeverity, AudioQuality


SR = 16000


def _sine(freq=220, duration=3.0, amplitude=0.1):
    t = np.linspace(0, duration, int(SR * duration), dtype=np.float32)
    return amplitude * np.sin(2 * np.pi * freq * t)


def _speech_like(duration=3.0, amplitude=0.1):
    """Generate a speech-like signal: bursts of varied sine with pauses."""
    t = np.linspace(0, duration, int(SR * duration), dtype=np.float32)
    # Modulated signal with natural pauses
    envelope = np.clip(np.sin(2 * np.pi * 1.5 * t) + 0.5, 0, 1).astype(np.float32)
    carrier = amplitude * np.sin(2 * np.pi * 220 * t).astype(np.float32)
    return carrier * envelope


class TestNoiseDetection:
    def test_clean_speech_not_noisy(self):
        audio = _speech_like(3.0, 0.1)
        feat = extract_features(audio, SR)
        result = analyze_noise(audio, SR, feat)
        assert result.severity in (BackgroundNoiseSeverity.NONE, BackgroundNoiseSeverity.LOW)

    def test_loud_white_noise_detected(self):
        rng = np.random.default_rng(42)
        audio = (0.1 * _sine(220, 3.0) + 0.08 * rng.standard_normal(SR * 3).astype(np.float32))
        feat = extract_features(audio, SR)
        result = analyze_noise(audio, SR, feat)
        assert result.present

    def test_silence_not_noisy(self):
        audio = np.zeros(SR * 3, dtype=np.float32)
        feat = extract_features(audio, SR)
        result = analyze_noise(audio, SR, feat)
        assert not result.present


class TestQualityAssessment:
    def test_clean_audio_is_clear(self):
        audio = _speech_like(3.0, 0.1)
        feat = extract_features(audio, SR)
        result = assess_quality(audio, SR, feat)
        assert result.quality in (AudioQuality.CLEAR, AudioQuality.SLIGHTLY_IMPAIRED)

    def test_clipped_audio_detected(self):
        audio = _sine(220, 3.0, 0.5)
        audio = np.clip(audio, -0.3, 0.3)  # hard clip
        feat = extract_features(audio, SR)
        result = assess_quality(audio, SR, feat)
        # Clipping should be detected
        assert any("clip" in issue.lower() for issue in result.issues) or result.quality != AudioQuality.CLEAR

    def test_very_quiet_audio_flagged(self):
        audio = _sine(220, 3.0, 0.001)
        feat = extract_features(audio, SR)
        result = assess_quality(audio, SR, feat)
        assert any("low volume" in issue for issue in result.issues)


class TestAcousticFeatures:
    def test_silence_detection(self):
        # 3 seconds of audio with a 6-second silence in the middle
        speech = _sine(220, 3.0, 0.1)
        silence = np.zeros(SR * 6, dtype=np.float32)
        audio = np.concatenate([speech, silence, speech])
        feat = extract_features(audio, SR)
        assert feat.long_silence_detected

    def test_short_audio_no_silence(self):
        audio = _sine(220, 2.0, 0.1)
        feat = extract_features(audio, SR)
        assert not feat.long_silence_detected

    def test_snr_computed(self):
        audio = _sine(220, 3.0, 0.1)
        feat = extract_features(audio, SR)
        assert feat.snr_db is not None
        assert feat.snr_db > 0
