"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, CheckCircle2, Circle, Grid2X2, ImageIcon, List, Plus } from "lucide-react";
import { Shell } from "@/components/shell";
import { Badge, Button, ChildChip, Panel } from "@/components/ui";
import { api, ChildProfile, Video } from "@/lib/api";

function formatBytes(bytes?: number) {
  if (!bytes) return "No size";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export default function VideosPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [approvalFilter, setApprovalFilter] = useState("all");
  const [childFilter, setChildFilter] = useState("all");
  const [sort, setSort] = useState("created_desc");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkChildId, setBulkChildId] = useState("");
  const [bulkMessage, setBulkMessage] = useState("");

  useEffect(() => {
    api<Video[]>("/videos").then(setVideos).catch(() => {});
    api<ChildProfile[]>("/children").then(setChildren).catch(() => {});
  }, []);

  const childColors = useMemo(() => new Map(children.map((child) => [child.id, child.avatar_color])), [children]);
  const filteredVideos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...videos]
      .filter((video) => {
        const searchable = [video.title, video.description, video.category_name, video.source_type, video.status].filter(Boolean).join(" ").toLowerCase();
        return (!normalizedQuery || searchable.includes(normalizedQuery))
          && (statusFilter === "all" || video.status === statusFilter)
          && (sourceFilter === "all" || video.source_type === sourceFilter)
          && (approvalFilter === "all" || (approvalFilter === "approved" ? video.approved : !video.approved))
          && (childFilter === "all"
            || (childFilter === "unassigned"
              ? (video.assignments || []).length === 0
              : (video.assignments || []).some((a) => a.child_profile_id === childFilter)));
      })
      .sort((a, b) => {
        if (sort === "title_asc") return a.title.localeCompare(b.title);
        if (sort === "title_desc") return b.title.localeCompare(a.title);
        if (sort === "size_desc") return (b.storage_bytes || b.file_size_bytes || 0) - (a.storage_bytes || a.file_size_bytes || 0);
        if (sort === "size_asc") return (a.storage_bytes || a.file_size_bytes || 0) - (b.storage_bytes || b.file_size_bytes || 0);
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [approvalFilter, childFilter, query, sort, sourceFilter, statusFilter, videos]);

  const statuses = Array.from(new Set(videos.map((video) => video.status))).sort();
  const sources = Array.from(new Set(videos.map((video) => video.source_type))).sort();

  const allFilteredSelected = filteredVideos.length > 0 && filteredVideos.every((v) => selected.has(v.id));
  const selectedCount = selected.size;
  const selectedVideos = videos.filter((v) => selected.has(v.id));
  const selectedUnapprovedCount = selectedVideos.filter((v) => !v.approved).length;
  const selectedApprovedCount = selectedVideos.filter((v) => v.approved).length;

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredVideos.map((v) => v.id)));
    }
  }

  function cancelSelect() {
    setSelecting(false);
    setSelected(new Set());
    setBulkMessage("");
  }

  async function reloadVideos() {
    const updated = await api<Video[]>("/videos");
    setVideos(updated);
  }

  async function bulkApprove(approve: boolean) {
    setBulkWorking(true);
    setBulkMessage("");
    try {
      const targets = videos.filter((v) => selected.has(v.id));
      await Promise.all(targets.map((v) => api<Video>(`/videos/${v.id}`, { method: "PUT", body: JSON.stringify({ ...v, approved: approve }) })));
      await reloadVideos();
      setBulkMessage(`${targets.length} video${targets.length !== 1 ? "s" : ""} ${approve ? "approved" : "moved to draft"}.`);
      setSelected(new Set());
    } catch {
      setBulkMessage("Bulk update failed.");
    } finally {
      setBulkWorking(false);
    }
  }

  async function bulkAssign() {
    if (!bulkChildId || selectedCount === 0) return;
    setBulkWorking(true);
    setBulkMessage("");
    try {
      await Promise.all([...selected].map((id) =>
        api(`/videos/${id}/assign`, { method: "POST", body: JSON.stringify({ child_profile_id: bulkChildId, download_priority: "normal" }) })
      ));
      await reloadVideos();
      const childName = children.find((c) => c.id === bulkChildId)?.name ?? "child";
      setBulkMessage(`${selectedCount} video${selectedCount !== 1 ? "s" : ""} assigned to ${childName}.`);
      setSelected(new Set());
      setBulkChildId("");
    } catch {
      setBulkMessage("Bulk assign failed.");
    } finally {
      setBulkWorking(false);
    }
  }

  function CardWrapper({ video, children: inner }: { video: Video; children: React.ReactNode }) {
    const isSelected = selected.has(video.id);
    const cls = `group overflow-hidden rounded-ui border bg-panel shadow-[0_1px_2px_oklch(24%_0.026_82_/_0.05)] transition ${
      selecting
        ? `cursor-pointer ${isSelected ? "border-accent/60 ring-2 ring-accent/30" : "border-border hover:border-accent/35"}`
        : "border-border hover:border-accent/35 hover:shadow-[0_10px_26px_oklch(65%_0.03_82_/_0.14)]"
    }`;
    if (selecting) {
      return <div className={cls} onClick={() => toggleSelect(video.id)}>{inner}</div>;
    }
    return <Link href={`/videos/${video.id}`} className={cls}>{inner}</Link>;
  }

  function RowWrapper({ video, children: inner }: { video: Video; children: React.ReactNode }) {
    const isSelected = selected.has(video.id);
    const cls = `grid gap-3 border-b border-border px-4 py-3 text-sm last:border-b-0 sm:grid-cols-[72px_minmax(0,1fr)_auto] sm:items-center lg:grid-cols-[72px_minmax(0,1fr)_auto_auto_auto] lg:px-5 ${
      selecting
        ? `cursor-pointer ${isSelected ? "bg-accent/5" : "hover:bg-ink/5"}`
        : "hover:bg-ink/5"
    }`;
    if (selecting) {
      return <div className={cls} onClick={() => toggleSelect(video.id)}>{inner}</div>;
    }
    return <Link href={`/videos/${video.id}`} className={cls}>{inner}</Link>;
  }

  return (
    <Shell>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="page-title">Videos</h1><p className="page-subtitle">Uploaded and imported private family media.</p></div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="grid grid-cols-2 gap-1 rounded-ui border border-border bg-ink/[0.03] p-1 sm:w-auto">
            <button type="button" onClick={() => setView("grid")} className={`inline-flex h-8 items-center justify-center gap-1 rounded-ui px-2 text-sm font-medium transition ${view === "grid" ? "bg-panel text-ink shadow-[0_1px_2px_oklch(24%_0.026_82_/_0.08)]" : "text-muted hover:bg-panel/70 hover:text-ink"}`}><Grid2X2 size={15} /> Grid</button>
            <button type="button" onClick={() => setView("list")} className={`inline-flex h-8 items-center justify-center gap-1 rounded-ui px-2 text-sm font-medium transition ${view === "list" ? "bg-panel text-ink shadow-[0_1px_2px_oklch(24%_0.026_82_/_0.08)]" : "text-muted hover:bg-panel/70 hover:text-ink"}`}><List size={15} /> List</button>
          </div>
          {selecting
            ? <Button variant="secondary" onClick={cancelSelect} className="w-full sm:w-auto">Cancel</Button>
            : <Button variant="secondary" onClick={() => setSelecting(true)} className="w-full sm:w-auto">Select</Button>
          }
          <Button asChild className="w-full sm:w-auto"><Link href="/videos/new"><Plus size={16} /> New</Link></Button>
        </div>
      </div>

      {selecting && (
        <div className="mb-4 rounded-ui border border-accent/25 bg-accent/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium select-none">
              <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} />
              {allFilteredSelected ? "Deselect all" : "Select all"}
            </label>
            <span className="text-sm text-muted">{selectedCount} selected</span>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              {selectedUnapprovedCount > 0 && (
                <Button disabled={bulkWorking} onClick={() => bulkApprove(true)} className="h-8 px-3 text-sm">
                  <CheckCircle2 size={14} /> Approve {selectedUnapprovedCount}
                </Button>
              )}
              {selectedApprovedCount > 0 && (
                <Button variant="secondary" disabled={bulkWorking} onClick={() => bulkApprove(false)} className="h-8 px-3 text-sm">
                  <Circle size={14} /> Unapprove {selectedApprovedCount}
                </Button>
              )}
              {children.length > 0 && selectedCount > 0 && (
                <div className="flex items-center gap-2">
                  <select value={bulkChildId} onChange={(e) => setBulkChildId(e.target.value)} className="h-8 text-sm" aria-label="Select child to assign">
                    <option value="">Assign to...</option>
                    {children.map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}
                  </select>
                  <Button disabled={bulkWorking || !bulkChildId} onClick={bulkAssign} className="h-8 px-3 text-sm">
                    Assign {selectedCount}
                  </Button>
                </div>
              )}
            </div>
          </div>
          {bulkMessage && <p className="mt-2 text-sm text-muted">{bulkMessage}</p>}
        </div>
      )}

      <Panel className="mb-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_150px_140px_140px_150px_170px]">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search videos" />
          <select value={childFilter} onChange={(e) => setChildFilter(e.target.value)} aria-label="Filter by child">
            <option value="all">All children</option>
            {children.map((child) => <option key={child.id} value={child.id}>Assigned to {child.name}</option>)}
            <option value="unassigned">Not assigned</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
            <option value="all">All statuses</option>
            {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} aria-label="Filter by source">
            <option value="all">All sources</option>
            {sources.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
          <select value={approvalFilter} onChange={(e) => setApprovalFilter(e.target.value)} aria-label="Filter by approval">
            <option value="all">All approvals</option>
            <option value="approved">Approved</option>
            <option value="draft">Draft</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort videos">
            <option value="created_desc">Newest first</option>
            <option value="title_asc">Title A-Z</option>
            <option value="title_desc">Title Z-A</option>
            <option value="size_desc">Largest first</option>
            <option value="size_asc">Smallest first</option>
          </select>
        </div>
      </Panel>

      {view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredVideos.map((video) => {
            const isSelected = selected.has(video.id);
            return (
              <CardWrapper key={video.id} video={video}>
                <div className="relative aspect-video bg-ink/[0.07]">
                  {video.thumbnail_url ? <img src={video.thumbnail_url} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center"><ImageIcon size={24} className="text-muted" /></div>}
                  {selecting && (
                    <div className="absolute inset-0 flex items-start justify-end p-2">
                      <div className={`grid size-6 place-items-center rounded-full border-2 transition ${isSelected ? "border-accent bg-accent text-white" : "border-white/80 bg-black/20"}`}>
                        {isSelected && <Check size={13} strokeWidth={3} />}
                      </div>
                    </div>
                  )}
                </div>
                <div className="grid gap-3 p-4">
                  <div className="min-w-0">
                    <div className="truncate font-medium group-hover:underline">{video.title}</div>
                    <div className="mt-1 text-sm text-muted">{video.source_type} · {formatBytes(video.storage_bytes || video.file_size_bytes)}</div>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-muted">{video.category_name || "Uncategorized"}</span>
                    <Badge tone={video.approved ? "success" : "neutral"} className="shrink-0">
                      {video.approved ? <CheckCircle2 className="text-accent" size={16} /> : <Circle size={16} />}
                      {video.approved ? "Approved" : "Draft"}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(video.assignments || []).map((assignment) => (
                      <ChildChip key={assignment.child_profile_id} name={assignment.child_name} color={childColors.get(assignment.child_profile_id)} />
                    ))}
                    {(video.assignments || []).length === 0 && <span className="text-xs text-muted">Not assigned to anyone yet</span>}
                  </div>
                </div>
              </CardWrapper>
            );
          })}
          {filteredVideos.length === 0 && <Panel><p className="text-sm text-muted">No matching videos.</p></Panel>}
        </div>
      ) : (
        <Panel className="p-0">
          {filteredVideos.map((video) => {
            const isSelected = selected.has(video.id);
            return (
              <RowWrapper key={video.id} video={video}>
                <div className="relative flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded-ui bg-ink/[0.07]">
                  {video.thumbnail_url ? <img src={video.thumbnail_url} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={18} className="text-muted" />}
                  {selecting && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <div className={`grid size-5 place-items-center rounded-full border-2 transition ${isSelected ? "border-accent bg-accent text-white" : "border-white/80"}`}>
                        {isSelected && <Check size={11} strokeWidth={3} />}
                      </div>
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="truncate font-medium">{video.title}</div>
                  <div className="text-muted">{video.source_type} · {video.status}</div>
                  {(video.assignments || []).length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {(video.assignments || []).map((assignment) => (
                        <ChildChip key={assignment.child_profile_id} name={assignment.child_name} color={childColors.get(assignment.child_profile_id)} />
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-muted">{formatBytes(video.storage_bytes || video.file_size_bytes)}</span>
                <span className="text-muted sm:col-start-2 lg:col-start-auto">{video.category_name || "Uncategorized"}</span>
                <span className="inline-flex items-center gap-1 text-muted sm:justify-self-end">
                  {video.approved ? <CheckCircle2 className="text-accent" size={18} /> : <Circle size={18} />}
                  <span className="lg:hidden">{video.approved ? "Approved" : "Draft"}</span>
                </span>
              </RowWrapper>
            );
          })}
          {filteredVideos.length === 0 && <p className="p-5 text-sm text-muted">No matching videos.</p>}
        </Panel>
      )}
    </Shell>
  );
}
