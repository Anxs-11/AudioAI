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
import MetricsPanel from "../components/MetricsPanel";

export default function Results() {
  const { batchId } = useParams<{ batchId: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const [results, setResults] = useState<FileResult[]>([]);
  const [metrics, setMetrics] = useState<BatchMetrics | null>(null);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"metrics" | "table">("metrics");

  const id = Number(batchId);

  // Poll batch status every 2 seconds until complete
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
      <button
        onClick={() => navigate("/history")}
        className="flex items-center gap-1.5 text-[13px] text-[#2a78d6] hover:text-[#1e65b8] cursor-pointer mb-4 transition"
      >
        ← Back to history
      </button>
      <h2 className="text-xl font-medium text-gray-900 mb-5">Batch #{batchId} Results</h2>

        {error && (
          <div className="bg-red-50 text-red-600 text-sm rounded-lg px-4 py-3 mt-4">{error}</div>
        )}

        {/* Loading / Processing state */}
        {(!status || (status.status !== "completed" && status.status !== "failed")) && !error && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="relative w-24 h-24 mb-6">
              <div className="absolute inset-0 rounded-full border-4 border-slate-200" />
              <div className="absolute inset-0 rounded-full border-4 border-slate-900 border-t-transparent animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-slate-900">
                  {status && status.total_files > 0
                    ? Math.round(((status.processed_files + status.failed_files) / status.total_files) * 100)
                    : 0}%
                </span>
              </div>
            </div>

            <h3 className="text-lg font-semibold text-slate-800 mb-1">Analyzing Audio Files</h3>
            <p className="text-sm text-slate-500 mb-6">
              {status
                ? `Processing ${status.processed_files + status.failed_files} of ${status.total_files} files...`
                : "Starting analysis..."}
            </p>

            <div className="w-full max-w-md">
              <ProgressBar percent={status ? progress : 0} />
            </div>

            <p className="text-xs text-slate-400 mt-4">
              This may take a moment depending on audio length
            </p>
          </div>
        )}

        {/* Completed summary */}
        {status && status.status === "completed" && (
          <>
            {/* Download buttons */}
            <div className="flex gap-2.5 mb-5">
              <button
                onClick={() => downloadResults(id, "csv")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 transition"
              >
                ↓ Download CSV
              </button>
              <button
                onClick={() => downloadResults(id, "json")}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-white hover:bg-gray-50 text-gray-800 transition"
              >
                ↓ Download JSON
              </button>
            </div>

            {/* KPI row */}
            <div className="grid grid-cols-4 gap-2.5 mb-5">
              <div className="bg-white border border-gray-100 rounded-xl px-4 py-3.5">
                <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1.5">Files analyzed</p>
                <p className="text-[26px] font-medium text-gray-900 leading-none">{status.total_files}</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl px-4 py-3.5">
                <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1.5">Succeeded</p>
                <p className="text-[26px] font-medium text-[#1baf7a] leading-none">{status.processed_files}</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl px-4 py-3.5">
                <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1.5">Failed</p>
                <p className="text-[26px] font-medium text-[#e34948] leading-none">{status.failed_files}</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl px-4 py-3.5">
                <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1.5">Avg confidence</p>
                <p className="text-[26px] font-medium text-[#2a78d6] leading-none">{metrics ? `${(metrics.average_confidence * 100).toFixed(0)}%` : "—"}</p>
              </div>
            </div>

            {/* Tabs: Metrics / Table */}
            <div className="flex border-b border-gray-200 mb-0">
              <button
                onClick={() => setActiveTab("metrics")}
                className={`px-5 py-2.5 text-[13px] font-medium border-b-2 transition ${
                  activeTab === "metrics"
                    ? "border-[#2a78d6] text-[#2a78d6]"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                📊 Metrics &amp; Charts
              </button>
              <button
                onClick={() => setActiveTab("table")}
                className={`px-5 py-2.5 text-[13px] font-medium border-b-2 transition ${
                  activeTab === "table"
                    ? "border-[#2a78d6] text-[#2a78d6]"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                📋 File Results &amp; Audio
              </button>
            </div>

            {/* Metrics view */}
            {activeTab === "metrics" && metrics && <MetricsPanel metrics={metrics} />}

            {/* Table + audio player view */}
            {activeTab === "table" && results.length > 0 && (
              <ResultsTable results={results} batchId={id} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
