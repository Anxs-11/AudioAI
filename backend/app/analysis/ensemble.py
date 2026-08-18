"""
Ensemble module: combines predictions from all analysis pipelines into
a single AnalysisResult matching the required output schema.

Three independent signals are fused:
  1. Audio emotion model  (wav2vec2 SER)  → weight 0.50
  2. Text emotion model   (distilRoBERTa) → weight 0.30
  3. Acoustic features    (pitch/energy)  → weight 0.20

The ensemble uses weighted voting for emotional_tone and derives
emotional_intensity from model confidence + acoustic energy/pitch metrics.
"""

import numpy as np

from app.analysis.acoustic import AcousticFeatures
from app.analysis.emotion_model import EmotionPrediction
from app.analysis.noise import NoiseAnalysisResult
from app.analysis.quality import QualityAnalysisResult
from app.analysis.transcription import TranscriptionResult
from app.schemas import (
    AnalysisResult,
    AudioQuality,
    EmotionalIntensity,
    EmotionalTone,
)


# ── Mapping tables ─────────────────────────────────────────────────────────────
# Fine-tuned model outputs our labels directly
AUDIO_LABEL_MAP: dict[str, EmotionalTone] = {
    "neutral":    EmotionalTone.NEUTRAL,
    "satisfied":  EmotionalTone.SATISFIED,
    "frustrated": EmotionalTone.FRUSTRATED,
    "upset":      EmotionalTone.UPSET,
    "distressed": EmotionalTone.DISTRESSED,
    # Fallbacks for old model labels
    "ang":       EmotionalTone.UPSET,
    "hap":       EmotionalTone.SATISFIED,
    "neu":       EmotionalTone.NEUTRAL,
    "sad":       EmotionalTone.FRUSTRATED,
}

TEXT_LABEL_MAP: dict[str, EmotionalTone] = {
    "anger":    EmotionalTone.UPSET,
    "disgust":  EmotionalTone.FRUSTRATED,
    "fear":     EmotionalTone.DISTRESSED,
    "joy":      EmotionalTone.SATISFIED,
    "neutral":  EmotionalTone.NEUTRAL,
    "sadness":  EmotionalTone.FRUSTRATED,
    "surprise": EmotionalTone.NEUTRAL,
}

# Fine-tuned audio model is now primary; text confirms; acoustics break ties
W_AUDIO = 0.55
W_ACOUSTIC_CLF = 0.10
W_TEXT = 0.25
W_ACOUSTIC = 0.15


def build_result(
    audio_emotion: EmotionPrediction,
    text_emotion: EmotionPrediction,
    acoustic_emotion: EmotionPrediction,
    acoustic_feat: AcousticFeatures,
    noise_result: NoiseAnalysisResult,
    quality_result: QualityAnalysisResult,
    transcript: TranscriptionResult,
    customer_text: str = "",
) -> AnalysisResult:
    """
    Fuse all pipeline outputs into a single AnalysisResult.

    Steps:
      1. Map each model's raw labels to the target enum.
      2. Accumulate weighted votes per target class.
      3. Pick the highest-voted class as emotional_tone.
      4. Derive emotional_intensity from confidence + acoustic cues.
      5. Compute overall confidence from agreement between models.
    """

    # ── Step 1-2: Weighted voting ──────────────────────────────────────────
    votes: dict[EmotionalTone, float] = {tone: 0.0 for tone in EmotionalTone}

    # Audio model votes (with uncertainty handling)
    audio_top_score = audio_emotion.score
    audio_second = sorted(audio_emotion.all_scores.values(), reverse=True)[1] if len(audio_emotion.all_scores) > 1 else 0
    audio_is_uncertain = (audio_top_score - audio_second) < 0.15

    # Detect non-English speech
    is_non_english = transcript.language and transcript.language != "en"

    for raw_label, score in audio_emotion.all_scores.items():
        mapped = AUDIO_LABEL_MAP.get(raw_label, EmotionalTone.NEUTRAL)
        weight = W_AUDIO
        if audio_is_uncertain:
            weight = W_AUDIO * 0.7
        if is_non_english:
            weight *= 0.4
        votes[mapped] += score * weight

    # Only bias toward neutral for non-English (no transcript to verify)
    if is_non_english:
        votes[EmotionalTone.NEUTRAL] += W_AUDIO * 0.15

    # ── Acoustic classifier votes (trained on MFCC/pitch/energy features) ──
    # Use as tiebreaker when the audio model isn't confident
    ACOUSTIC_CLF_LABEL_MAP = {
        "upset": EmotionalTone.UPSET,
        "satisfied": EmotionalTone.SATISFIED,
        "neutral": EmotionalTone.NEUTRAL,
        "frustrated": EmotionalTone.FRUSTRATED,
        "distressed": EmotionalTone.DISTRESSED,
    }
    clf_weight = W_ACOUSTIC_CLF if audio_is_uncertain else W_ACOUSTIC_CLF * 0.5
    for label, score in acoustic_emotion.all_scores.items():
        mapped = ACOUSTIC_CLF_LABEL_MAP.get(label, EmotionalTone.NEUTRAL)
        votes[mapped] += score * clf_weight

    # Text model votes — reduce weight if not English
    text_weight = W_TEXT
    if is_non_english:
        text_weight = W_TEXT * 0.2

    for raw_label, score in text_emotion.all_scores.items():
        mapped = TEXT_LABEL_MAP.get(raw_label, EmotionalTone.NEUTRAL)
        effective_score = score
        # "fear" on phone calls is usually just uncertainty — discount it
        if raw_label == "fear":
            effective_score = score * 0.4
        votes[mapped] += effective_score * text_weight

    # Acoustic-feature nudge based on pitch and energy variance
    acoustic_tone = _acoustic_emotion_hint(acoustic_feat)
    votes[acoustic_tone] += W_ACOUSTIC

    # ── Step 2b: Transcript keyword boosting ───────────────────────────────
    # Use customer text for keyword analysis (not full transcript with agent)
    boost_text = customer_text if customer_text else transcript.text
    keyword_boost = _transcript_keyword_boost(boost_text)
    for tone, boost in keyword_boost.items():
        votes[tone] += boost

    # ── Step 2c: Context override for service calls ────────────────────────
    # When strong cooperative language + uncertain audio = satisfied customer
    satisfied_boost = keyword_boost.get(EmotionalTone.SATISFIED, 0)
    upset_boost = keyword_boost.get(EmotionalTone.UPSET, 0)
    if satisfied_boost >= 0.25 and audio_is_uncertain and upset_boost == 0:
        votes[EmotionalTone.SATISFIED] += 0.20
        votes[EmotionalTone.NEUTRAL] -= 0.10

    # ── Step 3: Pick winner ────────────────────────────────────────────────
    emotional_tone = max(votes, key=lambda t: votes[t])
    winner_score = votes[emotional_tone]
    total_votes = sum(votes.values())
    tone_confidence = winner_score / total_votes if total_votes > 0 else 0.5

    # ── Step 4: Intensity ──────────────────────────────────────────────────
    emotional_intensity = _compute_intensity(
        tone_confidence, audio_emotion.score, acoustic_feat,
    )

    # ── Step 5: Overall confidence ─────────────────────────────────────────
    # Base confidence from the ensemble vote margin + individual model strengths
    audio_mapped = AUDIO_LABEL_MAP.get(audio_emotion.label, EmotionalTone.NEUTRAL)
    text_mapped = TEXT_LABEL_MAP.get(text_emotion.label, EmotionalTone.NEUTRAL)

    # Use max of: ensemble margin, audio model confidence, weighted average
    # This prevents structural dilution from artificially lowering confidence
    individual_max = max(audio_emotion.score, text_emotion.score)
    ensemble_conf = tone_confidence

    # Blend: strong individual model predictions boost overall confidence
    raw_confidence = 0.5 * ensemble_conf + 0.35 * individual_max + 0.15 * audio_emotion.score

    # Agreement between modalities boosts confidence significantly
    if audio_mapped == text_mapped:
        raw_confidence += 0.12
    elif audio_mapped == emotional_tone or text_mapped == emotional_tone:
        raw_confidence += 0.05

    # Only penalize confidence for severely_impaired audio (real calls are rarely studio-clear)
    if quality_result.quality == AudioQuality.SEVERELY_IMPAIRED:
        raw_confidence *= 0.80

    confidence = float(np.clip(raw_confidence, 0.15, 0.98))

    return AnalysisResult(
        emotional_tone=emotional_tone,
        emotional_intensity=emotional_intensity,
        background_noise_present=noise_result.present,
        background_noise_type=noise_result.noise_type,
        background_noise_severity=noise_result.severity,
        audio_quality=quality_result.quality,
        speaker_overlap_present=acoustic_feat.speaker_overlap_detected,
        long_silence_present=acoustic_feat.long_silence_detected,
        confidence=round(confidence, 2),
    )


# ── Private helpers ────────────────────────────────────────────────────────────

def _acoustic_emotion_hint(feat: AcousticFeatures) -> EmotionalTone:
    """
    Derive an emotion hint purely from acoustic features.
    High pitch + high energy → upset/distressed.
    Low pitch + low energy → neutral/frustrated.
    This is a weak signal but helps break ties.
    """
    high_pitch = feat.pitch_mean > 250
    high_energy = feat.rms_mean > 0.015
    moderate_pitch = feat.pitch_mean > 140 and feat.pitch_mean <= 250
    low_energy = feat.rms_mean < 0.003
    very_low_pitch_var = feat.pitch_std < 22

    if high_pitch and high_energy:
        return EmotionalTone.UPSET
    if high_pitch and not high_energy:
        return EmotionalTone.DISTRESSED
    if moderate_pitch and not high_energy:
        return EmotionalTone.SATISFIED
    if low_energy and very_low_pitch_var:
        return EmotionalTone.FRUSTRATED
    return EmotionalTone.NEUTRAL


def _transcript_keyword_boost(text: str) -> dict[EmotionalTone, float]:
    """
    Scan the transcript for strong semantic indicators of emotion.
    Calibrated for automotive service call context.
    """
    if not text:
        return {}

    text_lower = text.lower()
    boosts: dict[EmotionalTone, float] = {}

    # Upset/angry indicators
    upset_words = ["frustrated", "ridiculous", "unacceptable", "terrible", "worst",
                   "angry", "furious", "pissed", "fed up", "sick of", "tired of",
                   "complaint", "supervisor", "manager", "cancel", "lawsuit",
                   "hello hello", "are you there", "can you hear me",
                   "are you a real person", "how many times"]
    upset_count = sum(1 for w in upset_words if w in text_lower)
    if upset_count >= 2:
        boosts[EmotionalTone.UPSET] = 0.20
    elif upset_count == 1:
        boosts[EmotionalTone.UPSET] = 0.10

    # Satisfied/positive indicators (service-call context)
    satisfied_words = ["thank", "thanks", "appreciate", "great", "wonderful",
                       "excellent", "perfect", "happy", "glad", "pleased",
                       "helpful", "good job", "awesome", "sounds good",
                       "that works", "appointment", "schedule",
                       "checkup", "check-up", "please", "can you help"]
    satisfied_count = sum(1 for w in satisfied_words if w in text_lower)
    # In service calls, polite + cooperative = satisfied
    if satisfied_count >= 3:
        boosts[EmotionalTone.SATISFIED] = 0.28
    elif satisfied_count >= 2:
        boosts[EmotionalTone.SATISFIED] = 0.18
    elif satisfied_count == 1:
        boosts[EmotionalTone.SATISFIED] = 0.06

    # Frustrated indicators (milder than upset)
    frustrated_words = ["annoying", "inconvenient", "waiting", "still not",
                        "already told", "not working", "broken", "issue",
                        "wrong", "problem", "disappointing"]
    frustrated_count = sum(1 for w in frustrated_words if w in text_lower)
    if frustrated_count >= 2:
        boosts[EmotionalTone.FRUSTRATED] = 0.15
    elif frustrated_count == 1:
        boosts[EmotionalTone.FRUSTRATED] = 0.08

    # Distressed indicators
    distressed_words = ["help me", "please help", "emergency", "scared",
                        "don't know what to do", "crying", "overwhelmed", "panic"]
    if any(w in text_lower for w in distressed_words):
        boosts[EmotionalTone.DISTRESSED] = 0.18

    return boosts


def _compute_intensity(
    tone_confidence: float,
    audio_model_confidence: float,
    feat: AcousticFeatures,
) -> EmotionalIntensity:
    """
    Derive intensity from model confidence + acoustic energy/pitch variation.

    Calibrated against labeled production calls:
      call_001 (upset/high): pitch_std=80.9, rms_std=0.0962
      call_002 (neutral/medium): pitch_std=220 (multi-speaker), rms_std=0.0384
      call_003 (satisfied/medium): pitch_std=63.9, rms_std=0.0774
    """
    # Composite score from 0 to 1
    pitch_factor = min(feat.pitch_std / 100.0, 1.0) if feat.pitch_std > 0 else 0.0
    energy_factor = min(feat.rms_std / 0.08, 1.0) if feat.rms_std > 0 else 0.0
    energy_level = min(feat.rms_mean / 0.06, 1.0)
    model_factor = (tone_confidence + audio_model_confidence) / 2.0

    composite = 0.30 * model_factor + 0.30 * pitch_factor + 0.25 * energy_factor + 0.15 * energy_level

    if composite > 0.65:
        return EmotionalIntensity.HIGH
    if composite > 0.35:
        return EmotionalIntensity.MEDIUM
    return EmotionalIntensity.LOW
