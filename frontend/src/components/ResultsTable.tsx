import { useState, useRef, useCallback } from "react";
import { FileResult, getAudioUrl, AnalysisResult, FileResultDetail } from "../api";

interface Props {
  results: FileResult[];
  batchId: number;
}

const toneColors: Record<string, { bg: string; text: string }> = {
  neutral: { bg: "bg-slate-400/15", text: "text-slate-300" },
  satisfied: { bg: "bg-emerald-400/15", text: "text-emerald-300" },
  frustrated: { bg: "bg-orange-400/15", text: "text-orange-300" },
  upset: { bg: "bg-rose-400/15", text: "text-rose-300" },
  distressed: { bg: "bg-pink-400/15", text: "text-pink-300" },
};

function ToneBadge({ tone }: { tone: string }) {
  const c = toneColors[tone] || toneColors.neutral;
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold ${c.bg} ${c.text}`}>
      {tone}
    </span>
  );
}

function TagBadge({ text }: { text: string }) {
  return (
    <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/[0.08] text-gray-300 border border-white/[0.05]">
      {text}
    </span>
  );
}

function ConfidenceBarInline({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const barColor = pct >= 70 ? "#34d399" : pct >= 45 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="flex-1 h-[6px] bg-white/[0.08] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
      </div>
      <span className="text-xs font-semibold tabular-nums" style={{ color: barColor }}>{pct}%</span>
    </div>
  );
}

function ConfidenceBarFull({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const barColor = pct >= 70 ? "#34d399" : pct >= 45 ? "#fbbf24" : "#f87171";
  return (
    <div className="bg-[#111827] border border-white/[0.06] rounded-xl px-5 py-4">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">Confidence</span>
        <span className="text-lg font-bold tabular-nums" style={{ color: barColor }}>{value.toFixed(2)}</span>
      </div>
      <div className="w-full h-2.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}

export default function ResultsTable({ results, batchId }: Props) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingFile, setPlayingFile] = useState<string | null>(null);
  const [filterTone, setFilterTone] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [showJson, setShowJson] = useState<string | null>(null);

  const filteredResults = results.filter((r) => {
    if (searchTerm && !r.filename.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterTone && r.result?.emotional_tone !== filterTone) return false;
    return true;
  });

  function togglePlay(filename: string) {
    if (playingFile === filename) {
      audioRef.current?.pause();
      setPlayingFile(null);
    } else {
      setPlayingFile(filename);
    }
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center mb-2">
        <input
          type="text"
          placeholder="Search files..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-3 py-2 border border-white/[0.07] bg-[#151d2e] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#5b8def]/40 w-48 placeholder-gray-600"
        />
        <select
          value={filterTone}
          onChange={(e) => setFilterTone(e.target.value)}
          className="px-3 py-2 border border-white/[0.07] bg-[#151d2e] rounded-lg text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#5b8def]/40"
        >
          <option value="">All Tones</option>
          <option value="neutral">Neutral</option>
          <option value="satisfied">Satisfied</option>
          <option value="frustrated">Frustrated</option>
          <option value="upset">Upset</option>
          <option value="distressed">Distressed</option>
        </select>
        <span className="text-xs text-gray-500">
          {filteredResults.length} of {results.length} files
        </span>
      </div>

      {/* Hidden audio element */}
      {playingFile && (
        <audio
          ref={audioRef}
          src={getAudioUrl(batchId, playingFile)}
          autoPlay
          onEnded={() => setPlayingFile(null)}
          className="hidden"
        />
      )}

      {/* File cards */}
      {filteredResults.map((fr) => {
        const isExpanded = expandedFile === fr.filename;
        const r = fr.result;

        return (
          <div
            key={fr.filename}
            className={`bg-[#151d2e] rounded-xl border transition-all duration-200 ${
              isExpanded ? "border-[#5b8def]/40 ring-1 ring-[#5b8def]/20" : "border-white/[0.07] hover:border-white/[0.14]"
            }`}
          >
            {/* Collapsed row */}
            <div
              className="flex items-center gap-3 px-5 py-3 cursor-pointer select-none"
              onClick={() => setExpandedFile(isExpanded ? null : fr.filename)}
            >
              {/* Play button */}
              <button
                onClick={(e) => { e.stopPropagation(); togglePlay(fr.filename); }}
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm transition shrink-0 ${
                  playingFile === fr.filename
                    ? "bg-[#5b8def] text-white shadow-lg shadow-[#5b8def]/30"
                    : "bg-white/[0.08] hover:bg-white/[0.14] text-gray-400 hover:text-white"
                }`}
              >
                {playingFile === fr.filename ? "⏸" : "▶"}
              </button>

              {/* Filename */}
              <p className="text-sm font-medium text-gray-200 min-w-[120px] truncate">{fr.filename}</p>

              {/* Badges */}
              {r && (
                <div className="flex items-center gap-2 flex-wrap">
                  <ToneBadge tone={r.emotional_tone} />
                  <TagBadge text={`${r.emotional_intensity} intensity`} />
                  <TagBadge text={`${r.background_noise_present ? r.background_noise_severity + " noise" : "no noise"} · ${r.audio_quality}`} />
                </div>
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Inline confidence */}
              {r && <ConfidenceBarInline value={r.confidence} />}

              {/* Chevron */}
              <span className={`text-gray-500 text-sm transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}>
                ▾
              </span>
            </div>

            {/* Expanded panel */}
            {isExpanded && r && (
              <div className="border-t border-white/[0.06] px-5 py-5 space-y-4 bg-[#111827] rounded-b-xl">
                {/* Full confidence bar */}
                <ConfidenceBarFull value={r.confidence} />

                {/* Stat grid */}
                <div className="grid grid-cols-3 gap-2.5">
                  <StatCard label="Emotional Tone" value={r.emotional_tone} color={toneColors[r.emotional_tone]?.text || "text-gray-200"} />
                  <StatCard label="Intensity" value={r.emotional_intensity} color={r.emotional_intensity === "high" ? "text-amber-300" : r.emotional_intensity === "low" ? "text-sky-300" : "text-gray-200"} />
                  <StatCard label="Audio Quality" value={r.audio_quality} color={r.audio_quality === "clear" ? "text-emerald-300" : r.audio_quality === "severely_impaired" ? "text-red-300" : "text-amber-300"} />
                  <StatCard label="Background Noise" value={r.background_noise_present ? "present" : "none"} />
                  <StatCard label="Noise Severity" value={r.background_noise_severity} />
                  <StatCard label="Noise Type" value={r.background_noise_type || "—"} />
                  <StatCard label="Speaker Overlap" value={String(r.speaker_overlap_present)} />
                  <StatCard label="Long Silence" value={String(r.long_silence_present)} />
                  <StatCard label="Confidence" value={`${(r.confidence * 100).toFixed(0)}%`} color="text-blue-300" />
                </div>

                {/* Explainability: per-model scores */}
                {fr.detail && (
                  <div className="space-y-3">
                    {fr.detail.audio_emotion && Object.keys(fr.detail.audio_emotion).length > 0 && (
                      <ModelScoreBar label="Audio Model" scores={fr.detail.audio_emotion} />
                    )}
                    {fr.detail.text_emotion && Object.keys(fr.detail.text_emotion).length > 0 && (
                      <ModelScoreBar label="Text Model" scores={fr.detail.text_emotion} />
                    )}
                    {fr.detail.quality_issues && fr.detail.quality_issues.length > 0 && (
                      <div className="bg-[#0c111b] border border-white/[0.06] rounded-lg px-4 py-3">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Quality Issues</p>
                        <div className="flex flex-wrap gap-1.5">
                          {fr.detail.quality_issues.map((issue, i) => (
                            <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-300 border border-amber-400/20">{issue}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {fr.detail.duration_sec != null && (
                      <div className="flex gap-3 text-[11px] text-gray-500">
                        <span>Duration: {fr.detail.duration_sec}s</span>
                        {fr.detail.processing_time_sec != null && <span>Processed in: {fr.detail.processing_time_sec}s</span>}
                        {fr.detail.language && <span>Language: {fr.detail.language}</span>}
                        {fr.detail.num_speakers != null && <span>Speakers: {fr.detail.num_speakers}</span>}
                      </div>
                    )}
                  </div>
                )}

                {/* Transcript with speaker turns */}
                {fr.detail?.speaker_turns && fr.detail.speaker_turns.length > 0 && (
                  <div className="bg-[#0c111b] border border-white/[0.06] rounded-lg px-4 py-3 max-h-40 overflow-y-auto">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Transcript</p>
                    <div className="space-y-1">
                      {fr.detail.speaker_turns.map((turn, i) => {
                        const spkColors = [
                          "text-blue-400", "text-emerald-400", "text-amber-400",
                          "text-purple-400", "text-rose-400", "text-cyan-400",
                        ];
                        const spkNum = parseInt(turn.speaker.replace(/\D/g, "") || "1", 10);
                        const color = spkColors[(spkNum - 1) % spkColors.length];
                        const label = `Speaker ${spkNum}`;
                        return (
                          <div key={i} className="text-xs leading-relaxed">
                            <span className={`font-semibold ${color}`}>
                              {label}
                            </span>
                            <span className="text-gray-600 ml-1">[{turn.start}s–{turn.end}s]</span>
                            <span className="text-gray-300 ml-1.5">{turn.text}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {fr.detail?.transcript && (!fr.detail.speaker_turns || fr.detail.speaker_turns.length === 0) && (
                  <div className="bg-[#0c111b] border border-white/[0.06] rounded-lg px-4 py-3 max-h-40 overflow-y-auto">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Transcript</p>
                    <p className="text-xs text-gray-300 leading-relaxed">{fr.detail.transcript}</p>
                  </div>
                )}

                {/* Audio player */}
                <div className="bg-[#0f1623] rounded-xl p-1">
                  <audio
                    controls
                    className="w-full h-10"
                    src={getAudioUrl(batchId, fr.filename)}
                  />
                </div>

                {/* Raw JSON toggle */}
                <div>
                  <button
                    onClick={() => setShowJson(showJson === fr.filename ? null : fr.filename)}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition"
                  >
                    <span className="font-mono">&lt;/&gt;</span>
                    {showJson === fr.filename ? "Hide raw JSON" : "Show raw JSON"}
                  </button>
                  {showJson === fr.filename && (
                    <JsonBlock data={r} />
                  )}
                </div>
              </div>
            )}

            {/* Error state */}
            {isExpanded && !r && fr.error && (
              <div className="border-t border-white/[0.06] px-5 py-4">
                <p className="text-sm text-red-400">{fr.error}</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, color = "text-gray-200" }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-[#0c111b] border border-white/[0.06] rounded-lg px-4 py-3">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-sm font-semibold ${color} truncate`}>{value}</p>
    </div>
  );
}

const jsonColors: Record<string, string> = {
  string: "#a5d6a7",
  number: "#ffcc80",
  boolean: "#80cbc4",
  key: "#90caf9",
  punctuation: "#78909c",
};

function colorizeJson(obj: AnalysisResult): React.ReactNode[] {
  const entries = Object.entries(obj);
  const nodes: React.ReactNode[] = [];

  entries.forEach(([key, val], i) => {
    const comma = i < entries.length - 1 ? "," : "";
    let valSpan: React.ReactNode;

    if (typeof val === "string") {
      valSpan = <span style={{ color: jsonColors.string }}>"{val}"</span>;
    } else if (typeof val === "number") {
      valSpan = <span style={{ color: jsonColors.number }}>{val}</span>;
    } else if (typeof val === "boolean") {
      valSpan = <span style={{ color: jsonColors.boolean }}>{String(val)}</span>;
    } else {
      valSpan = <span className="text-gray-400">{JSON.stringify(val)}</span>;
    }

    nodes.push(
      <span key={key}>
        <span style={{ color: jsonColors.key }}>"{key}"</span>
        <span style={{ color: jsonColors.punctuation }}>: </span>
        {valSpan}
        <span style={{ color: jsonColors.punctuation }}>{comma}</span>
        {"\n"}
      </span>
    );
  });

  return nodes;
}

function JsonBlock({ data }: { data: AnalysisResult }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [data]);

  return (
    <div className="relative mt-2 bg-[#0c111b] border border-white/[0.06] rounded-lg overflow-hidden">
      <button
        onClick={handleCopy}
        className="absolute top-2.5 right-2.5 w-7 h-7 rounded-md flex items-center justify-center bg-white/[0.06] hover:bg-white/[0.15] text-gray-500 hover:text-white transition"
        title="Copy JSON"
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
        )}
      </button>
      <pre className="text-[12px] p-4 pr-12 overflow-x-auto whitespace-pre-wrap max-h-56 overflow-y-auto font-mono leading-relaxed hide-scrollbar">
        <span style={{ color: jsonColors.punctuation }}>{"{\n"}</span>
        {colorizeJson(data)}
        <span style={{ color: jsonColors.punctuation }}>{"}"}</span>
      </pre>
    </div>
  );
}

const modelScoreColors: Record<string, string> = {
  neutral: "#94a3b8", satisfied: "#34d399", frustrated: "#fb923c",
  upset: "#f87171", distressed: "#f472b6",
  anger: "#f87171", disgust: "#a78bfa", fear: "#fbbf24",
  joy: "#34d399", sadness: "#60a5fa", surprise: "#c084fc",
};

function ModelScoreBar({ label, scores }: { label: string; scores: Record<string, number> }) {
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const top = sorted[0];
  return (
    <div className="bg-[#0c111b] border border-white/[0.06] rounded-lg px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
        <span className="text-xs font-semibold" style={{ color: modelScoreColors[top[0]] || "#94a3b8" }}>
          {Math.round(top[1] * 100)}% {top[0]}
        </span>
      </div>
      <div className="flex gap-0.5 h-2 rounded-full overflow-hidden">
        {sorted.map(([name, val]) => (
          <div
            key={name}
            title={`${name}: ${Math.round(val * 100)}%`}
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${Math.max(val * 100, 2)}%`, backgroundColor: modelScoreColors[name] || "#64748b" }}
          />
        ))}
      </div>
      <div className="flex gap-3 mt-1.5">
        {sorted.map(([name, val]) => (
          <span key={name} className="text-[10px] text-gray-500">
            <span className="inline-block w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: modelScoreColors[name] || "#64748b" }} />
            {name} {Math.round(val * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}
