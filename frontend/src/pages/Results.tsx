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
  logout,
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
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <nav className="bg-slate-900 shadow-lg">
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => navigate("/upload")}
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 9l3 11h12l3-11L12 2z" fill="white" />
              <path d="M12 6l-5 4 2 6h6l2-6-5-4z" fill="#0f172a" />
            </svg>
            <h1 className="text-xl font-bold text-white">AutoAce</h1>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/upload")}
              className="text-sm text-slate-300 hover:text-white transition"
            >
              New Batch
            </button>
            <button onClick={logout} className="text-sm text-slate-300 hover:text-red-400 transition">
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <h2 className="text-2xl font-semibold text-slate-800 mb-1">Batch #{batchId} Results</h2>

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
            <div className="flex flex-wrap gap-4 mt-6">
              <div className="bg-white rounded-xl shadow px-6 py-4 flex-1 min-w-[150px]">
                <p className="text-sm text-slate-500">Total Files</p>
                <p className="text-2xl font-bold text-slate-800">{status.total_files}</p>
              </div>
              <div className="bg-white rounded-xl shadow px-6 py-4 flex-1 min-w-[150px]">
                <p className="text-sm text-slate-500">Succeeded</p>
                <p className="text-2xl font-bold text-green-600">{status.processed_files}</p>
              </div>
              <div className="bg-white rounded-xl shadow px-6 py-4 flex-1 min-w-[150px]">
                <p className="text-sm text-slate-500">Failed</p>
                <p className="text-2xl font-bold text-red-500">{status.failed_files}</p>
              </div>
            </div>

            {/* Download buttons */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => downloadResults(id, "csv")}
                className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
              >
                ↓ Download CSV
              </button>
              <button
                onClick={() => downloadResults(id, "json")}
                className="inline-flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
              >
                ↓ Download JSON
              </button>
            </div>

            {/* Tabs: Metrics / Table */}
            <div className="flex border-b border-gray-200 mt-8">
              <button
                onClick={() => setActiveTab("metrics")}
                className={`px-5 py-2.5 text-sm font-medium border-b-2 transition ${
                  activeTab === "metrics"
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                📊 Metrics &amp; Charts
              </button>
              <button
                onClick={() => setActiveTab("table")}
                className={`px-5 py-2.5 text-sm font-medium border-b-2 transition ${
                  activeTab === "table"
                    ? "border-slate-900 text-slate-900"
                    : "border-transparent text-slate-500 hover:text-slate-700"
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
      </main>
    </div>
  );
}
