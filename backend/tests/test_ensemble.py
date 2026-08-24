"""
Tests for the ensemble voting logic, keyword boosting, and intensity computation.
These tests are pure-Python and do not load any ML models.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.analysis.ensemble import _transcript_keyword_boost, _compute_intensity, _acoustic_emotion_hint
from app.analysis.acoustic import AcousticFeatures
from app.schemas import EmotionalTone, EmotionalIntensity


class TestKeywordBoost:
    def test_upset_keywords_double(self):
        boosts = _transcript_keyword_boost("this is ridiculous, I want to speak to a supervisor")
        assert EmotionalTone.UPSET in boosts
        assert boosts[EmotionalTone.UPSET] >= 0.20

    def test_upset_keywords_single(self):
        boosts = _transcript_keyword_boost("I am frustrated with the service")
        assert EmotionalTone.UPSET in boosts
        assert boosts[EmotionalTone.UPSET] >= 0.10

    def test_satisfied_keywords_strong(self):
        boosts = _transcript_keyword_boost("thank you so much, that's wonderful, I really appreciate it")
        assert EmotionalTone.SATISFIED in boosts
        assert boosts[EmotionalTone.SATISFIED] >= 0.28

    def test_frustrated_keywords(self):
        boosts = _transcript_keyword_boost("this is annoying, still not working, keeps happening")
        assert EmotionalTone.FRUSTRATED in boosts
        assert boosts[EmotionalTone.FRUSTRATED] >= 0.25

    def test_distressed_keywords(self):
        boosts = _transcript_keyword_boost("please help me, this is an emergency")
        assert EmotionalTone.DISTRESSED in boosts
        assert boosts[EmotionalTone.DISTRESSED] >= 0.28

    def test_empty_text(self):
        boosts = _transcript_keyword_boost("")
        assert boosts == {}

    def test_neutral_text(self):
        boosts = _transcript_keyword_boost("I need to check on my vehicle status")
        # No strong emotion keywords
        assert EmotionalTone.UPSET not in boosts
        assert EmotionalTone.DISTRESSED not in boosts


class TestIntensity:
    def _make_feat(self, **kwargs) -> AcousticFeatures:
        defaults = dict(
            pitch_mean=180, pitch_std=50, pitch_range=100,
            rms_mean=0.03, rms_std=0.04, rms_max=0.1,
            spectral_centroid_mean=1500, spectral_bandwidth_mean=1000,
            spectral_flatness_mean=0.1, zcr_mean=0.05,
            voiced_ratio=0.8, clipping_ratio=0.0, snr_db=25.0,
            duration_sec=30.0, speaker_overlap_detected=False,
            long_silence_detected=False, mfcc_means=[0]*13,
        )
        defaults.update(kwargs)
        return AcousticFeatures(**defaults)

    def test_high_intensity(self):
        feat = self._make_feat(pitch_std=120, rms_std=0.10, rms_mean=0.08)
        result = _compute_intensity(0.85, 0.90, feat)
        assert result == EmotionalIntensity.HIGH

    def test_low_intensity(self):
        feat = self._make_feat(pitch_std=10, rms_std=0.01, rms_mean=0.01)
        result = _compute_intensity(0.3, 0.3, feat)
        assert result == EmotionalIntensity.LOW

    def test_overlap_discounts_energy(self):
        feat = self._make_feat(pitch_std=60, rms_std=0.09, rms_mean=0.07, speaker_overlap_detected=True)
        result_overlap = _compute_intensity(0.6, 0.6, feat)
        feat_no_overlap = self._make_feat(pitch_std=60, rms_std=0.09, rms_mean=0.07, speaker_overlap_detected=False)
        result_no_overlap = _compute_intensity(0.6, 0.6, feat_no_overlap)
        intensity_order = {"low": 0, "medium": 1, "high": 2}
        assert intensity_order[result_overlap.value] <= intensity_order[result_no_overlap.value]


class TestAcousticHint:
    def test_high_pitch_high_energy_is_upset(self):
        feat = AcousticFeatures(
            pitch_mean=300, pitch_std=50, pitch_range=200,
            rms_mean=0.02, rms_std=0.03, rms_max=0.1,
            spectral_centroid_mean=1500, spectral_bandwidth_mean=1000,
            spectral_flatness_mean=0.1, zcr_mean=0.05,
            voiced_ratio=0.8, clipping_ratio=0.0, snr_db=25.0,
            duration_sec=30.0, speaker_overlap_detected=False,
            long_silence_detected=False, mfcc_means=[0]*13,
        )
        assert _acoustic_emotion_hint(feat) == EmotionalTone.UPSET

    def test_low_energy_low_pitch_var_is_frustrated(self):
        feat = AcousticFeatures(
            pitch_mean=120, pitch_std=15, pitch_range=30,
            rms_mean=0.002, rms_std=0.001, rms_max=0.01,
            spectral_centroid_mean=1500, spectral_bandwidth_mean=1000,
            spectral_flatness_mean=0.1, zcr_mean=0.05,
            voiced_ratio=0.8, clipping_ratio=0.0, snr_db=25.0,
            duration_sec=30.0, speaker_overlap_detected=False,
            long_silence_detected=False, mfcc_means=[0]*13,
        )
        assert _acoustic_emotion_hint(feat) == EmotionalTone.FRUSTRATED
