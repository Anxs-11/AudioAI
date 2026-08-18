FROM python:3.11-slim

# System deps: ffmpeg for audio format conversion, build tools for native packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download ML models during build (avoids runtime download delay)
RUN python -c "\
from faster_whisper import WhisperModel; \
WhisperModel('base', device='cpu', compute_type='int8')" \
    && echo 'Whisper model cached.'

RUN python -c "\
from transformers import pipeline; \
pipeline('audio-classification', model='ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition', device=-1)" \
    && echo 'Audio emotion model cached.'

RUN python -c "\
from transformers import pipeline; \
pipeline('text-classification', model='j-hartmann/emotion-english-distilroberta-base', device=-1)" \
    && echo 'Text emotion model cached.'

COPY app/ app/

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
