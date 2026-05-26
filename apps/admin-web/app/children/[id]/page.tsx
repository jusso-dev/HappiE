"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Save } from "lucide-react";
import { Shell } from "@/components/shell";
import { Button, Field, Panel } from "@/components/ui";
import { api, ChildProfile, Video } from "@/lib/api";

export default function ChildDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [library, setLibrary] = useState<Video[]>([]);
  const [profile, setProfile] = useState<ChildProfile | null>(null);
  const [quota, setQuota] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("title_asc");

  async function load() {
    const [children, childLibrary] = await Promise.all([
      api<ChildProfile[]>("/children"),
      api<Video[]>(`/children/${id}/library`),
    ]);
    const child = children.find((item) => item.id === id) || null;
    setProfile(child);
    setQuota(child ? String(child.storage_quota_mb) : "");
    setLibrary(childLibrary);
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

  const filteredLibrary = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...library]
      .filter((video) => {
        const searchable = [video.title, video.description, video.status, video.source_type].filter(Boolean).join(" ").toLowerCase();
        return (!normalizedQuery || searchable.includes(normalizedQuery))
          && (statusFilter === "all" || video.status === statusFilter);
      })
      .sort((a, b) => {
        if (sort === "created_desc") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (sort === "status_asc") return a.status.localeCompare(b.status);
        return a.title.localeCompare(b.title);
      });
  }, [library, query, sort, statusFilter]);
  const statuses = Array.from(new Set(library.map((video) => video.status))).sort();

  return (
    <Shell>
      <h1 className="page-title">{profile?.name || "Child profile"}</h1>
      <p className="page-subtitle mb-6">Edit the iPad quota and review this child's approved library.</p>
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
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search library" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter library">
              <option value="all">All statuses</option>
              {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort library">
              <option value="title_asc">Title A-Z</option>
              <option value="created_desc">Newest first</option>
              <option value="status_asc">Status A-Z</option>
            </select>
          </div>
          {filteredLibrary.map((video) => <div key={video.id} className="border-b border-border px-5 py-3 last:border-b-0"><div className="break-words font-medium">{video.title}</div><div className="text-sm text-muted">{video.status}</div></div>)}
          {filteredLibrary.length === 0 && <p className="p-5 text-sm text-muted">No matching assigned videos.</p>}
        </Panel>
      </div>
    </Shell>
  );
}
