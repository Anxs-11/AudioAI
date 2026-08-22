interface Props {
  percent: number;
}

export default function ProgressBar({ percent }: Props) {
  return (
    <div className="w-full bg-white/10 rounded-full h-3 overflow-hidden">
      <div
        className="bg-[#3b8beb] h-3 rounded-full transition-all duration-700 ease-out relative overflow-hidden"
        style={{ width: `${Math.min(percent, 100)}%` }}
      >
        {/* Animated shimmer effect while progressing */}
        {percent < 100 && (
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_1.5s_infinite]" />
        )}
      </div>
    </div>
  );
}
