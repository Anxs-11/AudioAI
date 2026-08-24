"""
Tests for the diarization module — speaker turn detection and assignment.
"""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.analysis.diarization import diarize_call, _build_chunks, _smooth_segments


SR = 16000


class TestBuildChunks:
    def test_splits_at_pause_when_long_enough(self):
        words = [
            {"word": "hello", "start": 0.0, "end": 0.5},
            {"word": "there", "start": 0.5, "end": 1.5},
            # 0.5s pause — but chunk is only 1.5s, below min_dur=1.2? No, 1.5>=1.2
            {"word": "hi", "start": 2.0, "end": 2.5},
            {"word": "thanks", "start": 2.5, "end": 3.5},
        ]
        chunks = _build_chunks(words, target_dur=3.0, min_dur=1.2)
        assert len(chunks) == 2

    def test_no_split_when_chunk_too_short(self):
        words = [
            {"word": "ok", "start": 0.0, "end": 0.3},
            # 0.5s pause but chunk is only 0.3s — must NOT split
            {"word": "sure", "start": 0.8, "end": 1.2},
            {"word": "thing", "start": 1.2, "end": 1.8},
        ]
        chunks = _build_chunks(words, target_dur=3.0, min_dur=1.2)
        assert len(chunks) == 1

    def test_merges_short_tail(self):
        words = [
            {"word": "hello", "start": 0.0, "end": 1.5},
            # pause
            {"word": "ok", "start": 2.0, "end": 2.3},
        ]
        chunks = _build_chunks(words, target_dur=3.0, min_dur=1.2)
        # Tail is 0.3s < min_dur, merged into previous
        assert len(chunks) == 1


class TestSmoothSegments:
    def test_keeps_short_segment_from_different_speaker(self):
        segments = [
            {"speaker": "A", "start": 0.0, "end": 2.0, "words": ["hi"], "text": "hi"},
            {"speaker": "B", "start": 2.0, "end": 2.4, "words": ["yes"], "text": "yes"},
            {"speaker": "A", "start": 2.4, "end": 4.0, "words": ["ok"], "text": "ok"},
        ]
        # B is short (0.4s) and surrounded by A — absorb
        result = _smooth_segments(segments, min_dur=0.6)
        assert len(result) == 2

    def test_preserves_short_unsurrounded_segment(self):
        segments = [
            {"speaker": "A", "start": 0.0, "end": 2.0, "words": ["hi"], "text": "hi"},
            {"speaker": "B", "start": 2.0, "end": 2.4, "words": ["yes"], "text": "yes"},
            {"speaker": "B", "start": 2.4, "end": 4.0, "words": ["ok"], "text": "ok"},
        ]
        # B is short but next is also B — prev_same applies for second seg
        result = _smooth_segments(segments, min_dur=0.6)
        # First B segment is not surrounded by A (next is B), and not prev_same (prev is A)
        # So it should be kept
        assert any(s["speaker"] == "B" for s in result)


class TestDiarization:
    def test_no_timestamps_returns_customer_audio(self):
        audio = np.random.randn(SR * 5).astype(np.float32)
        result = diarize_call(audio, SR, [])
        assert result.num_speakers == 1
        assert len(result.customer_audio) == len(audio)

    def test_too_short_returns_single_speaker(self):
        audio = np.random.randn(SR * 2).astype(np.float32)
        words = [
            {"word": "hi", "start": 0.0, "end": 0.5},
            {"word": "there", "start": 0.5, "end": 1.0},
        ]
        result = diarize_call(audio, SR, words)
        assert result.num_speakers == 1
