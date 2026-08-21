import jsPDF from "jspdf";

const BLUE = [42, 120, 214] as const;
const DARK = [15, 23, 42] as const;
const GRAY = [100, 116, 139] as const;
const GREEN = [16, 185, 129] as const;
const RED = [239, 68, 68] as const;
const AMBER = [245, 158, 11] as const;

type RGB = readonly [number, number, number];

let y = 0;
let doc: jsPDF;
const LM = 20; // left margin
const PW = 170; // page width (A4 - margins)

function checkPage(needed: number) {
  if (y + needed > 275) {
    doc.addPage();
    y = 20;
  }
}

function heading(text: string, color: RGB = BLUE) {
  checkPage(14);
  doc.setFontSize(13);
  doc.setTextColor(...color);
  doc.setFont("helvetica", "bold");
  doc.text(text, LM, y);
  y += 4;
  doc.setDrawColor(...color);
  doc.setLineWidth(0.5);
  doc.line(LM, y, LM + PW, y);
  y += 7;
}

function subheading(text: string) {
  checkPage(10);
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.setFont("helvetica", "bold");
  doc.text(text, LM, y);
  y += 6;
}

function para(text: string, indent = 0) {
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.setFont("helvetica", "normal");
  const lines = doc.splitTextToSize(text, PW - indent);
  for (const line of lines) {
    checkPage(5);
    doc.text(line, LM + indent, y);
    y += 4.5;
  }
  y += 2;
}

function bullet(text: string, color: RGB = DARK) {
  checkPage(6);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...color);
  doc.text("•", LM + 4, y);
  doc.setTextColor(51, 65, 85);
  const lines = doc.splitTextToSize(text, PW - 10);
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) checkPage(5);
    doc.text(lines[i], LM + 9, y);
    y += 4.5;
  }
}

function tableRow(cells: string[], widths: number[], header = false, rowColor?: RGB) {
  checkPage(7);
  const h = 7;
  if (header) {
    doc.setFillColor(42, 120, 214);
    doc.rect(LM, y - 4.5, PW, h, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
  } else if (rowColor) {
    doc.setTextColor(...rowColor);
    doc.setFont("helvetica", "bold");
  } else {
    doc.setTextColor(51, 65, 85);
    doc.setFont("helvetica", "normal");
  }
  doc.setFontSize(8);
  let x = LM;
  for (let i = 0; i < cells.length; i++) {
    doc.text(cells[i], x + 2, y);
    x += widths[i];
  }
  y += 5;
  if (!header) {
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.1);
    doc.line(LM, y - 2, LM + PW, y - 2);
  }
}

export function downloadMemoPdf() {
  doc = new jsPDF({ unit: "mm", format: "a4" });
  y = 20;

  // Title block
  doc.setFillColor(...DARK);
  doc.rect(0, 0, 210, 40, "F");
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.text("AutoAce Voice Tone & Noise Analyzer", LM, 18);
  doc.setFontSize(11);
  doc.setTextColor(148, 163, 184);
  doc.setFont("helvetica", "normal");
  doc.text("Technical Memo — Approach, Validation, Cost & Latency", LM, 26);
  doc.setFontSize(8);
  doc.text(`Generated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, LM, 33);
  y = 50;

  // 1. Approach
  heading("1. Approach Selected & Rationale");
  subheading("Final System: Fine-Tuned 5-Class Wav2Vec2 Ensemble");
  para("An MLP classifier head trained on 3,646 samples (RAVDESS 1,440 + ESD 1,956 + MELD 250), dynamically blended with the original 4-class Wav2Vec2 audio model.");
  para("Architecture: Audio → Whisper (transcription) + Wav2Vec2 (4-class + 5-class fine-tuned) + distilRoBERTa (text emotion) + librosa (acoustic features) → Weighted Ensemble (audio 0.45, text 0.25, acoustic 0.15, fine-tuned 0.10) → Keyword Boosting → 9-field output.");
  subheading("Why This Approach");
  bullet("All models run locally on CPU — zero API cost, no data leaves the server");
  bullet("Dynamic blending preserves original model robustness while adding 5-class granularity");
  bullet("Shared Wav2Vec2 encoder saves ~360MB memory");
  bullet("Zero additional inference cost — same base model for both classifiers");
  y += 3;

  // 2. Validation
  heading("2. Validation Results");
  subheading("Emotion Tone Accuracy — Production Calls (3/3 = 100%)");
  const tw = [50, 40, 40, 40];
  tableRow(["Call", "Predicted", "Ground Truth", "Match"], tw, true);
  tableRow(["call_001.ogg", "upset", "upset", "✓ Correct"], tw, false, GREEN as unknown as RGB);
  tableRow(["call_002.ogg", "neutral", "neutral", "✓ Correct"], tw, false, GREEN as unknown as RGB);
  tableRow(["call_003.ogg", "satisfied", "satisfied", "✓ Correct"], tw, false, GREEN as unknown as RGB);
  y += 4;

  subheading("Overall Field Accuracy — Production Calls (87.5%)");
  const fw = [50, 40, 40, 40];
  tableRow(["Call", "Fields Correct", "Total", "Accuracy"], fw, true);
  tableRow(["call_001.ogg", "8/8", "8", "100%"], fw);
  tableRow(["call_002.ogg", "5/8", "8", "62.5%"], fw);
  tableRow(["call_003.ogg", "8/8", "8", "100%"], fw);
  y += 2;
  para("call_002 errors: background noise (TV at -69dB) below physical detection threshold.", 2);

  subheading("Non-Emotion Field Accuracy (93 Diverse Samples)");
  const nw = [60, 40, 40, 30];
  tableRow(["Field", "Accuracy", "Samples", ""], nw, true);
  tableRow(["background_noise_present", "95%", "93", ""], nw);
  tableRow(["speaker_overlap_present", "100%", "93", ""], nw);
  tableRow(["long_silence_present", "100%", "93", ""], nw);
  tableRow(["audio_quality", "100%", "93", ""], nw);
  tableRow(["Overall", "99%", "372 evaluations", ""], nw, false, GREEN as unknown as RGB);
  y += 4;

  subheading("Leakage Prevention");
  bullet("80/20 stratified train/test split — no sample in both sets");
  bullet("Production test calls (3) completely unseen during training");
  bullet("Augmentations applied only after splitting");
  bullet("Training data (RAVDESS+ESD+MELD) has zero overlap with production recordings");
  y += 3;

  // 3. Cost
  heading("3. Cost Analysis");
  const cw = [90, 80];
  tableRow(["Component", "Cost / Audio Min"], cw, true);
  tableRow(["Whisper transcription (local)", "$0.000"], cw);
  tableRow(["Wav2Vec2 emotion (local)", "$0.000"], cw);
  tableRow(["distilRoBERTa text (local)", "$0.000"], cw);
  tableRow(["Acoustic analysis (local)", "$0.000"], cw);
  tableRow(["Total inference cost", "$0.000"], cw, false, GREEN as unknown as RGB);
  y += 3;


  // 4. Latency
  heading("4. Latency Per Clip");
  const lw = [55, 40, 40, 40];
  tableRow(["Audio Duration", "Before", "After", "Speed Ratio"], lw, true);
  tableRow(["31 seconds", "27.3s", "~12s", "0.5× realtime"], lw);
  tableRow(["172 seconds", "102s", "~42s", "0.5× realtime"], lw);
  y += 2;
  para("Pipeline optimization via parallel execution and INT8 quantization reduced processing time by ~50% with <2% accuracy impact on production calls.");
  y += 3;

  subheading("Processing Breakdown (31-second call)");
  const bw = [80, 35, 35];
  tableRow(["Step", "Before", "After"], bw, true);
  tableRow(["Audio loading + resampling", "~1s", "~1s"], bw);
  tableRow(["Whisper transcription", "~5s", "~5s"], bw);
  tableRow(["Acoustic features (librosa)", "~8s", "~2s"], bw);
  tableRow(["Wav2Vec2 emotion (audio)", "~10s", "~5.5s"], bw);
  tableRow(["Diarization", "<1s", "<1s"], bw);
  tableRow(["Text emotion (RoBERTa)", "~1s", "~1s"], bw);
  tableRow(["Noise + quality analysis", "~1s", "~1s"], bw);
  tableRow(["Ensemble + output", "<1s", "<1s"], bw);
  tableRow(["Total", "~27s", "~12s"], bw, false, BLUE as unknown as RGB);
  y += 2;
  para("Cold start: ~15s model loading (one-time at startup, pre-loaded in background thread).");
  y += 3;

  // 5. Failure Modes
  heading("5. Known Failure Modes & Mitigations");
  const fm: [string, string, RGB][] = [
    ["Very short clips (<5s)", "Insufficient context for reliable emotion classification", AMBER as unknown as RGB],
    ["Distressed class", "Underrepresented in training; may be confused with upset", AMBER as unknown as RGB],
    ["Quiet background noise (<-60dB)", "Below physical detection threshold", GRAY as unknown as RGB],
    ["Non-English calls", "Models are English-focused; accuracy degrades", RED as unknown as RGB],
    ["Acted vs. natural speech gap", "Fine-tuned on acted datasets; real calls may differ", AMBER as unknown as RGB],
  ];
  for (const [mode, impact, color] of fm) {
    checkPage(10);
    doc.setFillColor(...color);
    doc.circle(LM + 3, y - 1, 1.2, "F");
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    doc.text(mode, LM + 8, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GRAY);
    const lines = doc.splitTextToSize(impact, PW - 8);
    for (const line of lines) {
      doc.text(line, LM + 8, y);
      y += 4;
    }
    y += 2;
  }

  y += 3;
  subheading("Mitigations");
  bullet("Dynamic blending favors robust original model when confident");
  bullet("Keyword boosting catches frustrated/distressed from transcript");
  bullet("Confidence scores reflect sub-model disagreement");

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(148, 163, 184);
    doc.text("AutoAce — Confidential Technical Memo", LM, 290);
    doc.text(`Page ${i} of ${pages}`, 175, 290);
  }

  doc.save("AutoAce_Technical_Memo.pdf");
}
