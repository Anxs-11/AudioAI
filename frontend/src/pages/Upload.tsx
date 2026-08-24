import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { uploadBatch, uploadFiles, runBatch, UploadResponse } from "../api";
import ProgressBar from "../components/ProgressBar";

export default function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  // Mic recording state
  const [recording, setRecording] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const AUDIO_EXTS = [".wav", ".mp3", ".flac", ".ogg", ".m4a", ".wma", ".aac", ".webm", ".mp4", ".mpeg"];

  // Waveform visualizer for recording
  function drawVisualizer() {
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const bufLen = analyser.frequencyBinCount;
    const data = new Uint8Array(bufLen);

    function draw() {
      animFrameRef.current = requestAnimationFrame(draw);
      analyser!.getByteFrequencyData(data);
      const w = canvas!.width;
      const h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);

      const bars = 48;
      const cx = w / 2;
      const cy = h / 2;
      const step = Math.floor(bufLen / bars);
      for (let i = 0; i < bars; i++) {
        const val = data[i * step] / 255;
        const barH = Math.max(4, val * cy * 0.85);
        const x = cx + (i - bars / 2) * 5;
        const gradient = ctx!.createLinearGradient(x, cy - barH, x, cy + barH);
        gradient.addColorStop(0, `rgba(99, 179, 237, ${0.4 + val * 0.6})`);
        gradient.addColorStop(0.5, `rgba(129, 140, 248, ${0.6 + val * 0.4})`);
        gradient.addColorStop(1, `rgba(167, 139, 250, ${0.4 + val * 0.6})`);
        ctx!.fillStyle = gradient;
        ctx!.beginPath();
        ctx!.roundRect(x - 1.5, cy - barH, 3, barH * 2, 2);
        ctx!.fill();
      }

      // Center glow
      const glow = ctx!.createRadialGradient(cx, cy, 0, cx, cy, 60);
      glow.addColorStop(0, "rgba(129, 140, 248, 0.15)");
      glow.addColorStop(1, "rgba(129, 140, 248, 0)");
      ctx!.fillStyle = glow;
      ctx!.fillRect(0, 0, w, h);
    }
    draw();
  }

  async function startRecording() {
    setError("");
    setRecordingUrl(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Set up audio analyser for visualizer
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        audioCtx.close();
        cancelAnimationFrame(animFrameRef.current);
        analyserRef.current = null;
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const recordedFile = new File([blob], "live_recording.webm", { type: "audio/webm" });
        setRecordingUrl(URL.createObjectURL(blob));
        setAudioFiles([recordedFile]);
        setFile(null);
      };
      mediaRecRef.current = rec;
      rec.start();
      setRecording(true);
      // Start visualizer after a tick so canvas is mounted
      setTimeout(drawVisualizer, 50);
    } catch {
      setError("Microphone access denied");
    }
  }

  function stopRecording() {
    mediaRecRef.current?.stop();
    setRecording(false);
  }

  function clearRecording() {
    setRecordingUrl(null);
    setAudioFiles([]);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setRecordingUrl(null);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length === 1 && dropped[0].name.endsWith(".zip")) {
      setFile(dropped[0]);
      setAudioFiles([]);
      setError("");
    } else {
      const audio = dropped.filter(f => AUDIO_EXTS.some(ext => f.name.toLowerCase().endsWith(ext)));
      if (audio.length > 0) {
        setAudioFiles(prev => [...prev, ...audio]);
        setFile(null);
        setError("");
      } else {
        setError("No supported audio files found. Supported: WAV, MP3, OGG, FLAC, M4A, MPEG");
      }
    }
  }, []);

  async function handleUpload() {
    if (!file && audioFiles.length === 0) return;
    setUploading(true);
    setError("");
    try {
      const res = file ? await uploadBatch(file) : await uploadFiles(audioFiles);
      setUploadResult(res);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleRun() {
    if (!uploadResult) return;
    setProcessing(true);
    setError("");
    try {
      await runBatch(uploadResult.batch_id);
      navigate(`/results/${uploadResult.batch_id}`);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to start processing");
      setProcessing(false);
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h2 className="text-xl font-medium text-gray-100 mb-1">Upload audio for analysis</h2>
      <p className="text-[13px] text-gray-400 mb-6">
        Drop audio files, a ZIP archive, or record from your microphone.
      </p>

      {!uploadResult && (
        <>
          {/* Recording visualizer — shown while actively recording */}
          {recording && (
            <div className="flex flex-col items-center mb-6">
              <canvas
                ref={canvasRef}
                width={320}
                height={120}
                className="rounded-xl mb-4"
              />
              <span className="text-xs text-red-400 animate-pulse mb-3">● Recording...</span>
              <button
                onClick={stopRecording}
                className="px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg text-sm transition flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> Stop Recording
              </button>
            </div>
          )}

          {/* Recorded audio preview */}
          {recordingUrl && !recording && (
            <div className="bg-[#151d2e] border border-white/[0.07] rounded-xl p-5 mb-5 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-300">🎙 Recorded audio</p>
                <button
                  onClick={clearRecording}
                  className="text-xs text-gray-500 hover:text-gray-300 transition"
                >
                  ✕ Remove
                </button>
              </div>
              <audio controls className="w-full h-10" src={recordingUrl} />
            </div>
          )}

          {/* Drop zone — hidden while recording or when a recording exists */}
          {!recording && !recordingUrl && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`border-[1.5px] border-dashed rounded-xl p-12 text-center transition cursor-pointer mb-5 ${
                dragOver ? "border-[#2a78d6] bg-[#2a78d6]/10" : "border-white/10 bg-[#1a2236]"
              }`}
              onClick={() => document.getElementById("file-input")?.click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".zip,.wav,.mp3,.flac,.ogg,.m4a,.wma,.aac,.webm,.mp4,.mpeg"
                multiple
                className="hidden"
                onChange={(e) => {
                  const selected = Array.from(e.target.files || []);
                  if (selected.length === 1 && selected[0].name.endsWith(".zip")) {
                    setFile(selected[0]);
                    setAudioFiles([]);
                  } else {
                    const audio = selected.filter(f => AUDIO_EXTS.some(ext => f.name.toLowerCase().endsWith(ext)));
                    if (audio.length > 0) { setAudioFiles(prev => [...prev, ...audio]); setFile(null); }
                  }
                  setError("");
                }}
              />
              <div className="text-[#2a78d6] text-3xl mb-3">🎵</div>
              {file ? (
                <div>
                  <p className="text-[15px] font-medium text-gray-200">{file.name}</p>
                    <p className="text-xs text-gray-500 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
              ) : audioFiles.length > 0 ? (
                <div>
                  <p className="text-[15px] font-medium text-gray-200">{audioFiles.length} audio file{audioFiles.length > 1 ? "s" : ""} selected</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {audioFiles.slice(0, 3).map(f => f.name).join(", ")}{audioFiles.length > 3 ? ` +${audioFiles.length - 3} more` : ""}
                  </p>
                </div>
              ) : (
                  <div>
                  <h3 className="text-[15px] font-medium text-gray-200">Drag and drop audio files or a ZIP</h3>
                  <p className="text-xs text-gray-500 mt-1">or click to browse</p>
                </div>
              )}
            </div>
          )}

          {/* Format pills + Record button */}
          {!recording && (
            <div className="flex items-center justify-between mb-5">
              <div className="flex flex-wrap gap-1.5">
                {["WAV","MP3","OGG","FLAC","M4A","MPEG","AAC","WebM"].map(f => (
                  <span key={f} className="bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5 text-[11px] text-gray-400">{f}</span>
                ))}
              </div>
              {!recordingUrl && (
                <button
                  onClick={startRecording}
                  className="ml-3 px-5 py-2.5 bg-red-600 hover:bg-red-700 border border-red-500/30 text-white rounded-full text-xs font-semibold transition flex items-center gap-2 shrink-0 shadow-[0_0_16px_rgba(239,68,68,0.3)]"
                >
                  <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  Record
                </button>
              )}
            </div>
          )}

          <button
            onClick={handleUpload}
            disabled={(!file && audioFiles.length === 0) || uploading || recording}
            className="w-full py-3 bg-[#2a78d6] hover:bg-[#1e65b8] text-white font-medium rounded-lg text-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            ⬆ {uploading ? "Uploading…" : "Upload and analyze"}
          </button>
        </>
      )}

      {/* Upload result */}
      {uploadResult && (
        <div className="bg-[#151d2e] border border-white/[0.07] rounded-xl p-6 mt-2">
          <h3 className="text-lg font-semibold text-emerald-400 mb-3">
            ✓ Batch uploaded — {uploadResult.total_files} audio file{uploadResult.total_files !== 1 ? "s" : ""} found
          </h3>

          <div className="max-h-48 overflow-y-auto border border-white/[0.07] rounded-lg p-3 mb-4 bg-[#0f1623]">
            {uploadResult.files.map((f) => (
              <div key={f} className="text-sm text-gray-400 py-0.5">{f}</div>
            ))}
          </div>

          {uploadResult.validation_errors.length > 0 && (
            <div className="bg-yellow-900/30 border border-yellow-700/40 rounded-lg p-3 mb-4">
              <p className="text-sm font-medium text-yellow-400 mb-1">Validation Warnings</p>
              {uploadResult.validation_errors.map((e, i) => (
                <p key={i} className="text-sm text-yellow-500">{e}</p>
              ))}
            </div>
          )}

          <button
            onClick={handleRun}
            disabled={processing}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
          >
            {processing ? "Starting analysis…" : "Start Analysis"}
          </button>
          <button
            onClick={() => { setUploadResult(null); setFile(null); setAudioFiles([]); setRecordingUrl(null); }}
            className="w-full mt-2 py-2.5 text-sm font-medium text-gray-400 hover:text-white transition"
          >
            ← Back
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-900/40 text-red-400 text-sm rounded-lg px-4 py-3 mt-4">
          {error}
        </div>
      )}
    </div>
  );
}
