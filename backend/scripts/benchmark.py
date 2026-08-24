"""
Benchmark script: run the analysis pipeline over a labeled dataset and
emit accuracy metrics (overall, per-class, confusion matrix).

Usage:
  cd backend
  python -m scripts.benchmark ../real_speech_eval --labels labels.csv --out benchmark_results.json

Outputs:
  - Console: classification_report + confusion matrix
  - JSON file: full metrics for the Validation page to consume
"""

import argparse
import csv
import json
import logging
import sys
import time
from pathlib import Path

import numpy as np

# Add backend to path so imports work
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.analysis.pipeline import analyze_audio_file, SUPPORTED_EXTENSIONS

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
logger = logging.getLogger(__name__)

TONE_LABELS = ["neutral", "satisfied", "frustrated", "upset", "distressed"]


def load_labels(labels_path: Path) -> dict[str, dict]:
    """Parse labels.csv → {filename: {emotional_tone, ...}}."""
    labels = {}
    with open(labels_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("name", "").strip()
            result_json = row.get("result_json", "").strip()
            if name and result_json:
                try:
                    labels[name] = json.loads(result_json)
                except json.JSONDecodeError:
                    logger.warning("Skipping %s: invalid JSON in labels", name)
    return labels


def find_audio_file(base_dir: Path, filename: str) -> Path | None:
    """Find an audio file by name anywhere under base_dir."""
    for p in base_dir.rglob(filename):
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS:
            return p
    return None


def compute_metrics(predictions: list[str], ground_truths: list[str], filenames: list[str]) -> dict:
    """Compute accuracy, per-class precision/recall/F1, and confusion matrix."""
    present_labels = sorted(set(predictions + ground_truths))
    labels = [l for l in TONE_LABELS if l in present_labels]

    n = len(predictions)
    correct = sum(1 for p, g in zip(predictions, ground_truths) if p == g)
    accuracy = correct / n if n > 0 else 0

    # Per-class metrics
    per_class = []
    for label in labels:
        tp = sum(1 for p, g in zip(predictions, ground_truths) if p == label and g == label)
        fp = sum(1 for p, g in zip(predictions, ground_truths) if p == label and g != label)
        fn = sum(1 for p, g in zip(predictions, ground_truths) if p != label and g == label)
        support = sum(1 for g in ground_truths if g == label)

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0

        per_class.append({
            "class": label,
            "precision": round(precision, 3),
            "recall": round(recall, 3),
            "f1": round(f1, 3),
            "support": support,
        })

    # Confusion matrix
    matrix = [[0] * len(labels) for _ in labels]
    for p, g in zip(predictions, ground_truths):
        if g in labels and p in labels:
            gi = labels.index(g)
            pi = labels.index(p)
            matrix[gi][pi] += 1

    # Per-file results
    file_results = []
    for fname, pred, gt in zip(filenames, predictions, ground_truths):
        file_results.append({
            "filename": fname,
            "predicted": pred,
            "ground_truth": gt,
            "match": pred == gt,
        })

    return {
        "total_samples": n,
        "correct": correct,
        "accuracy": round(accuracy, 4),
        "per_class": per_class,
        "confusion_matrix": {"labels": labels, "matrix": matrix},
        "file_results": file_results,
    }


def main():
    parser = argparse.ArgumentParser(description="Benchmark emotion analysis pipeline")
    parser.add_argument("data_dir", type=Path, help="Directory containing audio files")
    parser.add_argument("--labels", type=str, default="labels.csv", help="Labels CSV filename")
    parser.add_argument("--out", type=str, default="benchmark_results.json", help="Output JSON path")
    parser.add_argument("--max-files", type=int, default=None, help="Limit number of files to process")
    args = parser.parse_args()

    data_dir = args.data_dir.resolve()
    labels_path = data_dir / args.labels

    if not labels_path.exists():
        logger.error("Labels file not found: %s", labels_path)
        sys.exit(1)

    labels = load_labels(labels_path)
    logger.info("Loaded %d labeled files from %s", len(labels), labels_path)

    predictions = []
    ground_truths = []
    filenames = []
    processing_times = []
    errors = []
    details = []

    items = list(labels.items())
    if args.max_files:
        items = items[:args.max_files]

    for i, (filename, gt_data) in enumerate(items, 1):
        gt_tone = gt_data.get("emotional_tone", "")
        if gt_tone not in TONE_LABELS:
            logger.warning("Skipping %s: unknown ground truth tone '%s'", filename, gt_tone)
            continue

        audio_path = find_audio_file(data_dir, filename)
        if audio_path is None:
            logger.warning("Skipping %s: audio file not found", filename)
            continue

        logger.info("[%d/%d] Processing %s (ground truth: %s)", i, len(items), filename, gt_tone)
        t0 = time.time()
        try:
            result, detail = analyze_audio_file(audio_path)
            pred_tone = result.emotional_tone.value
            elapsed = time.time() - t0

            predictions.append(pred_tone)
            ground_truths.append(gt_tone)
            filenames.append(filename)
            processing_times.append(round(elapsed, 1))
            details.append(detail)

            match = "✓" if pred_tone == gt_tone else "✗"
            logger.info("  → %s predicted=%s truth=%s (%.1fs)", match, pred_tone, gt_tone, elapsed)

        except Exception as e:
            logger.error("  → FAILED: %s", e)
            errors.append({"filename": filename, "error": str(e)})

    if not predictions:
        logger.error("No files were successfully processed")
        sys.exit(1)

    metrics = compute_metrics(predictions, ground_truths, filenames)
    metrics["avg_processing_time_sec"] = round(np.mean(processing_times), 1) if processing_times else 0
    metrics["total_processing_time_sec"] = round(sum(processing_times), 1)
    metrics["errors"] = errors

    # Attach per-model detail scores to file_results (for ablation/tune_weights)
    for fr, detail in zip(metrics["file_results"], details):
        fr["detail"] = {
            "audio_emotion": detail.get("audio_emotion", {}),
            "text_emotion": detail.get("text_emotion", {}),
            "acoustic_emotion": detail.get("acoustic_emotion", {}),
        }

    # Console report
    print("\n" + "=" * 60)
    print(f"BENCHMARK RESULTS: {metrics['correct']}/{metrics['total_samples']} = {metrics['accuracy']*100:.1f}%")
    print("=" * 60)
    print(f"\n{'Class':<14} {'Precision':>9} {'Recall':>8} {'F1':>8} {'Support':>8}")
    print("-" * 50)
    for c in metrics["per_class"]:
        print(f"{c['class']:<14} {c['precision']:>9.3f} {c['recall']:>8.3f} {c['f1']:>8.3f} {c['support']:>8d}")
    print("-" * 50)

    cm = metrics["confusion_matrix"]
    print(f"\nConfusion Matrix (rows=actual, cols=predicted):")
    print(f"{'':>14}", "  ".join(f"{l:>10}" for l in cm["labels"]))
    for i, label in enumerate(cm["labels"]):
        print(f"{label:>14}", "  ".join(f"{v:>10}" for v in cm["matrix"][i]))

    if errors:
        print(f"\n{len(errors)} files failed to process")

    # Save JSON
    out_path = Path(args.out).resolve()
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)
    logger.info("Results saved to %s", out_path)


if __name__ == "__main__":
    main()
