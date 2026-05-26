"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { Button, Panel } from "@/components/ui";
import { api, ChildProfile, ImportJob, StorageSummary, Video } from "@/lib/api";

function formatBytes(bytes?: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export default function DashboardPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [storage, setStorage] = useState<StorageSummary | null>(null);
  const [storageQuery, setStorageQuery] = useState("");
  const [storageSort, setStorageSort] = useState("size_desc");
  const [importQuery, setImportQuery] = useState("");
  const [importStatusFilter, setImportStatusFilter] = useState("all");
  const [importSort, setImportSort] = useState("created_desc");
  useEffect(() => {
    api<Video[]>("/videos").then(setVideos).catch(() => {});
    api<ChildProfile[]>("/children").then(setChildren).catch(() => {});
    api<ImportJob[]>("/imports").then(setImports).catch(() => {});
    api<StorageSummary>("/storage/summary").then(setStorage).catch(() => {});
  }, []);
  const storedVideos = useMemo(() => {
    const normalizedQuery = storageQuery.trim().toLowerCase();
    return [...(storage?.videos || [])]
      .filter((video) => !normalizedQuery || [video.title, video.source_type, video.status].join(" ").toLowerCase().includes(normalizedQuery))
      .sort((a, b) => {
        if (storageSort === "title_asc") return a.title.localeCompare(b.title);
        if (storageSort === "size_asc") return a.total_bytes - b.total_bytes;
        return b.total_bytes - a.total_bytes;
      });
  }, [storage?.videos, storageQuery, storageSort]);
  const filteredImports = useMemo(() => {
    const normalizedQuery = importQuery.trim().toLowerCase();
    return [...imports]
      .filter((job) => {
        const searchable = [job.source_url, job.query, job.id, job.status].filter(Boolean).join(" ").toLowerCase();
        return (!normalizedQuery || searchable.includes(normalizedQuery))
          && (importStatusFilter === "all" || job.status === importStatusFilter);
      })
      .sort((a, b) => {
        if (importSort === "progress_desc") return b.progress - a.progress;
        if (importSort === "status_asc") return a.status.localeCompare(b.status);
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [importQuery, importSort, importStatusFilter, imports]);
  const importStatuses = Array.from(new Set(imports.map((job) => job.status))).sort();
  return (
    <Shell>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Review library health and recent import activity.</p>
        </div>
        <Button asChild className="w-full sm:w-auto"><Link href="/videos/new">Upload video</Link></Button>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Panel><div className="text-sm font-medium text-muted">Videos</div><div className="mt-2 text-3xl font-semibold tracking-tight">{videos.length}</div></Panel>
        <Panel><div className="text-sm font-medium text-muted">Child profiles</div><div className="mt-2 text-3xl font-semibold tracking-tight">{children.length}</div></Panel>
        <Panel><div className="text-sm font-medium text-muted">Active imports</div><div className="mt-2 text-3xl font-semibold tracking-tight">{imports.filter((i) => !["completed", "failed", "cancelled"].includes(i.status)).length}</div></Panel>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <Panel>
          <div className="text-sm text-muted">R2 stored assets</div>
          <div className="mt-2 text-3xl font-semibold">{formatBytes(storage?.total_bytes)}</div>
          <div className="mt-3 grid gap-2 text-sm text-muted">
            <div className="flex justify-between"><span>Video files</span><span className="font-medium text-ink">{formatBytes(storage?.video_bytes)}</span></div>
            <div className="flex justify-between"><span>Thumbnails</span><span className="font-medium text-ink">{formatBytes(storage?.thumbnail_bytes)}</span></div>
            <div className="flex justify-between"><span>Objects tracked</span><span className="font-medium text-ink">{storage?.asset_count || 0}</span></div>
          </div>
        </Panel>
        <Panel>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-semibold">Stored videos</h2>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
              <input value={storageQuery} onChange={(e) => setStorageQuery(e.target.value)} placeholder="Search storage" />
              <select value={storageSort} onChange={(e) => setStorageSort(e.target.value)} aria-label="Sort stored videos">
                <option value="size_desc">Largest first</option>
                <option value="size_asc">Smallest first</option>
                <option value="title_asc">Title A-Z</option>
              </select>
            </div>
          </div>
          <div className="grid gap-2">
            {storedVideos.slice(0, 5).map((video) => (
              <div key={video.id} className="grid grid-cols-[1fr_auto] gap-4 border-t border-border py-2 text-sm">
                <span className="min-w-0 truncate">{video.title}</span>
                <span className="text-muted">{formatBytes(video.total_bytes)}</span>
              </div>
            ))}
            {storedVideos.length === 0 && <p className="text-sm text-muted">No matching stored videos.</p>}
          </div>
        </Panel>
      </div>
      <Panel className="mt-6">
        <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-base font-semibold">Imports</h2>
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_160px_170px] lg:w-[620px]">
            <input value={importQuery} onChange={(e) => setImportQuery(e.target.value)} placeholder="Search imports" />
            <select value={importStatusFilter} onChange={(e) => setImportStatusFilter(e.target.value)} aria-label="Filter imports">
              <option value="all">All statuses</option>
              {importStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <select value={importSort} onChange={(e) => setImportSort(e.target.value)} aria-label="Sort imports">
              <option value="created_desc">Newest first</option>
              <option value="status_asc">Status A-Z</option>
              <option value="progress_desc">Progress high-low</option>
            </select>
          </div>
        </div>
        <div className="grid gap-2">
          {filteredImports.slice(0, 6).map((job) => <div key={job.id} className="grid gap-1 border-t border-border py-2 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><span className="min-w-0 truncate">{job.source_url || job.query || job.id}</span><span className="text-muted">{job.status} · {job.progress}%</span></div>)}
          {filteredImports.length === 0 && <p className="text-sm text-muted">No matching imports.</p>}
        </div>
      </Panel>
    </Shell>
  );
}
