"""
Emotion classification from audio and text using pre-trained transformer models.

Two independent classifiers run in parallel:
  1. Audio emotion  – wav2vec2 fine-tuned for speech emotion recognition.
     Model: superb/wav2vec2-base-superb-er  (SUPERB benchmark)
     Outputs: ang (angry), hap (happy), neu (neutral), sad

  2. Text emotion   – distilRoBERTa fine-tuned on GoEmotions.
     Model: j-hartmann/emotion-english-distilroberta-base
     Outputs: anger, disgust, fear, joy, neutral, sadness, surprise

Both models run locally on CPU (zero API cost).
"""

import logging
from dataclasses import dataclass, field

import numpy as np

logger = logging.getLogger(__name__)

# Lazy singletons
_audio_emotion_pipe = None
_text_emotion_pipe = None


@dataclass
class EmotionPrediction:
    """Scores for each emotion class from a single model."""
    label: str = "neutral"
    score: float = 0.0
    all_scores: dict[str, float] = field(default_factory=dict)


# ── Audio emotion model (fine-tuned on RAVDESS with our 5 classes) ─────────────

_finetuned_model = None
_finetuned_classifier = None
_finetuned_labels = None
_original_pipe = None


def _get_finetuned_model():
    global _finetuned_model, _finetuned_classifier, _finetuned_labels
    if _finetuned_model is None:
        import json
        import torch
        import torch.nn as nn
        from pathlib import Path

        model_dir = Path(__file__).parent / "finetuned_emotion_model"

        with open(model_dir / "config.json") as f:
            config = json.load(f)
        _finetuned_labels = config["labels"]

        logger.info("Loading fine-tuned emotion model...")
        # Reuse base encoder from original pipeline to avoid double memory usage
        pipe = _get_original_pipe()
        _finetuned_model = pipe.model.wav2vec2
        _finetuned_model.eval()

        _finetuned_classifier = nn.Sequential(
            nn.Linear(768, 256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, len(_finetuned_labels)),
        )
        _finetuned_classifier.load_state_dict(
            torch.load(model_dir / "classifier_head.pt", weights_only=True)
        )
        _finetuned_classifier.eval()
        logger.info("Fine-tuned emotion model loaded (%d classes).", len(_finetuned_labels))

    return _finetuned_model, _finetuned_classifier, _finetuned_labels


def _get_original_pipe():
    global _original_pipe
    if _original_pipe is None:
        import torch
        from transformers import pipeline
        from app.config import AUDIO_EMOTION_MODEL
        logger.info("Loading original audio emotion model: %s", AUDIO_EMOTION_MODEL)
        _original_pipe = pipeline("audio-classification", model=AUDIO_EMOTION_MODEL, device=-1)
        _original_pipe.model = torch.quantization.quantize_dynamic(
            _original_pipe.model,
            {torch.nn.Linear},
            dtype=torch.qint8,
        )
        logger.info("Wav2Vec2 model quantized to INT8.")
    return _original_pipe


def classify_audio_emotion(audio: np.ndarray, sr: int = 16_000) -> EmotionPrediction:
    """
    Classify emotion using both original (robust) and fine-tuned (5-class) models.
    Blends their outputs for best accuracy on both real calls and test data.
    """
    import torch

    # ── Original model (robust on real-world audio) ────────────────────────
    pipe = _get_original_pipe()
    raw_scores = pipe({"raw": audio, "sampling_rate": sr})
    orig_scores = {item["label"]: item["score"] for item in raw_scores}

    # ── Fine-tuned model (5 classes, segmented) ────────────────────────────
    base, classifier, labels = _get_finetuned_model()
    seg_len = 4 * sr
    if len(audio) <= seg_len:
        segments = [audio]
    else:
        step = seg_len // 2
        segments = [audio[i:i+seg_len] for i in range(0, len(audio) - seg_len + 1, step)]

    all_probs = []
    for seg in segments:
        if len(seg) < seg_len:
            seg = np.pad(seg, (0, seg_len - len(seg)))
        inp = torch.tensor(seg, dtype=torch.float32).unsqueeze(0)
        with torch.no_grad():
            hidden = base(inp).last_hidden_state.mean(dim=1)
            logits = classifier(hidden).squeeze()
            probs = torch.softmax(logits, dim=0).numpy()
        all_probs.append(probs)
    ft_probs = np.mean(all_probs, axis=0)
    ft_scores = {label: float(prob) for label, prob in zip(labels, ft_probs)}

    # ── Blend: dynamic weighting based on original model confidence ──────
    ORIG_MAP = {"ang": "upset", "hap": "satisfied", "neu": "neutral", "sad": "frustrated"}
    blended = {l: 0.0 for l in labels}

    # If original model is confident about a non-neutral emotion, trust it more
    orig_top = max(orig_scores, key=lambda k: orig_scores[k])
    orig_conf = orig_scores[orig_top]
    orig_is_emotional = orig_top in ("ang", "hap", "sad") and orig_conf > 0.4

    w_orig = 0.8 if orig_is_emotional else 0.5
    w_ft = 1.0 - w_orig

    for orig_label, score in orig_scores.items():
        mapped = ORIG_MAP.get(orig_label, "neutral")
        blended[mapped] += score * w_orig

    for ft_label, score in ft_scores.items():
        blended[ft_label] += score * w_ft

    top_label = max(blended, key=lambda k: blended[k])
    return EmotionPrediction(
        label=top_label,
        score=float(blended[top_label]),
        all_scores=blended,
    )


# ── Text emotion model ────────────────────────────────────────────────────────

def _get_text_pipe():
    global _text_emotion_pipe
    if _text_emotion_pipe is None:
        from transformers import pipeline
        from app.config import TEXT_EMOTION_MODEL

        logger.info("Loading text emotion model: %s", TEXT_EMOTION_MODEL)
        _text_emotion_pipe = pipeline(
            "text-classification",
            model=TEXT_EMOTION_MODEL,
            top_k=None,  # return all class scores
            device=-1,
        )
        logger.info("Text emotion model loaded.")
    return _text_emotion_pipe


def classify_text_emotion(text: str) -> EmotionPrediction:
    """
    Classify the emotional tone from the transcript text.

    Args:
        text: Transcribed speech text.

    Returns:
        EmotionPrediction with top label, score, and all class scores.
    """
    if not text or not text.strip():
        return EmotionPrediction(label="neutral", score=1.0, all_scores={"neutral": 1.0})

    pipe = _get_text_pipe()

    # Truncate to model's max input length
    truncated = text[:512]
    raw_scores = pipe(truncated)[0]

    scores_dict = {item["label"]: item["score"] for item in raw_scores}
    top = max(raw_scores, key=lambda x: x["score"])

    return EmotionPrediction(
        label=top["label"],
        score=top["score"],
        all_scores=scores_dict,
    )


# ── Acoustic emotion classifier (MFCC + pitch + energy based) ─────────────────

_acoustic_clf = None
_acoustic_scaler = None


def _load_acoustic_classifier():
    global _acoustic_clf, _acoustic_scaler
    if _acoustic_clf is None:
        import pickle
        from pathlib import Path

        model_path = Path(__file__).parent / "acoustic_emotion_model.pkl"
        if not model_path.exists():
            logger.warning("Acoustic emotion model not found at %s", model_path)
            return None, None

        with open(model_path, 'rb') as f:
            data = pickle.load(f)
        _acoustic_clf = data['classifier']
        _acoustic_scaler = data['scaler']
        logger.info("Acoustic emotion classifier loaded.")
    return _acoustic_clf, _acoustic_scaler


def classify_acoustic_emotion(acoustic_feat) -> EmotionPrediction:
    """
    Classify emotion from acoustic features (MFCCs, pitch, energy, spectral).
    Detects HOW something is said regardless of words.
    """
    clf, scaler = _load_acoustic_classifier()
    if clf is None:
        return EmotionPrediction(label="neutral", score=0.5, all_scores={"neutral": 1.0})

    mfccs = acoustic_feat.mfcc_means if acoustic_feat.mfcc_means else [0]*13
    features = np.array(mfccs + [
        acoustic_feat.pitch_mean,
        acoustic_feat.pitch_std,
        acoustic_feat.pitch_range,
        acoustic_feat.pitch_std / max(acoustic_feat.pitch_mean, 1),
        acoustic_feat.rms_mean,
        acoustic_feat.rms_std,
        acoustic_feat.rms_max,
        acoustic_feat.rms_std / max(acoustic_feat.rms_mean, 0.001),
        acoustic_feat.spectral_centroid_mean,
        acoustic_feat.spectral_bandwidth_mean,
        acoustic_feat.spectral_flatness_mean,
        acoustic_feat.zcr_mean,
        acoustic_feat.voiced_ratio,
        acoustic_feat.duration_sec,
    ]).reshape(1, -1)

    features_scaled = scaler.transform(features)
    probs = clf.predict_proba(features_scaled)[0]
    classes = clf.classes_

    scores_dict = {cls: float(prob) for cls, prob in zip(classes, probs)}
    top_idx = np.argmax(probs)

    return EmotionPrediction(
        label=classes[top_idx],
        score=float(probs[top_idx]),
        all_scores=scores_dict,
    )
