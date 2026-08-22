import { useCallback, useState } from "react";
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

  const AUDIO_EXTS = [".wav", ".mp3", ".flac", ".ogg", ".m4a", ".wma", ".aac", ".webm", ".mp4", ".mpeg"];

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
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
        Drop audio files or a ZIP archive.
      </p>

      {!uploadResult && (
        <>
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

          {/* Format pills */}
          <div className="flex flex-wrap gap-1.5 mb-5">
            {["WAV","MP3","OGG","FLAC","M4A","MPEG","AAC","WebM"].map(f => (
              <span key={f} className="bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5 text-[11px] text-gray-400">{f}</span>
            ))}
          </div>

          <button
            onClick={handleUpload}
            disabled={(!file && audioFiles.length === 0) || uploading}
            className="w-full py-3 bg-[#2a78d6] hover:bg-[#1e65b8] text-white font-medium rounded-lg text-sm transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            ⬆ {uploading ? "Uploading…" : "Upload and analyze"}
          </button>
          </>
        )}

        {/* Upload result */}
        {uploadResult && (
          <div className="bg-white rounded-xl shadow p-6 mt-2">
            <h3 className="text-lg font-semibold text-green-700 mb-3">
              ✓ Batch uploaded — {uploadResult.total_files} audio file{uploadResult.total_files !== 1 ? "s" : ""} found
            </h3>

            <div className="max-h-48 overflow-y-auto border rounded-lg p-3 mb-4 bg-gray-50">
              {uploadResult.files.map((f) => (
                <div key={f} className="text-sm text-slate-600 py-0.5">{f}</div>
              ))}
            </div>

            {uploadResult.validation_errors.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
                <p className="text-sm font-medium text-yellow-700 mb-1">Validation Warnings</p>
                {uploadResult.validation_errors.map((e, i) => (
                  <p key={i} className="text-sm text-yellow-600">{e}</p>
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
              onClick={() => { setUploadResult(null); setFile(null); setAudioFiles([]); }}
              className="w-full mt-2 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition"
            >
              ← Back
            </button>
          </div>
        )}

        {error && (
          <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3 mt-4">
            {error}
          </div>
        )}
      </div>
  );
}
