"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Save } from "lucide-react";
import { Shell } from "@/components/shell";
import { Button, Field, Panel } from "@/components/ui";
import { api, ChildProfile } from "@/lib/api";

export default function ChildrenPage() {
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [name, setName] = useState("");
  const [quotaByChild, setQuotaByChild] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [quotaFilter, setQuotaFilter] = useState("all");
  const [sort, setSort] = useState("name_asc");

  async function load() {
    const nextChildren = await api<ChildProfile[]>("/children");
    setChildren(nextChildren);
    setQuotaByChild(Object.fromEntries(nextChildren.map((child) => [child.id, String(child.storage_quota_mb)])));
  }

  useEffect(() => { load().catch(() => {}); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    await api("/children", { method: "POST", body: JSON.stringify({ name, avatar_color: "oklch(72% 0.12 170)", storage_quota_mb: 8192 }) });
    setName("");
    await load();
  }

  async function saveQuota(child: ChildProfile) {
    const quota = Number(quotaByChild[child.id]);
    if (!Number.isFinite(quota) || quota < 256) {
      setMessage("Quota must be at least 256 MB.");
      return;
    }

    setSavingId(child.id);
    setMessage("");
    try {
      await api(`/children/${child.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: child.name,
          avatar_color: child.avatar_color,
          birth_year: child.birth_year,
          storage_quota_mb: Math.round(quota),
        }),
      });
      setMessage(`${child.name}'s quota saved.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quota save failed");
    } finally {
      setSavingId("");
    }
  }

  const filteredChildren = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return [...children]
      .filter((child) => {
        const quota = Number(quotaByChild[child.id] ?? child.storage_quota_mb);
        return (!normalizedQuery || child.name.toLowerCase().includes(normalizedQuery))
          && (quotaFilter === "all" || (quotaFilter === "low" ? quota < 4096 : quota >= 4096));
      })
      .sort((a, b) => {
        if (sort === "quota_desc") return Number(quotaByChild[b.id] ?? b.storage_quota_mb) - Number(quotaByChild[a.id] ?? a.storage_quota_mb);
        if (sort === "quota_asc") return Number(quotaByChild[a.id] ?? a.storage_quota_mb) - Number(quotaByChild[b.id] ?? b.storage_quota_mb);
        if (sort === "created_desc") return b.id.localeCompare(a.id);
        return a.name.localeCompare(b.name);
      });
  }, [children, query, quotaByChild, quotaFilter, sort]);

  return (
    <Shell>
      <h1 className="page-title">Child profiles</h1>
      <p className="page-subtitle mb-6">Create H, E, or other private library profiles.</p>
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Panel>
          <form onSubmit={create} className="grid gap-4">
            <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="H" required /></Field>
            <Button>Create profile</Button>
          </form>
        </Panel>
        <Panel className="p-0">
          <div className="grid gap-3 border-b border-border p-5 md:grid-cols-[minmax(0,1fr)_160px_170px]">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search profiles" />
            <select value={quotaFilter} onChange={(e) => setQuotaFilter(e.target.value)} aria-label="Filter profiles">
              <option value="all">All quotas</option>
              <option value="low">Under 4 GB</option>
              <option value="standard">4 GB and up</option>
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort profiles">
              <option value="name_asc">Name A-Z</option>
              <option value="quota_desc">Quota high-low</option>
              <option value="quota_asc">Quota low-high</option>
            </select>
          </div>
          {filteredChildren.map((child) => (
            <div key={child.id} className="grid gap-3 border-b border-border px-5 py-4 last:border-b-0 md:grid-cols-[1fr_220px_auto] md:items-center">
              <Link href={`/children/${child.id}`} className="min-w-0 hover:underline">
                <div className="font-medium">{child.name}</div>
                <div className="text-sm text-muted">Open assigned library</div>
              </Link>
              <Field label="iPad quota, MB">
                <input
                  type="number"
                  min={256}
                  step={256}
                  value={quotaByChild[child.id] ?? child.storage_quota_mb}
                  onChange={(event) => setQuotaByChild((values) => ({ ...values, [child.id]: event.target.value }))}
                />
              </Field>
              <Button variant="secondary" className="w-full md:w-auto" onClick={() => saveQuota(child)} disabled={savingId === child.id}>
                <Save size={15} /> {savingId === child.id ? "Saving..." : "Save"}
              </Button>
            </div>
          ))}
          {filteredChildren.length === 0 && <p className="p-5 text-sm text-muted">No matching child profiles.</p>}
        </Panel>
      </div>
      {message && <p className="mt-4 text-sm text-muted">{message}</p>}
    </Shell>
  );
}
