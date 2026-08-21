import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listBatches, BatchStatus } from "../api";

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
    completed: "bg-[#eaf3de] text-[#3b6d11]",
    processing: "bg-blue-100 text-blue-700",
    pending: "bg-gray-100 text-gray-600",
    failed: "bg-red-100 text-red-700",
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h2 className="text-xl font-medium text-gray-900 mb-5">Batch history</h2>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : batches.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-400 mb-4">No batches yet</p>
          <button
            onClick={() => navigate("/upload")}
            className="bg-[#2a78d6] hover:bg-[#1e65b8] text-white px-6 py-2.5 rounded-lg text-sm font-medium"
          >
            Upload Your First Batch
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {batches.map((b) => (
            <div
              key={b.id}
              onClick={() => navigate(`/results/${b.id}`)}
              className="bg-white rounded-xl border border-gray-100 hover:border-[#2a78d6] px-5 py-3.5 cursor-pointer transition flex items-center gap-4"
            >
              <span className="text-[13px] text-gray-400 min-w-[28px]">#{b.id}</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800">
                  {b.total_files} file{b.total_files !== 1 ? "s" : ""}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(b.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </p>
              </div>
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium ${statusColor[b.status] || "bg-gray-100"}`}>
                {b.status}
              </span>
              <span className="text-gray-300 text-sm">→</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
