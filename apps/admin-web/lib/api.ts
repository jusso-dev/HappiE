export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:18080";

export type ApiError = { error: string };

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers, cache: "no-store" });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as ApiError;
    throw new Error(body.error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export type ChildProfile = {
  id: string;
  name: string;
  avatar_color?: string;
  birth_year?: number;
  storage_quota_mb: number;
};

export type Video = {
  id: string;
  title: string;
  description: string;
  status: string;
  approved: boolean;
  category_id?: string;
  category_name?: string;
  duration_seconds?: number;
  file_size_bytes?: number;
  storage_bytes?: number;
  source_type: string;
  thumbnail_key?: string;
  thumbnail_url?: string;
  assignments?: VideoAssignment[];
  created_at: string;
};

export type VideoAssignment = {
  child_profile_id: string;
  child_name: string;
  download_priority: string;
  expires_at?: string;
};

export type ImportJob = {
  id: string;
  status: string;
  progress: number;
  source_url?: string;
  query?: string;
  error_message?: string;
  result_video_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export type StorageBreakdown = {
  kind?: string;
  source_type?: string;
  asset_count?: number;
  video_count?: number;
  total_bytes: number;
};

export type StorageVideo = {
  id: string;
  title: string;
  source_type: string;
  status: string;
  total_bytes: number;
  video_bytes: number;
  thumbnail_bytes: number;
};

export type StorageSummary = {
  total_bytes: number;
  video_bytes: number;
  thumbnail_bytes: number;
  asset_count: number;
  video_count: number;
  by_kind: StorageBreakdown[];
  by_source: StorageBreakdown[];
  videos: StorageVideo[];
};
