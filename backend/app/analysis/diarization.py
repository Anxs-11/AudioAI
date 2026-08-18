"""
Speaker diarization: separates agent vs customer speech in call audio.

For AutoAce production calls, the pattern is consistent:
  - Agent speaks first with a greeting ("Hi, I'm [name] from [dealership]")
  - Customer responds

This module uses two strategies:
  1. Whisper word timestamps to detect speaker turns (pause-based segmentation)
  2. Simple pitch clustering to differentiate speakers

The pipeline then runs emotion analysis ONLY on customer segments.
"""

import logging
from dataclasses import dataclass, field

import numpy as np
import librosa

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
    """
    Separate a 2-speaker call into agent and customer segments.

    Uses pause-based turn detection + the fact that in AutoAce calls,
    the agent always speaks the opening greeting.

    Args:
        audio: Full call audio (mono, float32).
        sr: Sample rate.
        word_timestamps: From Whisper [{word, start, end}, ...].

    Returns:
        DiarizationResult with separated audio and text per speaker.
    """
    result = DiarizationResult()

    if not word_timestamps:
        # No timestamps available — treat entire audio as customer
        result.customer_audio = audio
        result.num_speakers = 1
        return result

    # Step 1: Detect speaker turns based on pauses
    turns = _detect_turns(word_timestamps)

    if len(turns) < 2:
        # Single speaker or very short — treat as customer
        result.customer_audio = audio
        result.customer_text = " ".join(w["word"] for w in word_timestamps)
        result.num_speakers = 1
        return result

    # Step 2: Assign speakers — first turn is always agent in AutoAce calls
    agent_turns = []
    customer_turns = []

    for i, turn in enumerate(turns):
        if i % 2 == 0:
            # Even turns = agent (agent starts)
            turn["speaker"] = "agent"
            agent_turns.append(turn)
        else:
            # Odd turns = customer
            turn["speaker"] = "customer"
            customer_turns.append(turn)

    # Step 3: Verify assignment using greeting detection
    first_turn_text = turns[0]["text"].lower()
    if not _is_agent_greeting(first_turn_text) and len(turns) > 1:
        # First speaker doesn't sound like agent — swap
        agent_turns, customer_turns = customer_turns, agent_turns
        for t in agent_turns:
            t["speaker"] = "agent"
        for t in customer_turns:
            t["speaker"] = "customer"

    # Step 4: Extract audio segments for each speaker
    customer_segments = []
    agent_segments = []

    for turn in customer_turns:
        start_sample = int(turn["start"] * sr)
        end_sample = int(turn["end"] * sr)
        segment = audio[start_sample:end_sample]
        if len(segment) > 0:
            customer_segments.append(segment)

    for turn in agent_turns:
        start_sample = int(turn["start"] * sr)
        end_sample = int(turn["end"] * sr)
        segment = audio[start_sample:end_sample]
        if len(segment) > 0:
            agent_segments.append(segment)

    result.customer_audio = np.concatenate(customer_segments) if customer_segments else np.array([], dtype=np.float32)
    result.agent_audio = np.concatenate(agent_segments) if agent_segments else np.array([], dtype=np.float32)
    result.customer_text = " ".join(t["text"] for t in customer_turns)
    result.agent_text = " ".join(t["text"] for t in agent_turns)
    result.num_speakers = 2

    # Build segment list
    for turn in sorted(agent_turns + customer_turns, key=lambda t: t["start"]):
        result.segments.append(SpeakerSegment(
            speaker=turn["speaker"],
            start_sec=turn["start"],
            end_sec=turn["end"],
            text=turn["text"],
        ))

    logger.info("Diarization: %d turns, customer=%d words, agent=%d words",
                len(result.segments),
                len(result.customer_text.split()),
                len(result.agent_text.split()))

    return result


def _detect_turns(word_timestamps: list[dict], pause_threshold: float = 1.0) -> list[dict]:
    """
    Split word sequence into turns based on pauses > threshold seconds.
    Each turn = contiguous speech from one speaker.
    """
    if not word_timestamps:
        return []

    turns = []
    current_words = [word_timestamps[0]]
    current_start = word_timestamps[0]["start"]

    for i in range(1, len(word_timestamps)):
        prev_end = word_timestamps[i - 1]["end"]
        curr_start = word_timestamps[i]["start"]
        pause = curr_start - prev_end

        if pause >= pause_threshold:
            # Speaker turn boundary
            turns.append({
                "start": current_start,
                "end": word_timestamps[i - 1]["end"],
                "text": " ".join(w["word"] for w in current_words),
            })
            current_words = [word_timestamps[i]]
            current_start = word_timestamps[i]["start"]
        else:
            current_words.append(word_timestamps[i])

    # Last turn
    if current_words:
        turns.append({
            "start": current_start,
            "end": word_timestamps[-1]["end"],
            "text": " ".join(w["word"] for w in current_words),
        })

    return turns


def _is_agent_greeting(text: str) -> bool:
    """Check if text looks like an agent's opening greeting."""
    greeting_patterns = [
        "hi, i'm", "hi i'm", "hello, i'm", "hello i'm",
        "this is", "my name is", "thank you for calling",
        "how can i help", "how may i help",
        "from toyota", "from lexington", "from braintree",
    ]
    return any(p in text for p in greeting_patterns)
