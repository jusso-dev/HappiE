"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, ImageIcon, Save } from "lucide-react";
import { Shell } from "@/components/shell";
import { Button, Field, Panel } from "@/components/ui";
import { api, ChildProfile, Video } from "@/lib/api";

export default function ChildDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [videos, setVideos] = useState<Video[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [quota, setQuota] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [assignFilter, setAssignFilter] = useState("assigned");
  const [sort, setSort] = useState("created_desc");

  async function load() {
    const [children, allVideos, library] = await Promise.all([
      api<ChildProfile[]>("/children"),
      api<Video[]>("/videos"),
      api<Video[]>(`/children/${id}/library`),
    ]);
    const child = children.find((item) => item.id === id) || null;
    setProfile(child);
    setQuota(child ? String(child.storage_quota_mb) : "");
    setVideos(allVideos.filter((video) => video.status !== "archived"));
    setAssignedIds(new Set(library.map((video) => video.id)));
    setSelected(new Set());
  }

  useEffect(() => { load().catch(() => {}); }, [id]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    const nextQuota = Number(quota);
    if (!Number.isFinite(nextQuota) || nextQuota < 256) {
      setMessage("Quota must be at least 256 MB.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      await api(`/children/${profile.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: profile.name,
          avatar_color: profile.avatar_color,
          birth_year: profile.birth_year,
          storage_quota_mb: Math.round(nextQuota),
        }),
      });
      setMessage("Profile saved.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Profile save failed");
    } finally {
      setSaving(false);
    }
  }

  function toggle(videoId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(videoId)) next.delete(videoId); else next.add(videoId);
      return next;
    });
  }

  async function bulkAssign() {
    if (!profile || selected.size === 0) return;
    setBusy(true);
    setMessage("");
    try {
      await Promise.all([...selected].map((videoId) =>
        api(`/videos/${videoId}/assign`, {
          method: "POST",
          body: JSON.stringify({ child_profile_id: profile.id }),
        })));
      setMessage(`Assigned ${selected.size} video(s) to ${profile.name}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  async function bulkUnassign() {
    if (!profile || selected.size === 0) return;
    setBusy(true);
    setMessage("");
    try {
      await Promise.all([...selected].map((videoId) =>
        api(`/videos/${videoId}/assign/${profile.id}`, { method: "DELETE" })));
      setMessage(`Unassigned ${selected.size} video(s) from ${profile.name}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unassign failed");
    } finally {
      setBusy(false);
    }
  }

  const filteredVideos = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...videos]
      .filter((video) => {
        const searchable = [video.title, video.description, video.status, video.source_type].filter(Boolean).join(" ").toLowerCase();
        const isAssigned = assignedIds.has(video.id);
        return (!normalizedQuery || searchable.includes(normalizedQuery))
          && (assignFilter === "all" || (assignFilter === "assigned" ? isAssigned : !isAssigned));
      })
      .sort((a, b) => {
        if (sort === "created_asc") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        if (sort === "title_asc") return a.title.localeCompare(b.title);
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
  }, [videos, assignedIds, query, assignFilter, sort]);

  function toggleAllVisible() {
    setSelected((current) => {
      const visibleIds = filteredVideos.map((video) => video.id);
      const allSelected = visibleIds.every((videoId) => current.has(videoId));
      const next = new Set(current);
      for (const videoId of visibleIds) {
        if (allSelected) next.delete(videoId); else next.add(videoId);
      }
      return next;
    });
  }

  const allVisibleSelected = filteredVideos.length > 0 && filteredVideos.every((video) => selected.has(video.id));

  return (
    <Shell>
      <h1 className="page-title">{profile?.name || "Child profile"}</h1>
      <p className="page-subtitle mb-6">Edit the iPad quota and manage which approved videos this child can watch.</p>
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Panel>
          <form onSubmit={saveProfile} className="grid gap-4">
            <Field label="Name"><input value={profile?.name || ""} disabled /></Field>
            <Field label="iPad quota, MB"><input type="number" min={256} step={256} value={quota} onChange={(event) => setQuota(event.target.value)} /></Field>
            <Button disabled={!profile || saving}><Save size={16} /> {saving ? "Saving..." : "Save quota"}</Button>
            {message && <p className="text-sm text-muted">{message}</p>}
          </form>
        </Panel>
        <Panel className="p-0">
          <div className="grid gap-3 border-b border-border p-5 md:grid-cols-[minmax(0,1fr)_160px_170px]">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search videos" />
            <select value={assignFilter} onChange={(e) => setAssignFilter(e.target.value)} aria-label="Filter videos">
              <option value="assigned">Assigned to {profile?.name || "child"}</option>
              <option value="unassigned">Not assigned</option>
              <option value="all">All videos</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort videos">
              <option value="created_desc">Newest first</option>
              <option value="created_asc">Oldest first</option>
              <option value="title_asc">Title A-Z</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} /> Select all
            </label>
            <span className="text-sm text-muted">{selected.size} selected</span>
            <div className="ml-auto flex gap-2">
              <Button onClick={bulkAssign} disabled={busy || selected.size === 0}>Assign selected</Button>
              <Button variant="secondary" onClick={bulkUnassign} disabled={busy || selected.size === 0}>Unassign selected</Button>
            </div>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {filteredVideos.map((video) => {
              const isAssigned = assignedIds.has(video.id);
              const isSelected = selected.has(video.id);
              return (
                <button
                  type="button"
                  key={video.id}
                  onClick={() => toggle(video.id)}
                  className={`group overflow-hidden rounded-ui border text-left transition ${isSelected ? "border-accent ring-2 ring-accent/40" : "border-border hover:border-accent/50"}`}
                >
                  <div className="relative aspect-video bg-muted/10">
                    {video.thumbnail_url
                      ? <img src={video.thumbnail_url} alt="" className="h-full w-full object-cover" />
                      : <div className="flex h-full items-center justify-center"><ImageIcon size={24} className="text-muted" /></div>}
                    <span className="absolute left-2 top-2 grid size-5 place-items-center rounded border border-border bg-panel">
                      {isSelected && <CheckCircle2 size={16} className="text-accent" />}
                    </span>
                    {isAssigned && <span className="absolute right-2 top-2 rounded bg-accent px-2 py-0.5 text-xs font-medium text-panel">Assigned</span>}
                  </div>
                  <div className="p-3">
                    <div className="truncate font-medium">{video.title}</div>
                    <div className="text-sm text-muted">{video.status}{video.approved ? "" : " · not approved"}</div>
                  </div>
                </button>
              );
            })}
          </div>
          {filteredVideos.length === 0 && (
            <p className="p-5 text-sm text-muted">
              {assignFilter === "assigned"
                ? "No videos assigned yet. Switch to “Not assigned” to add some."
                : "No matching videos."}
            </p>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
