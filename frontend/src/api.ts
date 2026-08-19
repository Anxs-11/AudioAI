/**
 * API client – all backend calls go through here.
 * Handles JWT token storage and auto-injection into request headers.
 */

import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "/api",
});

// Inject stored JWT into every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// On 401, clear token and redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

/* ── Auth ──────────────────────────────────────────────────────────────────── */

export async function login(username: string, password: string): Promise<string> {
  const res = await api.post("/auth/login", { username, password });
  const token: string = res.data.access_token;
  localStorage.setItem("token", token);
  return token;
}

export function logout() {
  localStorage.removeItem("token");
  window.location.href = "/login";
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem("token");
}

/* ── Batch ─────────────────────────────────────────────────────────────────── */

export interface UploadResponse {
  batch_id: number;
  total_files: number;
  files: string[];
  validation_errors: string[];
}

export async function uploadBatch(file: File): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await api.post("/batch/upload", form);
  return res.data;
}

export async function uploadFiles(files: File[]): Promise<UploadResponse> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  const res = await api.post("/batch/upload-files", form);
  return res.data;
}

export async function runBatch(batchId: number) {
  return api.post(`/batch/${batchId}/run`);
}

export interface BatchStatus {
  id: number;
  status: string;
  total_files: number;
  processed_files: number;
  failed_files: number;
  created_at: string;
}

export async function getBatchStatus(batchId: number): Promise<BatchStatus> {
  const res = await api.get(`/batch/${batchId}`);
  return res.data;
}

export interface AnalysisResult {
  emotional_tone: string;
  emotional_intensity: string;
  background_noise_present: boolean;
  background_noise_type: string;
  background_noise_severity: string;
  audio_quality: string;
  speaker_overlap_present: boolean;
  long_silence_present: boolean;
  confidence: number;
}

export interface FileResult {
  filename: string;
  status: string;
  result: AnalysisResult | null;
  error: string | null;
}

export async function getBatchResults(batchId: number): Promise<FileResult[]> {
  const res = await api.get(`/batch/${batchId}/results`);
  return res.data;
}

export async function listBatches(): Promise<BatchStatus[]> {
  const res = await api.get("/batch/");
  return res.data;
}

export async function downloadResults(batchId: number, format: "csv" | "json") {
  const res = await api.get(`/batch/${batchId}/download/${format}`, {
    responseType: "blob",
  });
  const blob = new Blob([res.data]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `batch_${batchId}_results.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

export function getAudioUrl(batchId: number, filename: string): string {
  const token = localStorage.getItem("token");
  return `/api/batch/${batchId}/audio/${encodeURIComponent(filename)}?token=${token}`;
}

export interface BatchMetrics {
  total_completed: number;
  tone_distribution: Record<string, number>;
  intensity_distribution: Record<string, number>;
  noise_severity_distribution: Record<string, number>;
  noise_type_distribution: Record<string, number>;
  quality_distribution: Record<string, number>;
  average_confidence: number;
  confidence_values: number[];
  overlap_count: number;
  silence_count: number;
  confusion_matrix: { labels: string[]; matrix: number[][] } | null;
}

export async function getBatchMetrics(batchId: number): Promise<BatchMetrics> {
  const res = await api.get(`/batch/${batchId}/metrics`);
  return res.data;
}

export default api;
