import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listBatches, BatchStatus } from "../api";

const toneDot: Record<string, string> = {
  neutral: "bg-blue-400",
  satisfied: "bg-emerald-400",
  frustrated: "bg-orange-400",
  upset: "bg-orange-400",
  distressed: "bg-red-400",
  anxious: "bg-amber-400",
  confident: "bg-emerald-400",
};

const statusColor: Record<string, string> = {
  completed: "bg-[#eaf3de] text-[#3b6d11]",
  processing: "bg-blue-900/30 text-blue-300",
  pending: "bg-white/[0.06] text-gray-400",
  failed: "bg-red-900/30 text-red-300",
};

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

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

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-100 mb-6">Batch history</h2>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : batches.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-gray-400 mb-4">No batches yet</p>
          <button
            onClick={() => navigate("/upload")}
            className="bg-[#5b8def] hover:bg-[#4a7de0] text-white px-6 py-2.5 rounded-lg text-sm font-medium transition"
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
              className="bg-[#151d2e] rounded-xl border border-white/[0.07] hover:border-[#5b8def]/50 px-5 py-4 cursor-pointer transition group"
            >
              <div className="flex items-center gap-5">
                <span className="text-[13px] text-gray-500 font-medium min-w-[32px]">#{b.id}</span>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-200 truncate">
                    {b.first_filename || `${b.total_files} file${b.total_files !== 1 ? "s" : ""}`}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {new Date(b.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    {" · "}
                    {b.total_files} file{b.total_files !== 1 ? "s" : ""}
                  </p>
                </div>

                {b.dominant_tone && (
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${toneDot[b.dominant_tone] || "bg-gray-400"}`} />
                    <span className="text-sm text-gray-300">{capitalize(b.dominant_tone)}</span>
                  </div>
                )}

                <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-medium ${statusColor[b.status] || "bg-white/[0.06] text-gray-400"}`}>
                  {b.status}
                </span>

                <span className="text-gray-600 group-hover:text-gray-300 transition text-sm">→</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
