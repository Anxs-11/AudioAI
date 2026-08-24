"""Speaker diarization using resemblyzer GE2E embeddings + agglomerative clustering."""

import logging
from dataclasses import dataclass, field

import numpy as np

from app.config import SAMPLE_RATE

logger = logging.getLogger(__name__)


@dataclass
class SpeakerSegment:
    speaker: str          # "agent" or "customer"
    start_sec: float
    end_sec: float
    text: str = ""


@dataclass
class DiarizationResult:
    segments: list[SpeakerSegment] = field(default_factory=list)
    customer_audio: np.ndarray = field(default_factory=lambda: np.array([], dtype=np.float32))
    agent_audio: np.ndarray = field(default_factory=lambda: np.array([], dtype=np.float32))
    customer_text: str = ""
    agent_text: str = ""
    num_speakers: int = 2


def diarize_call(
    audio: np.ndarray,
    sr: int,
    word_timestamps: list[dict],
) -> DiarizationResult:
    result = DiarizationResult()

    if not word_timestamps:
        logger.info("Diarization: no word timestamps, 1 speaker")
        result.customer_audio = audio
        result.num_speakers = 1
        return result

    logger.info("Diarization: %d words, span %.1f–%.1fs",
                len(word_timestamps), word_timestamps[0]["start"], word_timestamps[-1]["end"])

    if len(word_timestamps) < 3 or word_timestamps[-1]["end"] - word_timestamps[0]["start"] < 2.0:
        logger.info("Diarization: too few words or too short, 1 speaker")
        result.customer_audio = audio
        result.customer_text = " ".join(w["word"] for w in word_timestamps)
        result.num_speakers = 1
        return result

    # Build per-word speaker labels via sliding-window pitch clustering
    word_speakers = _cluster_words_by_voice(word_timestamps, audio, sr)

    if word_speakers is None:
        logger.info("Diarization: clustering returned None, treating as 1 speaker")
        result.customer_audio = audio
        result.customer_text = " ".join(w["word"] for w in word_timestamps)
        result.num_speakers = 1
        return result

    # Merge consecutive same-speaker words into segments
    segments: list[dict] = []
    cur = {"speaker": word_speakers[0], "start": word_timestamps[0]["start"],
           "end": word_timestamps[0]["end"], "words": [word_timestamps[0]["word"]]}

    for i in range(1, len(word_timestamps)):
        if word_speakers[i] == cur["speaker"]:
            cur["end"] = word_timestamps[i]["end"]
            cur["words"].append(word_timestamps[i]["word"])
        else:
            cur["text"] = " ".join(cur["words"])
            segments.append(cur)
            cur = {"speaker": word_speakers[i], "start": word_timestamps[i]["start"],
                   "end": word_timestamps[i]["end"], "words": [word_timestamps[i]["word"]]}
    cur["text"] = " ".join(cur["words"])
    segments.append(cur)

    segments = _smooth_segments(segments, min_dur=0.6)

    spk_labels = sorted(set(s["speaker"] for s in segments))
    if len(spk_labels) < 2:
        result.customer_audio = audio
        result.customer_text = " ".join(w["word"] for w in word_timestamps)
        result.num_speakers = 1
        return result

    first_spk = segments[0]["speaker"]
    other_spk = [l for l in spk_labels if l != first_spk][0]
    agent_label, customer_label = first_spk, other_spk

    # If the second speaker's first segment looks like an agent greeting, swap
    AGENT_PATTERNS = ("thank you for calling", "how can i help", "how may i help",
                      "this is", "my name is", "speaking", "what can i do for you",
                      "welcome to", "thanks for calling")
    second_segs = [s for s in segments if s["speaker"] == other_spk]
    if second_segs:
        second_text = second_segs[0]["text"].lower()
        if any(p in second_text for p in AGENT_PATTERNS):
            agent_label, customer_label = other_spk, first_spk

    for s in segments:
        s["role"] = "speaker_1" if s["speaker"] == agent_label else "speaker_2"

    # Extract audio per speaker
    customer_segs, agent_segs = [], []
    for s in segments:
        start_sample = int(s["start"] * sr)
        end_sample = int(s["end"] * sr)
        seg_audio = audio[start_sample:end_sample]
        if s["role"] == "speaker_2":
            customer_segs.append(seg_audio)
        else:
            agent_segs.append(seg_audio)
        result.segments.append(SpeakerSegment(
            speaker=s["role"], start_sec=s["start"], end_sec=s["end"], text=s["text"]))

    result.customer_audio = np.concatenate(customer_segs) if customer_segs else np.array([], dtype=np.float32)
    result.agent_audio = np.concatenate(agent_segs) if agent_segs else np.array([], dtype=np.float32)
    result.customer_text = " ".join(s["text"] for s in segments if s["role"] == "speaker_2")
    result.agent_text = " ".join(s["text"] for s in segments if s["role"] == "speaker_1")
    result.num_speakers = len(spk_labels)

    logger.info("Diarization: %d segments, customer=%d words, agent=%d words",
                len(result.segments),
                len(result.customer_text.split()),
                len(result.agent_text.split()))
    return result


def _cluster_words_by_voice(
    word_timestamps: list[dict],
    audio: np.ndarray,
    sr: int,
) -> list[str] | None:
    """Assign speaker labels using resemblyzer speaker embeddings + agglomerative clustering."""
    from resemblyzer import preprocess_wav
    from sklearn.cluster import AgglomerativeClustering
    from sklearn.metrics import silhouette_score

    encoder = _get_speaker_encoder()

    chunks = _build_chunks(word_timestamps, target_dur=3.0, min_dur=1.2)
    if len(chunks) < 2:
        logger.info("Clustering: only %d chunks, need >= 2", len(chunks))
        return None

    logger.info("Clustering: extracting speaker embeddings for %d chunks", len(chunks))
    embeddings = []
    for chunk in chunks:
        start = max(0, int(chunk["start"] * sr))
        end = min(len(audio), int(chunk["end"] * sr))
        seg = preprocess_wav(audio[start:end], source_sr=sr)
        if len(seg) < sr * 1.0:
            embeddings.append(None)
            continue
        emb = encoder.embed_utterance(seg)
        embeddings.append(emb)

    valid_indices = [i for i, e in enumerate(embeddings) if e is not None]
    if len(valid_indices) < 2:
        logger.info("Clustering: only %d valid embeddings", len(valid_indices))
        return None

    valid_embs = np.array([embeddings[i] for i in valid_indices])

    # L2-normalize for cosine distance
    norms = np.linalg.norm(valid_embs, axis=1, keepdims=True)
    norms[norms < 1e-8] = 1.0
    valid_embs = valid_embs / norms

    # Single-speaker check: if embeddings are all very similar, one voice
    dists = 1.0 - valid_embs @ valid_embs.T
    tri = dists[np.triu_indices(len(valid_embs), k=1)]
    if np.percentile(tri, 90) < 0.20:
        logger.info("Clustering: embeddings too similar (p90 dist=%.3f), 1 speaker",
                    np.percentile(tri, 90))
        return None

    # Select best k via silhouette score, biased toward fewer speakers
    best_k, best_labels, best_score = 1, None, -1.0
    for k in (2, 3, 4):
        if len(valid_embs) < k + 2:
            break
        labels_k = AgglomerativeClustering(
            n_clusters=k, metric="cosine", linkage="average"
        ).fit_predict(valid_embs)
        score = silhouette_score(valid_embs, labels_k, metric="cosine")
        # Higher k must clearly earn its keep
        margin = 0.0 if k == 2 else 0.06
        if score > best_score + margin:
            best_k, best_labels, best_score = k, labels_k, score

    if best_labels is None or best_score < 0.10:
        logger.info("Clustering: silhouette too low (%.3f), treating as 1 speaker", best_score)
        return None

    labels = list(best_labels)
    logger.info("Clustering: selected k=%d (silhouette=%.3f)", best_k, best_score)

    # Build chunk labels, fill invalid from neighbors
    chunk_labels = [None] * len(chunks)
    for idx, vi in enumerate(valid_indices):
        chunk_labels[vi] = f"speaker_{labels[idx] + 1}"
    for i in range(len(chunk_labels)):
        if chunk_labels[i] is None:
            for j in range(i - 1, -1, -1):
                if chunk_labels[j] is not None:
                    chunk_labels[i] = chunk_labels[j]
                    break
            else:
                for j in range(i + 1, len(chunk_labels)):
                    if chunk_labels[j] is not None:
                        chunk_labels[i] = chunk_labels[j]
                        break

    # Smooth: if a chunk's label differs from both neighbors, flip it
    for i in range(1, len(chunk_labels) - 1):
        if chunk_labels[i] != chunk_labels[i - 1] and chunk_labels[i] != chunk_labels[i + 1]:
            chunk_labels[i] = chunk_labels[i - 1]

    # All words in a chunk get the chunk's label
    word_labels = ["speaker_1"] * len(word_timestamps)
    for ci, chunk in enumerate(chunks):
        for wi in chunk["word_indices"]:
            word_labels[wi] = chunk_labels[ci]

    return word_labels


_spk_encoder = None

def _get_speaker_encoder():
    global _spk_encoder
    if _spk_encoder is None:
        from resemblyzer import VoiceEncoder
        logger.info("Loading resemblyzer speaker encoder...")
        _spk_encoder = VoiceEncoder("cpu")
        logger.info("Speaker encoder loaded.")
    return _spk_encoder


def _build_chunks(word_timestamps: list[dict], target_dur: float = 3.0, min_dur: float = 1.2) -> list[dict]:
    """Group words into chunks; only split at pauses when chunk is long enough to embed."""
    chunks = []
    cur_words = [word_timestamps[0]]
    cur_start = word_timestamps[0]["start"]

    for i in range(1, len(word_timestamps)):
        pause = word_timestamps[i]["start"] - word_timestamps[i - 1]["end"]
        dur = word_timestamps[i - 1]["end"] - cur_start

        if (pause >= 0.4 and dur >= min_dur) or dur >= target_dur:
            chunks.append({
                "start": cur_start,
                "end": word_timestamps[i - 1]["end"],
                "word_indices": list(range(i - len(cur_words), i)),
            })
            cur_words = [word_timestamps[i]]
            cur_start = word_timestamps[i]["start"]
        else:
            cur_words.append(word_timestamps[i])

    if cur_words:
        n = len(word_timestamps)
        chunks.append({
            "start": cur_start,
            "end": word_timestamps[-1]["end"],
            "word_indices": list(range(n - len(cur_words), n)),
        })

    # Merge tail chunk into previous if too short
    if len(chunks) > 1:
        tail_dur = chunks[-1]["end"] - chunks[-1]["start"]
        if tail_dur < min_dur:
            chunks[-2]["end"] = chunks[-1]["end"]
            chunks[-2]["word_indices"].extend(chunks[-1]["word_indices"])
            chunks.pop()

    return chunks


def _smooth_segments(segments: list[dict], min_dur: float = 0.6) -> list[dict]:
    """Merge very short segments only when surrounded by the same speaker."""
    if len(segments) <= 1:
        return segments

    merged = [segments[0]]
    for i, seg in enumerate(segments[1:], 1):
        dur = seg["end"] - seg["start"]
        prev_same = merged and merged[-1]["speaker"] == seg["speaker"]
        nxt = segments[i + 1] if i + 1 < len(segments) else None
        surrounded = merged and nxt and merged[-1]["speaker"] == nxt["speaker"]
        if dur < min_dur and (prev_same or surrounded):
            merged[-1]["end"] = seg["end"]
            merged[-1]["words"].extend(seg["words"])
            merged[-1]["text"] = " ".join(merged[-1]["words"])
        else:
            merged.append(seg)
    return merged
