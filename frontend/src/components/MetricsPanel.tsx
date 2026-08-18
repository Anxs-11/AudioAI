import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { BatchMetrics } from "../api";

interface Props {
  metrics: BatchMetrics;
}

const TONE_COLORS: Record<string, string> = {
  neutral: "#64748b",
  satisfied: "#10b981",
  frustrated: "#f59e0b",
  upset: "#ef4444",
  distressed: "#dc2626",
};

const SEVERITY_COLORS: Record<string, string> = {
  none: "#e2e8f0",
  low: "#94a3b8",
  medium: "#f59e0b",
  high: "#ef4444",
};

const QUALITY_COLORS: Record<string, string> = {
  clear: "#10b981",
  slightly_impaired: "#f59e0b",
  severely_impaired: "#ef4444",
};

function toChartData(dist: Record<string, number>) {
  return Object.entries(dist).map(([name, value]) => ({ name, value }));
}

export default function MetricsPanel({ metrics }: Props) {
  const toneData = toChartData(metrics.tone_distribution);
  const severityData = toChartData(metrics.noise_severity_distribution);
  const qualityData = toChartData(metrics.quality_distribution);
  const noiseTypeData = toChartData(metrics.noise_type_distribution);

  return (
    <div className="space-y-8 mt-8">
      {/* Summary stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Avg Confidence" value={`${(metrics.average_confidence * 100).toFixed(0)}%`} />
        <StatCard label="Files Analyzed" value={metrics.total_completed.toString()} />
        <StatCard label="Speaker Overlap" value={metrics.overlap_count.toString()} />
        <StatCard label="Long Silence" value={metrics.silence_count.toString()} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Emotional Tone Distribution */}
        <ChartCard title="Emotional Tone Distribution">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={toneData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                {toneData.map((entry) => (
                  <Cell key={entry.name} fill={TONE_COLORS[entry.name] || "#94a3b8"} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Noise Severity */}
        <ChartCard title="Background Noise Severity">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={severityData}>
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value">
                {severityData.map((entry) => (
                  <Cell key={entry.name} fill={SEVERITY_COLORS[entry.name] || "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Audio Quality */}
        <ChartCard title="Audio Quality">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={qualityData}>
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value">
                {qualityData.map((entry) => (
                  <Cell key={entry.name} fill={QUALITY_COLORS[entry.name] || "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Noise Types */}
        {noiseTypeData.length > 0 && (
          <ChartCard title="Background Noise Types">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={noiseTypeData} layout="vertical">
                <XAxis type="number" allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={120} />
                <Tooltip />
                <Bar dataKey="value" fill="#0f172a" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}
      </div>

      {/* Confusion Matrix */}
      {metrics.confusion_matrix && (
        <ChartCard title="Confusion Matrix (Predicted vs Ground Truth)">
          <ConfusionMatrix
            labels={metrics.confusion_matrix.labels}
            matrix={metrics.confusion_matrix.matrix}
          />
        </ChartCard>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl shadow px-5 py-4 text-center">
      <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold text-slate-800 mt-1">{value}</p>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow p-5">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function ConfusionMatrix({ labels, matrix }: { labels: string[]; matrix: number[][] }) {
  const maxVal = Math.max(...matrix.flat(), 1);

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse mx-auto">
        <thead>
          <tr>
            <th className="p-2 text-slate-500">Actual ↓ / Pred →</th>
            {labels.map((l) => (
              <th key={l} className="p-2 text-center font-medium text-slate-600 min-w-[70px]">{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((rowLabel, ri) => (
            <tr key={rowLabel}>
              <td className="p-2 font-medium text-slate-600 text-right">{rowLabel}</td>
              {matrix[ri].map((val, ci) => {
                const intensity = val / maxVal;
                const isDiag = ri === ci;
                const bg = isDiag
                  ? `rgba(74, 222, 128, ${0.2 + intensity * 0.7})`
                  : val > 0
                  ? `rgba(248, 113, 113, ${0.15 + intensity * 0.6})`
                  : "transparent";
                return (
                  <td
                    key={ci}
                    className="p-2 text-center font-mono border border-slate-100"
                    style={{ backgroundColor: bg }}
                  >
                    {val}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-slate-400 text-center mt-2">
        Green diagonal = correct predictions. Red off-diagonal = misclassifications.
      </p>
    </div>
  );
}
