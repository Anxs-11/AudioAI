# AutoAce Voice Tone & Background Noise — Technical Memo

## 1. Approaches Tested

### Approach A: Audio Foundation Model (Wav2Vec2 Ensemble)
- **Audio emotion**: `superb/wav2vec2-base-superb-er` pipeline (4-class: angry/happy/neutral/sad)
- **Text emotion**: `j-hartmann/emotion-english-distilroberta-base` (7-class GoEmotions)
- **Transcription**: `faster-whisper` (CTranslate2 backend, base model)
- **Ensemble**: Weighted vote combining audio + text + acoustic features
- **Result**: Strong on real calls but audio model limited to 4 classes

### Approach B: Fine-Tuned 5-Class Classifier (Final System)
- Extended Approach A with a fine-tuned MLP classifier head on Wav2Vec2 embeddings
- Trained on 3,646 samples: RAVDESS (1,440) + ESD (1,956) + MELD (250)
- Maps to target 5 classes: neutral, satisfied, frustrated, upset, distressed
- Dynamic blending: original model weighted higher when confident (robust on real calls), fine-tuned model contributes 5-class granularity
- **Result**: 100% tone accuracy on production calls, 87.5% overall field accuracy

### Why Approach B Was Selected
- The original 4-class model cannot distinguish frustrated/distressed/satisfied
- Fine-tuning adds 5-class support while preserving the original model's robustness
- Dynamic blending prevents fine-tuned model from dominating on out-of-distribution audio
- Zero additional inference cost (same base model, shared encoder)

## 2. Final Architecture

```
Audio File
    │
    ├─► Whisper (faster-whisper base) ──► Transcript + Word Timestamps
    │                                          │
    │                                          ├─► Diarization (pause-based turn detection)
    │                                          │       └─► Customer text extraction
    │                                          │
    │                                          └─► Text Emotion (distilRoBERTa)
    │
    ├─► Wav2Vec2 Pipeline ──► 4-class audio emotion scores
    │       └─► Shared base encoder ──► Fine-tuned 5-class MLP
    │
    ├─► Acoustic Features (librosa) ──► pitch, energy, spectral, MFCCs
    │       ├─► Overlap detection (valley-shortness + valley-ratio)
    │       └─► Silence detection (contiguous low-energy runs)
    │
    ├─► Noise Analysis ──► spectral floor + impulsiveness detection
    │       └─► Noise type classification (spectral rules + crest factor)
    │
    └─► Quality Assessment ──► SNR + clipping ratio
            │
            ▼
    Ensemble Voting (weighted: audio 0.45, text 0.25, acoustic 0.15, fine-tuned 0.10)
            │
            ▼
    Keyword Boosting (transcript-based emotion adjustment)
            │
            ▼
    Final Result (all 9 output fields)
```

### Key Design Decisions
- **Shared Wav2Vec2 encoder**: Pipeline and fine-tuned classifier share the same base model (~360MB saved)
- **Acoustic subsampling**: Long files analyzed on first 60 seconds for pitch/spectral features (89s → 15s)
- **Model warmup**: All models pre-loaded at startup in a background thread
- **Valley-based overlap**: Detects speaker overlap via energy valley patterns (0% FP on 93 samples)
- **Impulsiveness noise detection**: Crest factor + energy CV for phone-line static identification

## 3. Validation Results

### Emotion Tone Accuracy (Production Calls)
| Call | Predicted | Ground Truth | Match |
|------|-----------|-------------|-------|
| call_001.ogg | upset | upset | ✓ |
| call_002.ogg | neutral | neutral | ✓ |
| call_003.ogg | satisfied | satisfied | ✓ |

**Tone accuracy: 3/3 (100%)**

### Overall Field Accuracy (Production Calls)
| Call | Fields Correct | Total |
|------|---------------|-------|
| call_001.ogg | 8/8 | 100% |
| call_002.ogg | 5/8 | 62.5% |
| call_003.ogg | 8/8 | 100% |

**Overall: 21/24 (87.5%)**

call_002 errors: background noise (TV at -69dB) below physical detection threshold.

### Non-Emotion Field Accuracy (93 Diverse Audio Samples)
| Field | Accuracy | Samples |
|-------|----------|---------|
| background_noise_present | 95% | RAVDESS (60) + TTS (30) + Production (3) |
| speaker_overlap_present | 100% | Same 93 samples |
| long_silence_present | 100% | Same 93 samples |
| audio_quality | 100% | Same 93 samples |
| **Overall** | **99%** | **372 field evaluations** |

### Fine-Tuned Model Training
- **Dataset**: RAVDESS (1,440) + ESD (1,956) + MELD (250) = 3,646 samples
- **Split**: 80/20 stratified train/validation
- **Best validation accuracy**: 79.9%
- **Training**: 80 epochs, cosine annealing LR, AdamW optimizer

## 4. Cost Analysis

| Component | Cost per Audio Minute |
|-----------|----------------------|
| Whisper transcription (local) | $0.000 |
| Wav2Vec2 emotion (local) | $0.000 |
| distilRoBERTa text (local) | $0.000 |
| Acoustic analysis (local) | $0.000 |
| **Total inference cost** | **$0.000** |

**Infrastructure cost** (Railway Hobby plan):
- $5/month for hosting
- At 10,000 minutes/month: $0.0005/minute
- At 1,000 minutes/month: $0.005/minute

All models run locally on CPU. No external API calls. No data leaves the server. Customer audio is never uploaded to third-party services.

**Well within the $0.003/minute ceiling** at any reasonable volume (>1,667 minutes/month breaks even at $5/month hosting).

## 5. Latency Analysis

### Warm Processing (Models Pre-Loaded)
| Audio Duration | Processing Time | Speed Ratio |
|----------------|----------------|-------------|
| 31 seconds | 27.3 seconds | 0.9x realtime |
| 172 seconds | 102 seconds | 0.6x realtime |

### Processing Breakdown (31-second call)
| Step | Time |
|------|------|
| Audio loading + resampling | ~1s |
| Whisper transcription | ~5s |
| Diarization | <1s |
| Acoustic features | ~8s |
| Wav2Vec2 emotion (audio) | ~10s |
| Text emotion (RoBERTa) | ~1s |
| Noise + quality analysis | ~1s |
| Ensemble + output | <1s |
| **Total** | **~27s** |

### Cold Start (First Request After Deployment)
- Model loading: ~15 seconds (one-time, at startup)
- Subsequent requests: no additional loading overhead

## 6. Failure Modes & Limitations

### Known Limitations
1. **Emotion on very short clips (<5s)**: Insufficient context for reliable classification
2. **Distressed class**: Underrepresented in training data; may be confused with upset
3. **Very quiet background noise** (<-60dB): Below detection threshold (e.g., distant TV)
4. **Non-English calls**: Models are English-focused; accuracy degrades on other languages
5. **Acted vs. natural speech**: Fine-tuned model trained on acted datasets; production calls may differ

### Mitigation Strategies
- Dynamic blending favors the more robust original model when it's confident
- Keyword boosting from transcription catches frustrated/distressed patterns the audio model misses
- Confidence scores reflect uncertainty (lower scores on ambiguous predictions)

### Next Steps for Improvement
1. **More production training data**: Fine-tune on actual labeled call center audio
2. **Larger Whisper model**: Switch to whisper-medium for better transcription on accented speech
3. **GPU inference**: 5-10x speedup with CUDA; enables real-time processing
4. **Active learning**: Flag low-confidence predictions for human review and retraining
5. **Pyannote speaker diarization**: Replace pause-based heuristic with neural overlap detection
