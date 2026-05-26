"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, RotateCcw, Search, Trash2, XCircle } from "lucide-react";
import { Shell } from "@/components/shell";
import { Badge, Button, Panel } from "@/components/ui";
import { api, ImportJob } from "@/lib/api";

const ACTIVE_STATUSES = new Set(["pending", "searching", "downloading", "processing", "uploading"]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function workerMetadata(job: ImportJob) {
  return asRecord(asRecord(job.metadata).worker);
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" | "accent" {
  if (status === "completed") return "success";
  if (status === "failed" || status === "cancelled") return "danger";
  if (ACTIVE_STATUSES.has(status)) return "accent";
  return "neutral";
}

export default function ImportsPage() {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("created_desc");

  async function load() {
    setJobs(await api<ImportJob[]>("/imports"));
  }

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const hasActiveJob = jobs.some((job) => ACTIVE_STATUSES.has(job.status));

  useEffect(() => {
    const hasActiveJob = jobs.some((job) => ACTIVE_STATUSES.has(job.status));
    const timer = setInterval(() => load().catch(() => {}), hasActiveJob ? 1500 : 5000);
    return () => clearInterval(timer);
  }, [hasActiveJob]);

  async function cancelJob(id: string) {
    await api(`/imports/${id}/cancel`, { method: "POST" });
    await load();
  }

  async function deleteJob(id: string) {
    await api(`/imports/${id}`, { method: "DELETE" });
    await load();
  }

  async function retryJob(id: string) {
    setBusyJobId(id);
    try {
      await api(`/imports/${id}/retry`, { method: "POST" });
      await load();
    } finally {
      setBusyJobId(null);
    }
  }

  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...jobs]
      .filter((job) => {
        const searchable = [job.source_url, job.query, job.id, job.status, job.error_message].filter(Boolean).join(" ").toLowerCase();
        return (!normalizedQuery || searchable.includes(normalizedQuery))
          && (statusFilter === "all" || job.status === statusFilter);
      })
      .sort((a, b) => {
        if (sort === "progress_desc") return b.progress - a.progress;
        if (sort === "progress_asc") return a.progress - b.progress;
        if (sort === "status_asc") return a.status.localeCompare(b.status);
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [jobs, query, sort, statusFilter]);
  const statuses = Array.from(new Set(jobs.map((job) => job.status))).sort();

  return (
    <Shell>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="page-title">Imports</h1><p className="page-subtitle">YouTube imports are user-supplied content jobs.</p></div>
        <Button asChild className="w-full sm:w-auto"><Link href="/imports/youtube"><Search size={16} /> YouTube import</Link></Button>
      </div>
      <Panel className="p-0">
        <div className="grid gap-3 border-b border-border p-5 md:grid-cols-[minmax(0,1fr)_170px_180px]">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search imports" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter imports">
            <option value="all">All statuses</option>
            {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort imports">
            <option value="created_desc">Newest first</option>
            <option value="status_asc">Status A-Z</option>
            <option value="progress_desc">Progress high-low</option>
            <option value="progress_asc">Progress low-high</option>
          </select>
        </div>
        {filteredJobs.map((job) => (
          <div key={job.id} className="grid gap-3 border-b border-border px-5 py-4 text-sm last:border-b-0 lg:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <div className="truncate font-medium">{job.source_url || job.query || job.id}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-muted">
                <Badge tone={statusTone(job.status)}>{job.status}</Badge>
                <span>{job.progress}% {job.error_message ? `· ${job.error_message}` : ""}</span>
                {job.result_video_id && (
                  <Link className="inline-flex items-center gap-1 text-ink underline-offset-2 hover:underline" href={`/videos/${job.result_video_id}`}>
                    Open video <ExternalLink size={13} />
                  </Link>
                )}
              </div>
              <ImportDiagnostics job={job} />
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
              {["failed", "cancelled"].includes(job.status) && !job.result_video_id && (
                <Button variant="secondary" className="w-full sm:w-auto" onClick={() => retryJob(job.id)} disabled={busyJobId === job.id}>
                  <RotateCcw size={15} /> {busyJobId === job.id ? "Retrying" : "Retry"}
                </Button>
              )}
              {!["completed", "failed", "cancelled"].includes(job.status) && (
                <Button variant="secondary" className="w-full sm:w-auto" onClick={() => cancelJob(job.id)}><XCircle size={15} /> Cancel</Button>
              )}
              {!job.result_video_id && (
                <Button variant="danger" className="w-full sm:w-auto" onClick={() => deleteJob(job.id)}><Trash2 size={15} /> Delete</Button>
              )}
            </div>
          </div>
        ))}
        {filteredJobs.length === 0 && <p className="p-5 text-sm text-muted">No matching imports.</p>}
      </Panel>
    </Shell>
  );
}

function ImportDiagnostics({ job }: { job: ImportJob }) {
  const worker = workerMetadata(job);
  const step = asString(worker.step);
  const detail = asString(worker.detail);
  const command = asString(worker.command);
  const updatedAt = asString(worker.updated_at);
  const files = asRecord(worker.files);
  const storage = asRecord(worker.storage);
  const timings = asRecord(worker.timings);
  const output = Array.isArray(worker.last_output) ? worker.last_output.filter((line): line is string => typeof line === "string") : [];
  const hasDetails = step || detail || command || Object.keys(files).length > 0 || output.length > 0;

  return (
    <div className="mt-3 space-y-2">
      <div className="h-2 overflow-hidden rounded-full bg-ink/10">
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} />
      </div>
      {hasDetails && (
        <div className="soft-section p-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {step && <span className="font-medium text-ink">{step}</span>}
            {detail && <span className="text-muted">{detail}</span>}
            {typeof timings.elapsed_seconds === "number" && <span className="text-muted">{timings.elapsed_seconds}s elapsed</span>}
            {updatedAt && <span className="text-muted">updated {new Date(updatedAt).toLocaleTimeString()}</span>}
          </div>
          {Object.keys(files).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
              {Object.entries(files).map(([key, value]) => (
                <span key={key} className="rounded-full border border-border bg-panel px-2 py-1">{key.replaceAll("_", " ")}: {String(value)}</span>
              ))}
            </div>
          )}
          {Object.keys(storage).length > 0 && (
            <div className="mt-2 grid gap-1 text-xs text-muted">
              {Object.entries(storage).map(([key, value]) => (
                <div key={key} className="truncate rounded-ui border border-border bg-panel px-2 py-1">{key.replaceAll("_", " ")}: {String(value)}</div>
              ))}
            </div>
          )}
          {command && <pre className="mt-2 overflow-x-auto rounded-ui bg-ink p-2 text-xs text-panel">{command}</pre>}
          {output.length > 0 && (
            <pre className="mt-2 max-h-40 overflow-auto rounded-ui bg-ink p-2 text-xs leading-relaxed text-panel">
              {output.join("\n")}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
