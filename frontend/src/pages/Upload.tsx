import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { logout, uploadBatch, runBatch, UploadResponse } from "../api";
import ProgressBar from "../components/ProgressBar";

export default function Upload() {
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile?.name.endsWith(".zip")) {
      setFile(droppedFile);
      setError("");
    } else {
      setError("Please upload a .zip file");
    }
  }, []);

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const res = await uploadBatch(file);
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
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <nav className="bg-slate-900 shadow-lg">
        <div className="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 9l3 11h12l3-11L12 2z" fill="white" />
              <path d="M12 6l-5 4 2 6h6l2-6-5-4z" fill="#0f172a" />
            </svg>
            <h1 className="text-xl font-bold text-white">AutoAce</h1>
          </div>
          <button onClick={logout} className="text-sm text-slate-300 hover:text-red-400 transition">
            Sign Out
          </button>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h2 className="text-2xl font-semibold text-slate-800 mb-2">Upload Evaluation Batch</h2>
        <p className="text-slate-500 mb-8">
          Upload a ZIP archive containing audio files (WAV, MP3, etc.) and an optional <code className="bg-gray-200 px-1 rounded">labels.csv</code> manifest.
        </p>

        {/* Drop zone */}
        {!uploadResult && (
          <>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`border-2 border-dashed rounded-xl p-12 text-center transition cursor-pointer ${
                dragOver ? "border-slate-900 bg-slate-100" : "border-gray-300 bg-white"
              }`}
              onClick={() => document.getElementById("file-input")?.click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) { setFile(f); setError(""); }
                }}
              />
              {file ? (
                <div>
                  <p className="text-lg font-medium text-slate-700">{file.name}</p>
                  <p className="text-sm text-slate-400 mt-1">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
              ) : (
                <div>
                  <p className="text-lg text-slate-500">Drag &amp; drop a ZIP file here</p>
                  <p className="text-sm text-slate-400 mt-1">or click to browse</p>
                </div>
              )}
            </div>

            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="mt-6 w-full bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "Upload & Validate"}
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
          </div>
        )}

        {error && (
          <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3 mt-4">
            {error}
          </div>
        )}
      </main>
    </div>
  );
}
