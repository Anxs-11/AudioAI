# AutoAce Voice Tone & Background Noise Analyzer

Automated analysis of emotional tone, background noise, and audio quality in production call recordings.

## Live Dashboard

- **URL**: https://audio-ai-wine.vercel.app
- **Login**: `autoace` / `autoace2024`
- **Backend API**: https://audioai-production.up.railway.app

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
| Tone accuracy (production calls) | 100% (3/3) |
| Overall field accuracy | 87.5% (21/24) |
| Non-emotion field accuracy | 99% (367/372 on 93 samples) |
| Processing speed | 0.6–0.9x realtime |
| Inference cost | $0.000/min (all local) |

## Project Structure

```
backend/
  app/
    main.py              # FastAPI app + model warmup
    analysis/
      pipeline.py        # Main orchestrator
      emotion_model.py   # Wav2Vec2 + fine-tuned 5-class classifier
      transcription.py   # Whisper (faster-whisper)
      diarization.py     # Pause-based speaker separation
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

| Volume | Hosting Cost | Per-Minute Cost |
|--------|-------------|-----------------|
| 1,000 min/month | $5 (Railway) | $0.005 |
| 5,000 min/month | $5 (Railway) | $0.001 |
| 10,000+ min/month | $5 (Railway) | <$0.001 |

Comfortably within the $0.003/minute ceiling at production volumes.
