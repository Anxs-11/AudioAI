import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getBatchStatus,
  getBatchResults,
  getBatchMetrics,
  BatchStatus,
  BatchMetrics,
  FileResult,
  downloadResults,
} from "../api";
import ProgressBar from "../components/ProgressBar";
import ResultsTable from "../components/ResultsTable";

export default function Results() {
  const { batchId } = useParams<{ batchId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const [results, setResults] = useState<FileResult[]>([]);
  const [metrics, setMetrics] = useState<BatchMetrics | null>(null);
  const [error, setError] = useState("");

  const id = Number(batchId);

  useEffect(() => {
    if (!id) return;

    let active = true;
    const poll = async () => {
      try {
        const s = await getBatchStatus(id);
        if (active) setStatus(s);

        if (s.status === "completed" || s.status === "failed") {
          const [r, m] = await Promise.all([getBatchResults(id), getBatchMetrics(id)]);
          if (active) {
            setResults(r);
            setMetrics(m);
          }
        } else {
          setTimeout(poll, 2000);
        }
      } catch {
        if (active) setError("Failed to fetch batch status");
      }
    };
    poll();

    return () => { active = false; };
  }, [id]);

  const progress =
    status && status.total_files > 0
      ? Math.round(((status.processed_files + status.failed_files) / status.total_files) * 100)
      : 0;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {error && (
        <div className="bg-red-900/40 text-red-400 text-sm rounded-lg px-4 py-3 mb-4">{error}</div>
      )}

      {/* Loading / Processing state */}
      {(!status || (status.status !== "completed" && status.status !== "failed")) && !error && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="relative w-24 h-24 mb-6">
            <div className="absolute inset-0 rounded-full border-4 border-white/10" />
            <div className="absolute inset-0 rounded-full border-4 border-[#2a78d6] border-t-transparent animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-bold text-gray-100">
                {status && status.total_files > 0
                  ? Math.round(((status.processed_files + status.failed_files) / status.total_files) * 100)
                  : 0}%
              </span>
            </div>
          </div>

          <h3 className="text-lg font-semibold text-gray-100 mb-1">Analyzing Audio Files</h3>
          <p className="text-sm text-gray-400 mb-6">
            {status
              ? `Processing ${status.processed_files + status.failed_files} of ${status.total_files} files...`
              : "Starting analysis..."}
          </p>

          <div className="w-full max-w-md">
            <ProgressBar percent={status ? progress : 0} />
          </div>

          <p className="text-xs text-gray-500 mt-4">
            This may take a moment depending on audio length
          </p>
        </div>
      )}

      {/* Completed view */}
      {status && status.status === "completed" && (
        <>
          {/* Header row */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate("/history")}
                className="text-[13px] text-[#2a78d6] hover:text-[#5a9be6] cursor-pointer transition font-medium"
              >
                ← History
              </button>
              <h2 className="text-xl font-semibold text-gray-100">
                Batch #{batchId} · {status.total_files} file{status.total_files !== 1 ? "s" : ""}
              </h2>
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={() => downloadResults(id, "csv")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium border border-white/[0.07] bg-[#151d2e] hover:bg-[#1c2640] text-gray-300 hover:text-white transition"
              >
                ↓ CSV
              </button>
              <button
                onClick={() => downloadResults(id, "json")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium border border-white/[0.07] bg-[#151d2e] hover:bg-[#1c2640] text-gray-300 hover:text-white transition"
              >
                ↓ JSON
              </button>
            </div>
          </div>

          {/* KPI row */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div className="bg-[#151d2e] border border-white/[0.07] rounded-xl px-5 py-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-slate-500 rounded-l-xl" />
              <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1.5 font-medium">Files analyzed</p>
              <p className="text-[28px] font-bold text-gray-100 leading-none">{status.total_files}</p>
            </div>
            <div className="bg-[#151d2e] border border-white/[0.07] rounded-xl px-5 py-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500 rounded-l-xl" />
              <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1.5 font-medium">Succeeded</p>
              <p className="text-[28px] font-bold text-emerald-400 leading-none">{status.processed_files}</p>
            </div>
            <div className="bg-[#151d2e] border border-white/[0.07] rounded-xl px-5 py-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-red-500 rounded-l-xl" />
              <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1.5 font-medium">Failed</p>
              <p className="text-[28px] font-bold text-red-400 leading-none">{status.failed_files}</p>
            </div>
            <div className="bg-[#151d2e] border border-white/[0.07] rounded-xl px-5 py-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-blue-500 rounded-l-xl" />
              <p className="text-[11px] text-gray-500 uppercase tracking-wider mb-1.5 font-medium">Avg confidence</p>
              <p className="text-[28px] font-bold text-blue-400 leading-none">{metrics ? `${(metrics.average_confidence * 100).toFixed(0)}%` : "—"}</p>
            </div>
          </div>

          {/* Section header */}
          <p className="text-[11px] text-gray-500 uppercase tracking-widest font-medium mb-4">
            File Results — Click to expand
          </p>

          {/* File results */}
          {results.length > 0 && (
            <ResultsTable results={results} batchId={id} />
          )}
        </>
      )}
    </div>
  );
}
