"""
Grid-search ensemble weights to maximize macro-F1 on benchmark data.

Usage:
    python scripts/tune_weights.py

Caches per-model scores from benchmark files, then searches over
W_AUDIO / W_TEXT / W_ACOUSTIC_CLF weight combinations. Reports
best weights and per-class F1. Holds out 30% for honest evaluation.
"""

import json
import sys
from pathlib import Path
from itertools import product

import numpy as np

ROOT = Path(__file__).resolve().parent.parent

LABELS = ["neutral", "satisfied", "frustrated", "upset", "distressed"]

AUDIO_LABEL_MAP = {
    "neutral": "neutral", "satisfied": "satisfied", "frustrated": "frustrated",
    "upset": "upset", "distressed": "distressed",
    "ang": "upset", "hap": "satisfied", "neu": "neutral", "sad": "frustrated",
}
TEXT_LABEL_MAP = {
    "anger": "upset", "disgust": "frustrated", "fear": "distressed",
    "joy": "satisfied", "neutral": "neutral", "sadness": "frustrated", "surprise": "neutral",
}
SAD_SPLIT = {"frustrated": 0.5, "distressed": 0.5}


def load_benchmark_samples():
    """Load benchmark files that have detail (per-model scores)."""
    samples = []
    for name in ["benchmark_ravdess.json", "benchmark_synthetic.json"]:
        path = ROOT / name
        if not path.exists():
            continue
        data = json.load(open(path))
        for fr in data.get("file_results", []):
            if "detail" not in fr or not fr["detail"]:
                continue
            samples.append({
                "ground_truth": fr["ground_truth"],
                "audio_scores": fr["detail"].get("audio_emotion", {}),
                "text_scores": fr["detail"].get("text_emotion", {}),
                "acoustic_scores": fr["detail"].get("acoustic_emotion", {}),
            })
    return samples


def predict(sample, w_audio, w_text, w_acoustic):
    """Predict tone using given weights."""
    votes = {l: 0.0 for l in LABELS}

    for raw, score in sample["audio_scores"].items():
        if raw == "sad":
            for tone, frac in SAD_SPLIT.items():
                votes[tone] += score * frac * w_audio
        else:
            mapped = AUDIO_LABEL_MAP.get(raw, "neutral")
            votes[mapped] += score * w_audio

    # Salience-gated text weight
    text_neutral = sample["text_scores"].get("neutral", 0.0)
    text_salience = 1.0 - text_neutral
    eff_text_w = w_text * (0.3 + 0.7 * text_salience)
    for raw, score in sample["text_scores"].items():
        mapped = TEXT_LABEL_MAP.get(raw, "neutral")
        votes[mapped] += score * eff_text_w

    for raw, score in sample["acoustic_scores"].items():
        mapped = raw if raw in LABELS else "neutral"
        votes[mapped] += score * w_acoustic

    return max(votes, key=lambda l: votes[l])


def macro_f1(y_true, y_pred):
    f1s = []
    for label in LABELS:
        tp = sum(1 for t, p in zip(y_true, y_pred) if t == label and p == label)
        fp = sum(1 for t, p in zip(y_true, y_pred) if p == label and t != label)
        fn = sum(1 for t, p in zip(y_true, y_pred) if t == label and p != label)
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0
        f1s.append(f1)
    return np.mean(f1s)


def main():
    samples = load_benchmark_samples()
    if len(samples) < 10:
        print(f"Only {len(samples)} samples with detail — need benchmark runs with detail_json first.")
        print("Run: python scripts/benchmark.py  then  python combine_benchmarks.py")
        sys.exit(1)

    # Hold out 30% for evaluation
    np.random.seed(42)
    indices = np.arange(len(samples))
    np.random.shuffle(indices)
    split = int(len(samples) * 0.7)
    train_idx, test_idx = indices[:split], indices[split:]

    train = [samples[i] for i in train_idx]
    test = [samples[i] for i in test_idx]

    print(f"Tuning on {len(train)} samples, evaluating on {len(test)} held-out samples\n")

    # Grid search
    best_f1, best_weights = -1, None
    w_audio_range = [0.40, 0.45, 0.50, 0.55, 0.60, 0.65]
    w_text_range = [0.10, 0.15, 0.20, 0.25, 0.30]
    w_acoustic_range = [0.05, 0.10, 0.15, 0.20]

    for wa, wt, wac in product(w_audio_range, w_text_range, w_acoustic_range):
        y_true = [s["ground_truth"] for s in train]
        y_pred = [predict(s, wa, wt, wac) for s in train]
        f1 = macro_f1(y_true, y_pred)
        if f1 > best_f1:
            best_f1 = f1
            best_weights = (wa, wt, wac)

    wa, wt, wac = best_weights
    print(f"Best weights: W_AUDIO={wa}, W_TEXT={wt}, W_ACOUSTIC_CLF={wac}")
    print(f"Train macro-F1: {best_f1:.3f}\n")

    # Evaluate on held-out
    y_true = [s["ground_truth"] for s in test]
    y_pred = [predict(s, wa, wt, wac) for s in test]
    test_f1 = macro_f1(y_true, y_pred)
    acc = sum(1 for t, p in zip(y_true, y_pred) if t == p) / len(y_true)

    print(f"Held-out macro-F1: {test_f1:.3f}")
    print(f"Held-out accuracy: {acc:.1%}\n")

    # Per-class breakdown on test
    print(f"{'Class':<14} {'Prec':>6} {'Rec':>6} {'F1':>6} {'N':>4}")
    print("-" * 40)
    for label in LABELS:
        tp = sum(1 for t, p in zip(y_true, y_pred) if t == label and p == label)
        fp = sum(1 for t, p in zip(y_true, y_pred) if p == label and t != label)
        fn = sum(1 for t, p in zip(y_true, y_pred) if t == label and p != label)
        n = sum(1 for t in y_true if t == label)
        prec = tp / (tp + fp) if (tp + fp) > 0 else 0
        rec = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0
        print(f"{label:<14} {prec:>6.3f} {rec:>6.3f} {f1:>6.3f} {n:>4}")

    print(f"\nTo apply: update W_AUDIO={wa}, W_TEXT={wt}, W_ACOUSTIC_CLF={wac} in ensemble.py")


if __name__ == "__main__":
    main()
