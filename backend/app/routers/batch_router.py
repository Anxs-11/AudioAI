"""
Batch upload, processing, and results endpoints.

Workflow:
  1. POST /api/batch/upload   – Upload a ZIP containing audio files + labels.csv
  2. POST /api/batch/{id}/run – Start processing (runs as a background task)
  3. GET  /api/batch/{id}     – Poll batch status
  4. GET  /api/batch/{id}/results – Get per-file results
  5. GET  /api/batch/{id}/download/csv  – Download results as CSV
  6. GET  /api/batch/{id}/download/json – Download results as JSON
  7. GET  /api/batches         – List all batches for the user
"""

import csv
import io
import json
import logging
import shutil
import traceback
import zipfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.analysis.pipeline import SUPPORTED_EXTENSIONS, analyze_audio_file
from app.auth import get_current_user
from app.config import UPLOAD_DIR
from app.database import async_session, get_db
from app.models import Batch, FileResult, User
from app.schemas import BatchStatusResponse, FileResultResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/batch", tags=["batch"])


# Upload

@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload_batch(
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Upload a ZIP archive containing audio files and an optional labels.csv.
    Creates a Batch record and FileResult stubs for each audio file found.
    """
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Please upload a .zip file")

    # Save ZIP to disk
    batch = Batch(user_id=user.id, status="pending")
    db.add(batch)
    await db.commit()
    await db.refresh(batch)

    batch_dir = UPLOAD_DIR / str(batch.id)
    batch_dir.mkdir(parents=True, exist_ok=True)

    zip_path = batch_dir / "upload.zip"
    content = await file.read()

    MAX_UPLOAD_BYTES = 200 * 1024 * 1024  # 200 MB
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Upload exceeds 200 MB limit")

    zip_path.write_bytes(content)

    # Extract ZIP
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            # Security: prevent path traversal and zip bombs
            total_uncompressed = sum(i.file_size for i in zf.infolist())
            if total_uncompressed > 500 * 1024 * 1024:
                raise HTTPException(status_code=400, detail="ZIP contents exceed 500 MB uncompressed limit")
            if len(zf.infolist()) > 500:
                raise HTTPException(status_code=400, detail="ZIP contains too many files (max 500)")
            for member in zf.namelist():
                if member.startswith("/") or ".." in member:
                    raise HTTPException(status_code=400, detail=f"Invalid path in ZIP: {member}")
            zf.extractall(batch_dir / "files")
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid or corrupted ZIP file")

    # Find audio files (may be at root or inside a single subfolder)
    audio_files = _find_audio_files(batch_dir / "files")

    if not audio_files:
        raise HTTPException(status_code=400, detail="No supported audio files found in ZIP")

    # Parse labels.csv if present
    labels_map = _parse_labels_csv(batch_dir / "files")

    # Create FileResult stubs
    validation_errors = []
    for af in audio_files:
        fr = FileResult(batch_id=batch.id, filename=af.name, status="pending")
        db.add(fr)

    # Report files in CSV but not found in ZIP
    if labels_map:
        found_names = {af.name for af in audio_files}
        for csv_name in labels_map:
            if csv_name not in found_names:
                validation_errors.append(f"CSV references '{csv_name}' but file not found in ZIP")

    batch.total_files = len(audio_files)
    await db.commit()
    await db.refresh(batch)

    return {
        "batch_id": batch.id,
        "total_files": len(audio_files),
        "files": [af.name for af in audio_files],
        "validation_errors": validation_errors,
    }


@router.post("/upload-files", status_code=status.HTTP_201_CREATED)
async def upload_files(
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload individual audio files directly (no ZIP required)."""
    batch = Batch(user_id=user.id, status="pending")
    db.add(batch)
    await db.commit()
    await db.refresh(batch)

    batch_dir = UPLOAD_DIR / str(batch.id) / "files"
    batch_dir.mkdir(parents=True, exist_ok=True)

    saved = []
    for f in files:
        if not f.filename:
            continue
        ext = Path(f.filename).suffix.lower()
        if ext not in SUPPORTED_EXTENSIONS:
            continue
        dest = batch_dir / f.filename
        dest.write_bytes(await f.read())
        saved.append(f.filename)
        fr = FileResult(batch_id=batch.id, filename=f.filename, status="pending")
        db.add(fr)

    if not saved:
        raise HTTPException(status_code=400, detail="No supported audio files found")

    batch.total_files = len(saved)
    await db.commit()
    await db.refresh(batch)

    return {
        "batch_id": batch.id,
        "total_files": len(saved),
        "files": saved,
        "validation_errors": [],
    }


# Single-file instant analysis (for live mic demo)

@router.post("/analyze-now")
async def analyze_now(
    file: UploadFile,
    user: User = Depends(get_current_user),
):
    """Analyze a single audio file synchronously and return the result immediately."""
    import asyncio
    import subprocess

    from app.main import MODELS_READY
    if not MODELS_READY.is_set():
        raise HTTPException(status_code=503, detail="Models are still loading, please wait")
    import tempfile
    import time

    suffix = Path(file.filename or "clip.webm").suffix or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await file.read()
        if len(content) > 50 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File exceeds 50 MB limit")
        tmp.write(content)
        tmp_path = tmp.name

    # Convert non-WAV formats (e.g. webm from browser mic) to WAV via ffmpeg
    wav_path = tmp_path
    if suffix.lower() != ".wav":
        wav_path = tmp_path.rsplit(".", 1)[0] + ".wav"
        try:
            import imageio_ffmpeg
            ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        except ImportError:
            ffmpeg_exe = "ffmpeg"
        try:
            subprocess.run(
                [ffmpeg_exe, "-y", "-i", tmp_path, "-ar", "16000", "-ac", "1", wav_path],
                capture_output=True, timeout=30, check=True,
            )
        except (subprocess.CalledProcessError, FileNotFoundError) as e:
            Path(tmp_path).unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=f"Audio conversion failed: {e}")

    t0 = time.time()
    try:
        result, detail = await asyncio.to_thread(analyze_audio_file, wav_path)
    except Exception as e:
        logger.error("analyze-now failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)
        if wav_path != tmp_path:
            Path(wav_path).unlink(missing_ok=True)

    return {
        "result": json.loads(result.model_dump_json()),
        "detail": detail,
        "processing_time_sec": round(time.time() - t0, 1),
    }


# Run processing

@router.post("/{batch_id}/run")
async def run_batch(
    batch_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Start processing all audio files in a batch as a background task."""
    batch = await _get_user_batch(batch_id, user.id, db)
    if batch.status == "processing":
        raise HTTPException(status_code=409, detail="Batch is already being processed")

    batch.status = "processing"
    batch.processed_files = 0
    batch.failed_files = 0
    await db.commit()

    background_tasks.add_task(_process_batch, batch_id)
    return {"message": "Processing started", "batch_id": batch_id}


@router.post("/{batch_id}/cancel")
async def cancel_batch(
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Cancel a running batch. Files already completed are kept."""
    batch = await _get_user_batch(batch_id, user.id, db)
    if batch.status != "processing":
        raise HTTPException(status_code=409, detail="Batch is not processing")
    batch.status = "cancelled"
    await db.commit()
    return {"message": "Batch cancelled", "batch_id": batch_id}


# Status & results

@router.get("/{batch_id}", response_model=BatchStatusResponse)
async def get_batch_status(
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    batch = await _get_user_batch(batch_id, user.id, db)
    return BatchStatusResponse(
        id=batch.id,
        status=batch.status,
        total_files=batch.total_files,
        processed_files=batch.processed_files,
        failed_files=batch.failed_files,
        created_at=batch.created_at.isoformat() if batch.created_at else "",
    )


@router.get("/{batch_id}/results", response_model=list[FileResultResponse])
async def get_batch_results(
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    batch = await _get_user_batch(batch_id, user.id, db)
    result = await db.execute(
        select(FileResult).where(FileResult.batch_id == batch.id)
    )
    file_results = result.scalars().all()

    return [
        FileResultResponse(
            filename=fr.filename,
            status=fr.status,
            result=json.loads(fr.result_json) if fr.result_json else None,
            detail=json.loads(fr.detail_json) if fr.detail_json else None,
            error=fr.error,
        )
        for fr in file_results
    ]


# Downloads

@router.get("/{batch_id}/download/json")
async def download_json(
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download all results as a JSON array."""
    batch = await _get_user_batch(batch_id, user.id, db)
    result = await db.execute(
        select(FileResult).where(FileResult.batch_id == batch.id)
    )
    file_results = result.scalars().all()

    output = []
    for fr in file_results:
        entry = {"name": fr.filename, "status": fr.status}
        if fr.result_json:
            entry["result_json"] = json.loads(fr.result_json)
        if fr.error:
            entry["error"] = fr.error
        output.append(entry)

    content = json.dumps(output, indent=2)
    return StreamingResponse(
        io.BytesIO(content.encode()),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=batch_{batch_id}_results.json"},
    )


@router.get("/{batch_id}/download/csv")
async def download_csv(
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Download all results as a CSV with name and result_json columns."""
    batch = await _get_user_batch(batch_id, user.id, db)
    result = await db.execute(
        select(FileResult).where(FileResult.batch_id == batch.id)
    )
    file_results = result.scalars().all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["name", "result_json"])
    for fr in file_results:
        writer.writerow([fr.filename, fr.result_json or ""])

    content = output.getvalue().encode()
    return StreamingResponse(
        io.BytesIO(content),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=batch_{batch_id}_results.csv"},
    )


# List batches

@router.get("/{batch_id}/audio/{filename:path}")
async def stream_audio(
    batch_id: int,
    filename: str,
    token: str = None,
    db: AsyncSession = Depends(get_db),
):
    """Stream an audio file from a batch for in-browser playback.
    Accepts JWT via query param (needed for <audio> element which can't set headers).
    """
    from app.config import ALGORITHM, SECRET_KEY
    from jose import JWTError, jwt as jose_jwt

    if not token:
        raise HTTPException(status_code=401, detail="Token required")
    try:
        payload = jose_jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")

    batch = await _get_user_batch(batch_id, user.id, db)
    batch_dir = UPLOAD_DIR / str(batch_id) / "files"
    file_path = _find_file(batch_dir, filename)

    if file_path is None:
        raise HTTPException(status_code=404, detail="Audio file not found")

    # Map extension to MIME type
    mime_map = {
        ".wav": "audio/wav", ".mp3": "audio/mpeg", ".flac": "audio/flac",
        ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".aac": "audio/aac",
        ".webm": "audio/webm",
    }
    mime = mime_map.get(file_path.suffix.lower(), "application/octet-stream")

    def iterfile():
        with open(file_path, "rb") as f:
            while chunk := f.read(65536):
                yield chunk

    return StreamingResponse(iterfile(), media_type=mime)


@router.get("/{batch_id}/metrics")
async def get_batch_metrics(
    batch_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Compute aggregate metrics for a completed batch."""
    batch = await _get_user_batch(batch_id, user.id, db)
    result = await db.execute(
        select(FileResult).where(FileResult.batch_id == batch.id)
    )
    file_results = result.scalars().all()

    # Aggregate distributions
    tone_dist = {}
    intensity_dist = {}
    noise_severity_dist = {}
    quality_dist = {}
    confidences = []
    overlap_count = 0
    silence_count = 0
    noise_type_dist = {}
    completed_count = 0

    # For confusion matrix (if ground truth labels exist)
    predictions = []
    ground_truths = []
    labels_map = _parse_labels_csv(UPLOAD_DIR / str(batch_id) / "files")

    for fr in file_results:
        if fr.status != "completed" or not fr.result_json:
            continue
        completed_count += 1
        r = json.loads(fr.result_json)

        tone = r.get("emotional_tone", "neutral")
        tone_dist[tone] = tone_dist.get(tone, 0) + 1

        intensity = r.get("emotional_intensity", "low")
        intensity_dist[intensity] = intensity_dist.get(intensity, 0) + 1

        severity = r.get("background_noise_severity", "none")
        noise_severity_dist[severity] = noise_severity_dist.get(severity, 0) + 1

        quality = r.get("audio_quality", "clear")
        quality_dist[quality] = quality_dist.get(quality, 0) + 1

        confidences.append(r.get("confidence", 0))

        if r.get("speaker_overlap_present"):
            overlap_count += 1
        if r.get("long_silence_present"):
            silence_count += 1

        noise_type = r.get("background_noise_type", "")
        if noise_type:
            noise_type_dist[noise_type] = noise_type_dist.get(noise_type, 0) + 1

        # Build confusion matrix data if ground truth available
        predictions.append(tone)
        gt_json = labels_map.get(fr.filename, "")
        if gt_json:
            try:
                gt = json.loads(gt_json)
                ground_truths.append(gt.get("emotional_tone", ""))
            except (json.JSONDecodeError, TypeError):
                ground_truths.append("")
        else:
            ground_truths.append("")

    # Build confusion matrix (only if we have ground truth)
    confusion_matrix = None
    tone_labels = ["neutral", "satisfied", "frustrated", "upset", "distressed"]
    if any(ground_truths):
        matrix = [[0] * len(tone_labels) for _ in tone_labels]
        for gt, pred in zip(ground_truths, predictions):
            if gt in tone_labels and pred in tone_labels:
                gi = tone_labels.index(gt)
                pi = tone_labels.index(pred)
                matrix[gi][pi] += 1
        confusion_matrix = {"labels": tone_labels, "matrix": matrix}

    avg_confidence = sum(confidences) / len(confidences) if confidences else 0

    return {
        "total_completed": completed_count,
        "tone_distribution": tone_dist,
        "intensity_distribution": intensity_dist,
        "noise_severity_distribution": noise_severity_dist,
        "noise_type_distribution": noise_type_dist,
        "quality_distribution": quality_dist,
        "average_confidence": round(avg_confidence, 3),
        "confidence_values": confidences,
        "overlap_count": overlap_count,
        "silence_count": silence_count,
        "confusion_matrix": confusion_matrix,
    }


@router.get("/", response_model=list[BatchStatusResponse])
async def list_batches(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Batch)
        .options(selectinload(Batch.results))
        .where(Batch.user_id == user.id)
        .order_by(Batch.created_at.desc())
    )
    batches = result.scalars().all()
    out = []
    for b in batches:
        first_filename = None
        dominant_tone = None
        if b.results:
            first_filename = b.results[0].filename
            tone_counts: dict[str, int] = {}
            for fr in b.results:
                if fr.result_json:
                    try:
                        tone = json.loads(fr.result_json).get("emotional_tone")
                        if tone:
                            tone_counts[tone] = tone_counts.get(tone, 0) + 1
                    except (json.JSONDecodeError, AttributeError):
                        pass
            if tone_counts:
                dominant_tone = max(tone_counts, key=tone_counts.get)  # type: ignore[arg-type]
        out.append(BatchStatusResponse(
            id=b.id,
            status=b.status,
            total_files=b.total_files,
            processed_files=b.processed_files,
            failed_files=b.failed_files,
            created_at=b.created_at.isoformat() if b.created_at else "",
            first_filename=first_filename,
            dominant_tone=dominant_tone,
        ))
    return out


# Background processing

async def _process_batch(batch_id: int):
    """
    Process every audio file in a batch. Runs as a background task.
    Each file is processed independently — one failure does not block others.
    """
    import asyncio

    async with async_session() as db:
        batch = await db.get(Batch, batch_id)
        if not batch:
            return

        result = await db.execute(
            select(FileResult).where(FileResult.batch_id == batch_id)
        )
        file_results = result.scalars().all()

        batch_dir = UPLOAD_DIR / str(batch_id) / "files"

        sem = asyncio.Semaphore(2)

        async def _process_file(fr):
            await sem.acquire()
            # Check if batch was cancelled before starting this file
            await db.refresh(batch)
            if batch.status == "cancelled":
                if fr.status != "completed":
                    fr.status = "cancelled"
                    await db.commit()
                sem.release()
                return

            fr.status = "processing"
            await db.commit()

            converted_path = None
            try:
                file_path = _find_file(batch_dir, fr.filename)
                if file_path is None:
                    raise FileNotFoundError(f"File not found: {fr.filename}")

                # Convert non-WAV formats to WAV via ffmpeg so librosa can load them
                actual_path = str(file_path)
                if file_path.suffix.lower() in (".webm", ".m4a", ".aac", ".mp4", ".mpeg", ".wma"):
                    import subprocess
                    converted_path = file_path.with_suffix(".wav")
                    try:
                        import imageio_ffmpeg
                        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
                    except ImportError:
                        ffmpeg_exe = "ffmpeg"
                    subprocess.run(
                        [ffmpeg_exe, "-y", "-i", str(file_path), "-ar", "16000", "-ac", "1", str(converted_path)],
                        capture_output=True, timeout=60, check=True,
                    )
                    actual_path = str(converted_path)

                analysis, detail = await asyncio.to_thread(analyze_audio_file, actual_path)
                fr.result_json = analysis.model_dump_json()
                fr.detail_json = json.dumps(detail)
                fr.status = "completed"
                batch.processed_files += 1

            except Exception as e:
                logger.error("Failed to process %s: %s", fr.filename, e)
                fr.status = "failed"
                fr.error = str(e)
                batch.failed_files += 1
            finally:
                if converted_path and converted_path.exists():
                    converted_path.unlink(missing_ok=True)
                sem.release()

            await db.commit()

        await asyncio.gather(*[_process_file(fr) for fr in file_results])

        await db.refresh(batch)
        if batch.status != "cancelled":
            batch.status = "completed"
        await db.commit()
        logger.info("Batch %d %s: %d/%d succeeded",
                     batch_id, batch.status, batch.processed_files, batch.total_files)


# Helpers

async def _get_user_batch(batch_id: int, user_id: int, db: AsyncSession) -> Batch:
    """Fetch a batch and verify it belongs to the requesting user."""
    batch = await db.get(Batch, batch_id)
    if batch is None or batch.user_id != user_id:
        raise HTTPException(status_code=404, detail="Batch not found")
    return batch


def _find_audio_files(base_dir: Path) -> list[Path]:
    """Recursively find all audio files under a directory."""
    audio_files = []
    for p in sorted(base_dir.rglob("*")):
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS:
            audio_files.append(p)
    return audio_files


def _find_file(base_dir: Path, filename: str) -> Path | None:
    """Find a specific file by name anywhere under base_dir."""
    for p in base_dir.rglob(filename):
        if p.is_file():
            return p
    return None


def _parse_labels_csv(base_dir: Path) -> dict[str, str]:
    """
    Look for labels.csv in the extracted directory and parse it.
    Returns a dict mapping filename → result_json string.
    """
    # Search for any CSV file named 'labels.csv' (case-insensitive)
    csv_files = list(base_dir.rglob("*.csv"))
    labels_csv = None
    for cf in csv_files:
        if cf.stem.lower() == "labels":
            labels_csv = cf
            break

    if labels_csv is None:
        return {}

    labels = {}
    with open(labels_csv, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("name", "").strip()
            result_json = row.get("result_json", "").strip()
            if name:
                labels[name] = result_json

    return labels
