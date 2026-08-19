import { useState, useRef } from "react";
import { FileResult, getAudioUrl } from "../api";

interface Props {
  results: FileResult[];
  batchId: number;
}

const toneBadge: Record<string, string> = {
  neutral: "bg-gray-100 text-gray-700",
  satisfied: "bg-green-100 text-green-700",
  frustrated: "bg-yellow-100 text-yellow-700",
  upset: "bg-orange-100 text-orange-700",
  distressed: "bg-red-100 text-red-700",
};

const severityBadge: Record<string, string> = {
  none: "bg-gray-100 text-gray-600",
  low: "bg-blue-100 text-blue-700",
  medium: "bg-yellow-100 text-yellow-700",
  high: "bg-red-100 text-red-700",
};

function Badge({ text, colors }: { text: string; colors: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${colors}`}>
      {text}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 45 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-slate-600">{pct}%</span>
    </div>
  );
}

export default function ResultsTable({ results, batchId }: Props) {
  const [detailFile, setDetailFile] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playingFile, setPlayingFile] = useState<string | null>(null);
  const [filterTone, setFilterTone] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const filteredResults = results.filter((r) => {
    if (searchTerm && !r.filename.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterTone && r.result?.emotional_tone !== filterTone) return false;
    return true;
  });

  const detailResult = filteredResults.find((r) => r.filename === detailFile);

  function togglePlay(filename: string) {
    if (playingFile === filename) {
      audioRef.current?.pause();
      setPlayingFile(null);
    } else {
      setPlayingFile(filename);
    }
  }

  return (
    <div className="mt-8 space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          placeholder="Search files..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 w-48"
        />
        <select
          value={filterTone}
          onChange={(e) => setFilterTone(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
        >
          <option value="">All Tones</option>
          <option value="neutral">Neutral</option>
          <option value="satisfied">Satisfied</option>
          <option value="frustrated">Frustrated</option>
          <option value="upset">Upset</option>
          <option value="distressed">Distressed</option>
        </select>
        <span className="text-xs text-slate-400">
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

      {/* Results as cards */}
      <div className="space-y-2">
        {filteredResults.map((fr) => (
          <div
            key={fr.filename}
            className={`bg-white rounded-xl shadow-sm border transition ${
              detailFile === fr.filename ? "border-slate-900 ring-1 ring-slate-900" : "border-gray-100 hover:border-slate-300"
            }`}
          >
            {/* Main row */}
            <div className="flex items-center gap-4 px-5 py-3">
              {/* Play/pause button */}
              <button
                onClick={() => togglePlay(fr.filename)}
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm transition shrink-0 ${
                  playingFile === fr.filename
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-900 hover:bg-slate-700 text-white"
                }`}
                title={playingFile === fr.filename ? "Pause" : "Play"}
              >
                {playingFile === fr.filename ? "⏸" : "▶"}
              </button>

              {/* Filename */}
              <div className="min-w-[120px]">
                <p className="text-sm font-medium text-slate-800 truncate">{fr.filename}</p>
              </div>

              {/* Quick stats */}
              {fr.result ? (
                <>
                  <Badge text={fr.result.emotional_tone} colors={toneBadge[fr.result.emotional_tone] || "bg-gray-100 text-gray-600"} />
                  <span className="text-xs text-slate-500">{fr.result.emotional_intensity}</span>
                  <Badge text={fr.result.background_noise_severity} colors={severityBadge[fr.result.background_noise_severity] || ""} />
                  <span className="text-xs text-slate-500">{fr.result.audio_quality}</span>
                  <ConfidenceBar value={fr.result.confidence} />
                </>
              ) : (
                <span className="text-xs text-slate-400">
                  {fr.error ? <span className="text-red-500">{fr.error}</span> : "Processing..."}
                </span>
              )}

              {/* Spacer */}
              <div className="flex-1" />

              {/* Detail button */}
              <button
                onClick={() => setDetailFile(detailFile === fr.filename ? null : fr.filename)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  detailFile === fr.filename
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {detailFile === fr.filename ? "Hide" : "Details"}
              </button>

              {/* Status */}
              <Badge
                text={fr.status}
                colors={
                  fr.status === "completed"
                    ? "bg-green-100 text-green-700"
                    : fr.status === "failed"
                    ? "bg-red-100 text-red-700"
                    : "bg-gray-100 text-gray-600"
                }
              />
            </div>

            {/* Expanded detail panel */}
            {detailFile === fr.filename && fr.result && (
              <div className="border-t border-gray-100 px-5 py-4 bg-slate-50/50 rounded-b-xl">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Audio player + waveform area */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Audio Playback</p>
                    <audio
                      controls
                      className="w-full"
                      src={getAudioUrl(batchId, fr.filename)}
                    />

                    {/* Key metrics grid */}
                    <div className="grid grid-cols-2 gap-2 mt-4">
                      <MiniStat label="Tone" value={fr.result.emotional_tone} />
                      <MiniStat label="Intensity" value={fr.result.emotional_intensity} />
                      <MiniStat label="Noise" value={fr.result.background_noise_severity} />
                      <MiniStat label="Type" value={fr.result.background_noise_type || "—"} />
                      <MiniStat label="Quality" value={fr.result.audio_quality} />
                      <MiniStat label="Overlap" value={fr.result.speaker_overlap_present ? "Yes" : "No"} />
                      <MiniStat label="Silence" value={fr.result.long_silence_present ? "Yes" : "No"} />
                      <MiniStat label="Confidence" value={`${(fr.result.confidence * 100).toFixed(0)}%`} />
                    </div>
                  </div>

                  {/* JSON output */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Full JSON Output</p>
                    <pre className="text-xs text-slate-700 bg-white border rounded-lg p-3 overflow-x-auto whitespace-pre-wrap max-h-64 overflow-y-auto">
                      {JSON.stringify(fr.result, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-100 rounded-lg px-3 py-2">
      <p className="text-[10px] text-slate-400 uppercase">{label}</p>
      <p className="text-sm font-medium text-slate-800 truncate">{value}</p>
    </div>
  );
}
