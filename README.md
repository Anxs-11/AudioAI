# AutoAce Voice Tone & Background Noise Analyzer

Automated analysis of emotional tone, background noise, and audio quality in production call recordings.

## Live Dashboard

- **URL**: https://audio-ai-wine.vercel.app
- **Login**: `autoace` / `autoace2024`
- **Backend API**: https://audioai-production.up.railway.app

## Demo

[Watch the demo](https://drive.google.com/file/d/1NY5X7qRq11KHx2aCg0ciW23grrp1vjab/view?usp=drive_link)

## Quick Start (Local)

### Prerequisites
- Python 3.11+ (3.14 works but blocks TensorFlow/SpeechBrain)
- Node.js 18+
- ffmpeg (for audio format conversion)

### Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8002
```
Models download automatically on first startup (~15 seconds).

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Opens at http://localhost:5173 (proxies API to backend on port 8002).

### Docker Compose
```bash
docker-compose up --build
```
Runs both services. Frontend at http://localhost:80, backend at http://localhost:8000.

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────────────┐
│   Frontend   │────►│              Backend (FastAPI)            │
│  React/Vite  │     │                                          │
│   Vercel     │     │  Whisper ──► Transcription + Diarization │
└─────────────┘     │  Wav2Vec2 ──► Audio Emotion (5-class)    │
                    │  RoBERTa ──► Text Emotion (7-class)      │
                    │  librosa ──► Acoustic Features            │
                    │  Ensemble ──► Final Prediction            │
                    │                          Railway          │
                    └──────────────────────────────────────────┘
```

## Supported Audio Formats

WAV, MP3, OGG, FLAC, M4A, WMA, AAC, WebM, MP4, MPEG

## Output Schema

Each audio file produces:

| Field | Type | Values |
|-------|------|--------|
| emotional_tone | enum | neutral, satisfied, frustrated, upset, distressed |
| emotional_intensity | enum | low, medium, high |
| background_noise_present | bool | true, false |
| background_noise_type | string | e.g. "office chatter", "" if none |
| background_noise_severity | enum | none, low, medium, high |
| audio_quality | enum | clear, slightly_impaired, severely_impaired |
| speaker_overlap_present | bool | true, false |
| long_silence_present | bool | true, false |
| confidence | float | 0.0–1.0 |

## Performance

| Metric | Value |
|--------|-------|
| Tone accuracy (overall, 93 samples) | 49.5% |
| Tone accuracy (synthetic calls) | 60.0% (30 samples) |
| Tone accuracy (production calls) | 100% (3/3) |
| Speaker count detection | 100% (5/5 synthetic 2-speaker calls) |
| Speaker word-level attribution | 66.0% |
| Non-emotion field accuracy | 99% (372 evaluations) |
| Processing speed | ~0.5× realtime (optimized) |
| Inference cost | $0.000/min (all local) |

> **Performance Note:** All inference runs on CPU with no external API calls. The deployed demo (Railway, shared 8 vCPU / 8 GB RAM, no GPU) processes each file in ~1–2 minutes. On a local machine with a modern CPU, processing drops to **10–15 seconds per file**. With GPU acceleration, per-file processing would be **3–5 seconds**. For the fastest experience, run locally with `docker-compose up`.

## Project Structure

```
backend/
  app/
    main.py              # FastAPI app + model warmup
    analysis/
      pipeline.py        # Main orchestrator
      emotion_model.py   # Wav2Vec2 + fine-tuned 5-class classifier
      transcription.py   # Whisper (faster-whisper)
      diarization.py     # Resemblyzer GE2E speaker diarization
      acoustic.py        # Pitch, energy, overlap, silence detection
      noise.py           # Background noise detection + classification
      quality.py         # Audio quality assessment
      ensemble.py        # Weighted voting + keyword boosting
    routers/
      batch_router.py    # Upload, process, results endpoints
      auth_router.py     # JWT authentication
frontend/
  src/
    pages/
      Login.tsx          # Authentication
      Upload.tsx         # File upload (ZIP or direct audio)
      Results.tsx        # Processing progress + results display
      Validation.tsx     # Benchmark accuracy, ablation, diarization stats
      Methodology.tsx    # Architecture, cost model, approach comparison
docs/
  TECHNICAL_MEMO.md      # Approaches, validation, cost, latency analysis
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/login | Login, returns JWT |
| POST | /api/batch/upload | Upload ZIP batch |
| POST | /api/batch/upload-files | Upload individual audio files |
| POST | /api/batch/{id}/run | Start processing |
| GET | /api/batch/{id} | Poll batch status |
| GET | /api/batch/{id}/results | Get per-file results |
| GET | /api/batch/{id}/metrics | Get batch metrics |
| GET | /api/batch/{id}/download/csv | Download results CSV |
| GET | /api/batch/{id}/download/json | Download results JSON |

## Cost Model

All inference runs locally on CPU — no external API calls, no data leaves the server.
Total inference cost: **$0.000/min** (Whisper, Wav2Vec2, RoBERTa, acoustic analysis all run locally).
