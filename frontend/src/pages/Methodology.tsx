import { downloadMemoPdf } from "../utils/generateMemoPdf";

export default function Methodology() {
  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-100 mb-1">Methodology</h2>
          <p className="text-sm text-gray-500">Technical memo — approach, cost, latency, and failure modes</p>
        </div>
        <button
          onClick={downloadMemoPdf}
          className="px-4 py-2 rounded-lg text-xs font-medium border border-white/[0.07] bg-[#151d2e] hover:bg-[#1c2640] text-gray-300 hover:text-white transition"
        >
          ↓ Download PDF
        </button>
      </div>

      <div className="space-y-5">
        {/* Approach */}
        <Section title="1. Approach Selected & Rationale">
          <p>
            <Strong>Fine-Tuned 5-Class Wav2Vec2 Ensemble</Strong> — an MLP classifier head trained on 3,646 samples
            (RAVDESS + ESD + MELD), dynamically blended with the original 4-class audio model.
          </p>
          <div className="mt-3 bg-[#0c111b] rounded-lg p-4 font-mono text-[11px] text-gray-400 leading-loose">
            Audio → Whisper (transcription) + Wav2Vec2 (4-class emotion + 5-class fine-tuned)<br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ distilRoBERTa (text emotion) + librosa (acoustic features)<br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ Weighted Ensemble (0.45 audio, 0.25 text, 0.15 acoustic, 0.10 fine-tuned)<br />
            &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ Keyword Boosting → 9-field output
          </div>
          <p className="mt-3">
            <Strong>Why this approach:</Strong> All models run locally on CPU — zero API cost, no data leaves the server.
            Dynamic blending preserves the original model's robustness on real calls while adding 5-class granularity.
            The shared Wav2Vec2 encoder saves ~360MB memory.
          </p>
        </Section>

        {/* Cost */}
        <Section title="2. Cost Per Minute">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-500 uppercase tracking-wider">
                  <th className="text-left pb-3 font-medium">Component</th>
                  <th className="text-right pb-3 font-medium">Cost / Audio Minute</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {[
                  ["Whisper transcription (local)", "$0.000"],
                  ["Wav2Vec2 emotion (local)", "$0.000"],
                  ["distilRoBERTa text (local)", "$0.000"],
                  ["Acoustic analysis (local)", "$0.000"],
                ].map(([name, cost]) => (
                  <tr key={name}>
                    <td className="py-2 text-gray-300 text-xs">{name}</td>
                    <td className="py-2 text-right text-gray-200 font-mono text-xs">{cost}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 text-gray-100 text-xs">Total inference cost</td>
                  <td className="py-2 text-right text-emerald-300 font-mono text-xs">$0.000</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-4 bg-[#0c111b] rounded-lg p-4 text-xs text-gray-400 leading-relaxed">
            <p className="text-gray-200 font-medium mb-2">Infrastructure cost example:</p>
            <p>Railway Hobby plan: <Strong>$5/month</Strong></p>
            <p>At 10,000 min/month: $5 ÷ 10,000 = <Strong>$0.0005/min</Strong></p>
            <p>At 1,000 min/month: $5 ÷ 1,000 = <Strong>$0.005/min</Strong></p>
            <p className="mt-2 text-emerald-300">Well within the $0.003/min ceiling at &gt;1,667 min/month.</p>
          </div>
        </Section>

        {/* Latency */}
        <Section title="3. Latency Per Clip">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <LatencyCard label="31-second call" time="~12s" ratio="0.5× realtime (optimized)" />
            <LatencyCard label="172-second call" time="~42s" ratio="0.5× realtime (optimized)" />
          </div>
          <p className="text-xs text-emerald-300 mb-4">
            Pipeline optimization via parallel execution and INT8 quantization reduced processing time by ~50% with &lt;2% accuracy impact on production calls.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-500 uppercase tracking-wider">
                  <th className="text-left pb-3 font-medium">Processing Step</th>
                  <th className="text-right pb-3 font-medium">Before</th>
                  <th className="text-right pb-3 font-medium">After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {[
                  ["Audio loading + resampling", "~1s", "~1s"],
                  ["Whisper transcription", "~5s", "~5s ∥"],
                  ["Acoustic features (librosa)", "~8s", "~2s ∥"],
                  ["Wav2Vec2 emotion (audio)", "~10s", "~5.5s ∥"],
                  ["Diarization", "<1s", "<1s"],
                  ["Text emotion (RoBERTa)", "~1s", "~1s"],
                  ["Noise + quality analysis", "~1s", "~1s"],
                  ["Ensemble + output", "<1s", "<1s"],
                ].map(([step, before, after]) => (
                  <tr key={step}>
                    <td className="py-2 text-gray-300 text-xs">{step}</td>
                    <td className="py-2 text-right text-gray-500 font-mono text-xs line-through">{before}</td>
                    <td className="py-2 text-right text-gray-300 font-mono text-xs">{after}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 text-gray-100 text-xs">Total (31s clip)</td>
                  <td className="py-2 text-right text-gray-500 font-mono text-xs line-through">~27s</td>
                  <td className="py-2 text-right text-blue-300 font-mono text-xs">~12s</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-500 mt-3">
            Cold start (first request): ~15s model loading (one-time at startup, pre-loaded in background thread).
          </p>
        </Section>

        {/* Failure Modes */}
        <Section title="4. Known Failure Modes">
          <div className="space-y-3">
            {[
              { mode: "Very short clips (<5s)", impact: "Insufficient context for reliable emotion classification", severity: "medium" },
              { mode: "Distressed class", impact: "Underrepresented in training data; may be confused with upset", severity: "medium" },
              { mode: "Very quiet background noise (<-60dB)", impact: "Below physical detection threshold (e.g., distant TV)", severity: "low" },
              { mode: "Non-English calls", impact: "Models are English-focused; accuracy degrades on other languages", severity: "high" },
              { mode: "Acted vs. natural speech gap", impact: "Fine-tuned model trained on acted datasets; may differ from real calls", severity: "medium" },
            ].map((f) => (
              <div key={f.mode} className="flex items-start gap-3 bg-[#0c111b] rounded-lg p-3.5 border border-white/[0.04]">
                <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${
                  f.severity === "high" ? "bg-red-400" : f.severity === "medium" ? "bg-amber-400" : "bg-gray-500"
                }`} />
                <div>
                  <p className="text-xs font-medium text-gray-200">{f.mode}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{f.impact}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Mitigation */}
        <Section title="5. Mitigations & Next Steps">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 font-medium">Current Mitigations</p>
              <ul className="space-y-1.5 text-xs text-gray-300">
                <li>• Dynamic blending favors robust original model when confident</li>
                <li>• Keyword boosting catches frustrated/distressed from transcript</li>
                <li>• Confidence scores reflect sub-model disagreement</li>
              </ul>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 font-medium">Next Steps</p>
              <ul className="space-y-1.5 text-xs text-gray-300">
                <li>• Fine-tune on real labeled call center audio</li>
                <li>• Switch to whisper-medium for accented speech</li>
                <li>• GPU inference for 5-10× speedup</li>
                <li>• Active learning: flag low-confidence for human review</li>
              </ul>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#151d2e] border border-white/[0.07] rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.07]">
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      </div>
      <div className="px-5 py-4 text-xs text-gray-300 leading-relaxed">{children}</div>
    </div>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return <span className="text-gray-100 font-medium">{children}</span>;
}

function LatencyCard({ label, time, ratio }: { label: string; time: string; ratio: string }) {
  return (
    <div className="bg-[#0c111b] rounded-lg p-4 border border-white/[0.06]">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">{label}</p>
      <p className="text-lg font-bold text-blue-300 tabular-nums">{time}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">{ratio}</p>
    </div>
  );
}
