import { useState } from "react";

const PRODUCTION_CALLS = [
  { call: "call_001.ogg", predicted: "upset", truth: "upset", match: true, fields: "8/8", fieldPct: 100 },
  { call: "call_002.ogg", predicted: "neutral", truth: "neutral", match: true, fields: "5/8", fieldPct: 62.5 },
  { call: "call_003.ogg", predicted: "satisfied", truth: "satisfied", match: true, fields: "8/8", fieldPct: 100 },
];

const CONFUSION_MATRIX = {
  labels: ["neutral", "satisfied", "frustrated", "upset", "distressed"],
  matrix: [
    [1, 0, 0, 0, 0],
    [0, 1, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 1, 0],
    [0, 0, 0, 0, 0],
  ],
};

const APPROACH_COMPARISON = [
  {
    name: "Approach A: Wav2Vec2 Ensemble (4-class)",
    pros: ["Strong on real calls", "Robust to noise", "Zero API cost"],
    cons: ["Limited to 4 classes (angry/happy/neutral/sad)", "Cannot distinguish frustrated/upset/distressed"],
    accuracy: "N/A — classes don't match target",
  },
  {
    name: "Approach B: Fine-Tuned 5-Class (Selected)",
    pros: ["Full 5-class coverage", "Dynamic blending preserves robustness", "100% tone accuracy on production calls"],
    cons: ["79.9% validation accuracy on acted datasets", "Distressed class underrepresented"],
    accuracy: "100% (production), 79.9% (validation)",
  },
];

const FIELD_ACCURACY = [
  { field: "background_noise_present", accuracy: 95, samples: 93 },
  { field: "speaker_overlap_present", accuracy: 100, samples: 93 },
  { field: "long_silence_present", accuracy: 100, samples: 93 },
  { field: "audio_quality", accuracy: 100, samples: 93 },
];

const PER_CLASS = [
  { cls: "neutral", precision: "100%", recall: "100%", f1: "1.00", support: 1 },
  { cls: "satisfied", precision: "100%", recall: "100%", f1: "1.00", support: 1 },
  { cls: "upset", precision: "100%", recall: "100%", f1: "1.00", support: 1 },
  { cls: "frustrated", precision: "—", recall: "—", f1: "—", support: 0 },
  { cls: "distressed", precision: "—", recall: "—", f1: "—", support: 0 },
];

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#151d2e] border border-white/[0.07] rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-white/[0.07]">
        <h3 className="text-sm font-semibold text-gray-200">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export default function Validation() {
  const [activeSection, setActiveSection] = useState<"matrix" | "approaches" | "calibration">("matrix");

  const tabs = [
    { id: "matrix" as const, label: "Confusion Matrix & Accuracy" },
    { id: "approaches" as const, label: "Approach Comparison" },
    { id: "calibration" as const, label: "Confidence Calibration" },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h2 className="text-xl font-semibold text-gray-100 mb-1">Validation</h2>
      <p className="text-sm text-gray-500 mb-6">Model accuracy, approach comparison, and confidence calibration</p>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-[#0c111b] rounded-lg p-1 mb-6 w-fit">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveSection(t.id)}
            className={`px-4 py-2 rounded-md text-xs font-medium transition ${
              activeSection === t.id
                ? "bg-[#5b8def]/20 text-[#7bb3f0]"
                : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeSection === "matrix" && (
        <div className="space-y-5">
          {/* Production call results */}
          <SectionCard title="Emotion Tone Accuracy — Production Calls (3/3 = 100%)">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-gray-500 uppercase tracking-wider">
                    <th className="text-left pb-3 font-medium">Call</th>
                    <th className="text-left pb-3 font-medium">Predicted</th>
                    <th className="text-left pb-3 font-medium">Ground Truth</th>
                    <th className="text-center pb-3 font-medium">Match</th>
                    <th className="text-center pb-3 font-medium">Fields Correct</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {PRODUCTION_CALLS.map((c) => (
                    <tr key={c.call}>
                      <td className="py-2.5 text-gray-300 font-mono text-xs">{c.call}</td>
                      <td className="py-2.5 text-gray-200">{c.predicted}</td>
                      <td className="py-2.5 text-gray-200">{c.truth}</td>
                      <td className="py-2.5 text-center">
                        <span className={`text-xs font-semibold ${c.match ? "text-emerald-400" : "text-red-400"}`}>
                          {c.match ? "✓" : "✗"}
                        </span>
                      </td>
                      <td className="py-2.5 text-center">
                        <span className="text-xs text-gray-400">{c.fields}</span>
                        <span className={`ml-1.5 text-xs font-medium ${c.fieldPct === 100 ? "text-emerald-400" : "text-amber-400"}`}>
                          ({c.fieldPct}%)
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* Confusion matrix */}
          <SectionCard title="Confusion Matrix — 5-Class Emotion (Production Calls)">
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-gray-500 font-medium text-left">Actual ↓ / Predicted →</th>
                    {CONFUSION_MATRIX.labels.map((l) => (
                      <th key={l} className="px-3 py-2 text-gray-400 font-medium text-center">{l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CONFUSION_MATRIX.labels.map((label, i) => (
                    <tr key={label}>
                      <td className="px-3 py-2 text-gray-400 font-medium">{label}</td>
                      {CONFUSION_MATRIX.matrix[i].map((val, j) => {
                        const isDiag = i === j;
                        const bg = val > 0
                          ? isDiag ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"
                          : "text-gray-600";
                        return (
                          <td key={j} className={`px-3 py-2 text-center font-mono ${bg} rounded`}>
                            {val}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-gray-500 mt-3">
              Green diagonal = correct predictions. No off-diagonal errors on production calls.
              Frustrated and distressed classes had no production samples.
            </p>
          </SectionCard>

          {/* Per-class precision/recall */}
          <SectionCard title="Per-Class Precision / Recall (Production Calls)">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-500 uppercase tracking-wider">
                  <th className="text-left pb-3 font-medium">Class</th>
                  <th className="text-center pb-3 font-medium">Precision</th>
                  <th className="text-center pb-3 font-medium">Recall</th>
                  <th className="text-center pb-3 font-medium">F1</th>
                  <th className="text-center pb-3 font-medium">Support</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {PER_CLASS.map((r) => (
                  <tr key={r.cls}>
                    <td className="py-2.5 text-gray-300">{r.cls}</td>
                    <td className="py-2.5 text-center text-gray-200 font-mono text-xs">{r.precision}</td>
                    <td className="py-2.5 text-center text-gray-200 font-mono text-xs">{r.recall}</td>
                    <td className="py-2.5 text-center text-gray-200 font-mono text-xs">{r.f1}</td>
                    <td className="py-2.5 text-center text-gray-500 font-mono text-xs">{r.support}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>

          {/* Non-emotion field accuracy */}
          <SectionCard title="Non-Emotion Field Accuracy (93 Diverse Samples)">
            <div className="space-y-3">
              {FIELD_ACCURACY.map((f) => (
                <div key={f.field} className="flex items-center gap-4">
                  <span className="text-xs text-gray-400 font-mono w-48 shrink-0">{f.field}</span>
                  <div className="flex-1 h-2 bg-white/[0.06] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${f.accuracy}%`,
                        backgroundColor: f.accuracy === 100 ? "#34d399" : "#fbbf24",
                      }}
                    />
                  </div>
                  <span className="text-xs font-semibold tabular-nums w-12 text-right" style={{ color: f.accuracy === 100 ? "#34d399" : "#fbbf24" }}>
                    {f.accuracy}%
                  </span>
                  <span className="text-[10px] text-gray-600 w-20 text-right">{f.samples} samples</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-3">Overall: 372 field evaluations, 99% accuracy.</p>
          </SectionCard>
        </div>
      )}

      {activeSection === "approaches" && (
        <div className="space-y-4">
          {APPROACH_COMPARISON.map((a, i) => (
            <SectionCard key={i} title={a.name}>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 font-medium">Strengths</p>
                  <ul className="space-y-1.5">
                    {a.pros.map((p, j) => (
                      <li key={j} className="text-xs text-emerald-300 flex items-start gap-1.5">
                        <span className="mt-0.5 shrink-0">+</span> {p}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 font-medium">Limitations</p>
                  <ul className="space-y-1.5">
                    {a.cons.map((c, j) => (
                      <li key={j} className="text-xs text-amber-300 flex items-start gap-1.5">
                        <span className="mt-0.5 shrink-0">−</span> {c}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2 font-medium">Accuracy</p>
                  <p className="text-sm font-semibold text-gray-200">{a.accuracy}</p>
                  {i === 1 && (
                    <span className="inline-block mt-2 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-400/15 text-emerald-300">
                      SELECTED
                    </span>
                  )}
                </div>
              </div>
            </SectionCard>
          ))}
          <SectionCard title="Why Approach B Was Selected">
            <ul className="space-y-2 text-xs text-gray-300 leading-relaxed">
              <li>• The original 4-class model cannot distinguish frustrated / distressed / satisfied</li>
              <li>• Fine-tuning adds 5-class support while preserving the original model's robustness via dynamic blending</li>
              <li>• Dynamic blending prevents fine-tuned model from dominating on out-of-distribution audio</li>
              <li>• Zero additional inference cost — same base model, shared Wav2Vec2 encoder (~360MB saved)</li>
            </ul>
          </SectionCard>
        </div>
      )}

      {activeSection === "calibration" && (
        <div className="space-y-5">
          <SectionCard title="Confidence Score Calibration">
            <div className="space-y-4 text-xs text-gray-300 leading-relaxed">
              <p>
                Confidence scores are computed as a <span className="text-gray-100 font-medium">weighted ensemble agreement</span> measure,
                not raw softmax probabilities. The score reflects how strongly the independent sub-models agree on the final prediction:
              </p>
              <div className="bg-[#0c111b] rounded-lg p-4 font-mono text-[11px] text-gray-400 leading-relaxed">
                confidence = (audio_weight × audio_conf + text_weight × text_conf<br />
                &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;+ acoustic_weight × acoustic_conf + ft_weight × ft_conf)<br />
                <br />
                weights: audio=0.45, text=0.25, acoustic=0.15, fine-tuned=0.10
              </div>
              <p>
                This means a confidence of <span className="text-emerald-300 font-medium">0.83</span> indicates strong agreement
                across audio, text, and acoustic models, while <span className="text-amber-300 font-medium">0.33</span> indicates
                disagreement (e.g., audio says neutral but text detects frustration keywords).
              </p>
            </div>
          </SectionCard>

          <SectionCard title="Interpreting Confidence Levels">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#0c111b] rounded-lg p-4 border-l-2 border-emerald-400">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">High (&ge; 70%)</p>
                <p className="text-sm font-semibold text-emerald-300 mb-2">Strong agreement</p>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Multiple models converge on the same emotion. Prediction is reliable.
                </p>
              </div>
              <div className="bg-[#0c111b] rounded-lg p-4 border-l-2 border-amber-400">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">Medium (45–70%)</p>
                <p className="text-sm font-semibold text-amber-300 mb-2">Partial agreement</p>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Some sub-models disagree. Prediction likely correct but review recommended.
                </p>
              </div>
              <div className="bg-[#0c111b] rounded-lg p-4 border-l-2 border-red-400">
                <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-medium">Low (&lt; 45%)</p>
                <p className="text-sm font-semibold text-red-300 mb-2">Low agreement</p>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Models disagree significantly. Manual review strongly recommended.
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Leakage Prevention">
            <ul className="space-y-2 text-xs text-gray-300 leading-relaxed">
              <li>• <span className="text-gray-100 font-medium">Train/test split</span>: 80/20 stratified by class — no sample appears in both sets</li>
              <li>• <span className="text-gray-100 font-medium">Dataset separation</span>: Production test calls (3) are completely unseen during training</li>
              <li>• <span className="text-gray-100 font-medium">No data augmentation leak</span>: Augmentations applied only to training split after splitting</li>
              <li>• <span className="text-gray-100 font-medium">Separate datasets</span>: Training data (RAVDESS+ESD+MELD) has zero overlap with production call recordings</li>
            </ul>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
