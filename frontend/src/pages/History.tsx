import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listBatches, BatchStatus, logout } from "../api";

export default function History() {
  const [batches, setBatches] = useState<BatchStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    listBatches()
      .then(setBatches)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statusColor: Record<string, string> = {
    completed: "bg-green-100 text-green-700",
    processing: "bg-blue-100 text-blue-700",
    pending: "bg-gray-100 text-gray-600",
    failed: "bg-red-100 text-red-700",
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-slate-900 shadow-lg">
        <div className="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate("/upload")}>
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L3 9l3 11h12l3-11L12 2z" fill="white" />
              <path d="M12 6l-5 4 2 6h6l2-6-5-4z" fill="#0f172a" />
            </svg>
            <h1 className="text-xl font-bold text-white">AutoAce</h1>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => navigate("/upload")} className="text-sm text-slate-300 hover:text-white transition">
              New Batch
            </button>
            <button onClick={logout} className="text-sm text-slate-300 hover:text-red-400 transition">
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <h2 className="text-2xl font-semibold text-slate-800 mb-6">Batch History</h2>

        {loading ? (
          <div className="text-center py-20 text-slate-400">Loading...</div>
        ) : batches.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-slate-400 mb-4">No batches yet</p>
            <button
              onClick={() => navigate("/upload")}
              className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2.5 rounded-lg text-sm font-medium"
            >
              Upload Your First Batch
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {batches.map((b) => (
              <div
                key={b.id}
                onClick={() => navigate(`/results/${b.id}`)}
                className="bg-white rounded-xl shadow-sm border border-gray-100 hover:border-slate-300 px-6 py-4 cursor-pointer transition flex items-center gap-6"
              >
                <div className="text-lg font-bold text-slate-300 w-10">#{b.id}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor[b.status] || "bg-gray-100"}`}>
                      {b.status}
                    </span>
                    <span className="text-sm text-slate-600">
                      {b.processed_files}/{b.total_files} files
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {new Date(b.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="text-slate-400 text-sm">→</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
