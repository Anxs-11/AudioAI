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
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
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

const INTENSITY_COLORS: Record<string, string> = {
  low: "#93c5fd",
  medium: "#3b82f6",
  high: "#1d4ed8",
};

function toChartData(dist: Record<string, number>) {
  return Object.entries(dist).map(([name, value]) => ({ name, value }));
}

export default function MetricsPanel({ metrics }: Props) {
  const toneData = toChartData(metrics.tone_distribution);
  const severityData = toChartData(metrics.noise_severity_distribution);
  const qualityData = toChartData(metrics.quality_distribution);
  const noiseTypeData = toChartData(metrics.noise_type_distribution);
  const intensityData = toChartData(metrics.intensity_distribution);

  // Confidence histogram buckets
  const confBuckets = [0, 0, 0, 0, 0];
  (metrics.confidence_values || []).forEach((v) => {
    const idx = Math.min(Math.floor(v * 5), 4);
    confBuckets[idx]++;
  });
  const confData = ["0-20%", "20-40%", "40-60%", "60-80%", "80-100%"].map((name, i) => ({
    name,
    count: confBuckets[i],
  }));

  // Summary insights
  const total = metrics.total_completed;
  const negativeCount =
    (metrics.tone_distribution.upset || 0) +
    (metrics.tone_distribution.frustrated || 0) +
    (metrics.tone_distribution.distressed || 0);
  const noiseCount = total - (metrics.noise_severity_distribution.none || 0);

  return (
    <div className="space-y-8 mt-8">
      {/* Insights banner */}
      {total > 0 && (
        <div className="bg-[#0f1623] rounded-xl p-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 text-center">
            <div className="px-3 border-r border-white/10">
              <p className="text-[28px] font-medium text-[#e87ba4] leading-none mb-1">{negativeCount}</p>
              <p className="text-[11px] text-white/50">Negative emotions</p>
            </div>
            <div className="px-3 border-r border-white/10">
              <p className="text-[28px] font-medium text-[#1baf7a] leading-none mb-1">{noiseCount}</p>
              <p className="text-[11px] text-white/50">Background noise</p>
            </div>
            <div className="px-3 border-r border-white/10">
              <p className="text-[28px] font-medium text-[#7bb3f0] leading-none mb-1">{(metrics.average_confidence * 100).toFixed(0)}%</p>
              <p className="text-[11px] text-white/50">Avg confidence</p>
            </div>
            <div className="px-3">
              <p className="text-[28px] font-medium text-[#eda100] leading-none mb-1">{metrics.overlap_count}</p>
              <p className="text-[11px] text-white/50">Speaker overlaps</p>
            </div>
          </div>
        </div>
      )}

      {/* Summary stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Avg Confidence" value={`${(metrics.average_confidence * 100).toFixed(0)}%`} />
        <StatCard label="Speaker Overlap" value={metrics.overlap_count.toString()} subtitle={`of ${total} files`} />
        <StatCard label="Long Silence" value={metrics.silence_count.toString()} subtitle={`of ${total} files`} />
        <StatCard label="Clear Audio" value={(metrics.quality_distribution.clear || 0).toString()} subtitle={`of ${total} files`} />
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

        {/* Emotional Intensity */}
        <ChartCard title="Emotional Intensity">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={intensityData}>
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value">
                {intensityData.map((entry) => (
                  <Cell key={entry.name} fill={INTENSITY_COLORS[entry.name] || "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Confidence Distribution */}
        <ChartCard title="Confidence Score Distribution">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={confData}>
              <XAxis dataKey="name" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#0f172a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
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

function StatCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="bg-[#1a2236] border border-white/[0.08] rounded-xl px-5 py-4 text-center">
      <p className="text-[11px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-medium text-gray-100 mt-1">{value}</p>
      {subtitle && <p className="text-[10px] text-gray-600 mt-0.5">{subtitle}</p>}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#1a2236] border border-white/[0.08] rounded-xl p-5">
      <h3 className="text-[13px] font-medium text-gray-400 mb-3">{title}</h3>
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
