"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Link as LinkIcon, ListVideo, Search } from "lucide-react";
import { Shell } from "@/components/shell";
import { Button, Field, Panel } from "@/components/ui";
import { api, ChildProfile } from "@/lib/api";

export default function YoutubeImportPage() {
  const router = useRouter();
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [url, setUrl] = useState("");
  const [importKind, setImportKind] = useState<"video" | "playlist">("video");
  const [title, setTitle] = useState("");
  const [childProfileIds, setChildProfileIds] = useState<string[]>([]);
  const [downloadPriority, setDownloadPriority] = useState("normal");
  const [query, setQuery] = useState("");
  const [searchLimit, setSearchLimit] = useState("10");
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [childQuery, setChildQuery] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [childSort, setChildSort] = useState("name_asc");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const trimmedUrl = url.trim();
  const parsedSearchLimit = Number.parseInt(searchLimit, 10);
  const searchLimitValid = Number.isFinite(parsedSearchLimit) && parsedSearchLimit >= 1 && parsedSearchLimit <= 50;

  useEffect(() => {
    api<ChildProfile[]>("/children").then(setChildren).catch(() => setChildren([]));
  }, []);

  async function importUrl(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await api("/imports/youtube/url", {
        method: "POST",
        body: JSON.stringify({
          url: trimmedUrl,
          title: importKind === "video" ? title.trim() || undefined : undefined,
          child_profile_ids: childProfileIds,
          approve: childProfileIds.length > 0,
          download_priority: downloadPriority,
          import_kind: importKind,
        }),
      });
      router.push("/imports");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Import failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setSearchError("");
    setIsSearching(true);
    try {
      await api("/imports/youtube/search", {
        method: "POST",
        body: JSON.stringify({
          query: query.trim(),
          limit: parsedSearchLimit,
          child_profile_ids: childProfileIds,
          approve: childProfileIds.length > 0,
          download_priority: downloadPriority,
        }),
      });
      router.push("/imports");
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Search failed");
    } finally {
      setIsSearching(false);
    }
  }

  function toggleChild(childId: string) {
    setChildProfileIds((ids) => ids.includes(childId) ? ids.filter((id) => id !== childId) : [...ids, childId]);
  }

  const filteredChildren = useMemo(() => {
    const normalizedQuery = childQuery.trim().toLowerCase();
    return [...children]
      .filter((child) => {
        const selected = childProfileIds.includes(child.id);
        return (!normalizedQuery || child.name.toLowerCase().includes(normalizedQuery))
          && (assignmentFilter === "all" || (assignmentFilter === "selected" ? selected : !selected));
      })
      .sort((a, b) => {
        if (childSort === "selected_first") return Number(childProfileIds.includes(b.id)) - Number(childProfileIds.includes(a.id)) || a.name.localeCompare(b.name);
        return a.name.localeCompare(b.name);
      });
  }, [assignmentFilter, childProfileIds, childQuery, childSort, children]);

  return (
    <Shell>
      <h1 className="page-title">YouTube import</h1>
      <p className="page-subtitle mb-6">Import one video, a whole playlist, or search YouTube and bulk-import the results you don&apos;t already have.</p>
      <div className="mb-6 flex gap-3 rounded-ui border border-warn/35 bg-warn/10 p-4 text-sm text-ink">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <p>You are responsible for having the right to download, store, and import content, and for complying with platform terms and copyright law. HappiE is a private family media library, not a public video sharing service.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <form onSubmit={importUrl} className="grid gap-4">
            <div className="grid gap-2">
              <label>Import type</label>
              <div className="grid gap-2 rounded-ui border border-border bg-ink/[0.03] p-1 sm:grid-cols-2">
                <button type="button" onClick={() => setImportKind("video")} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-ui px-2 text-sm font-medium transition ${importKind === "video" ? "bg-panel text-ink shadow-[0_1px_2px_oklch(24%_0.026_82_/_0.08)]" : "text-muted hover:bg-panel/70 hover:text-ink"}`}>
                  <LinkIcon size={16} /> Single video
                </button>
                <button type="button" onClick={() => setImportKind("playlist")} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-ui px-2 text-sm font-medium transition ${importKind === "playlist" ? "bg-panel text-ink shadow-[0_1px_2px_oklch(24%_0.026_82_/_0.08)]" : "text-muted hover:bg-panel/70 hover:text-ink"}`}>
                  <ListVideo size={16} /> Playlist
                </button>
              </div>
            </div>
            <Field label={importKind === "playlist" ? "Paste YouTube playlist URL" : "Paste YouTube video URL"}>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={importKind === "playlist" ? "https://www.youtube.com/playlist?list=..." : "https://www.youtube.com/watch?v=..."} required />
            </Field>
            {importKind === "video" && <Field label="Title override"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" /></Field>}
            {importKind === "playlist" && (
              <div className="soft-section p-3 text-sm text-muted">
                The playlist job will read the playlist, create one import job per video, then each video will download, process, upload to R2, and inherit these child assignments.
              </div>
            )}
            <div className="grid gap-2">
              <label>Assign to children</label>
              <div className="soft-section grid gap-2 p-3">
                <input value={childQuery} onChange={(e) => setChildQuery(e.target.value)} placeholder="Search children" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <select value={assignmentFilter} onChange={(e) => setAssignmentFilter(e.target.value)} aria-label="Filter children">
                    <option value="all">All children</option>
                    <option value="selected">Selected</option>
                    <option value="unselected">Unselected</option>
                  </select>
                  <select value={childSort} onChange={(e) => setChildSort(e.target.value)} aria-label="Sort children">
                    <option value="name_asc">Name A-Z</option>
                    <option value="selected_first">Selected first</option>
                  </select>
                </div>
                {children.length === 0 && <p className="text-sm text-muted">Create child profiles before assigning imports.</p>}
                {filteredChildren.map((child) => (
                  <label key={child.id} className="flex cursor-pointer items-center justify-between rounded-ui border border-border bg-panel px-3 py-2 text-sm transition hover:border-accent/25 hover:bg-accent/5">
                    <span>{child.name}</span>
                    <input type="checkbox" checked={childProfileIds.includes(child.id)} onChange={() => toggleChild(child.id)} />
                  </label>
                ))}
                {children.length > 0 && filteredChildren.length === 0 && <p className="text-sm text-muted">No matching children.</p>}
              </div>
              <p className="text-xs text-muted">{childProfileIds.length ? `${childProfileIds.length} selected` : "Import only, assign later"}</p>
            </div>
            <Field label="Download priority">
              <select value={downloadPriority} onChange={(e) => setDownloadPriority(e.target.value)}>
                <option value="normal">Normal</option>
                <option value="required">Download for offline</option>
                <option value="optional">Optional</option>
              </select>
            </Field>
            {error && <p className="rounded-ui border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <Button className="w-full sm:w-fit" disabled={isSubmitting || !trimmedUrl}>
              {importKind === "playlist" ? <ListVideo size={16} /> : <LinkIcon size={16} />}
              {isSubmitting ? "Creating job..." : importKind === "playlist" ? "Import playlist" : "Download and assign"}
            </Button>
          </form>
        </Panel>
        <Panel>
          <form onSubmit={search} className="grid gap-4">
            <Field label="Search YouTube"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search terms" required /></Field>
            <Field label="How many videos to import">
              <input type="number" min={1} max={50} value={searchLimit} onChange={(e) => setSearchLimit(e.target.value)} required />
            </Field>
            <div className="soft-section p-3 text-sm text-muted">
              Searches YouTube and automatically imports up to this many videos, skipping anything already in your library or import queue. Imported videos inherit the child assignments and download priority selected on the left.
            </div>
            {searchError && <p className="rounded-ui border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{searchError}</p>}
            <Button variant="secondary" className="w-full sm:w-fit" disabled={isSearching || !query.trim() || !searchLimitValid}>
              <Search size={16} /> {isSearching ? "Queuing search..." : "Search and import"}
            </Button>
          </form>
        </Panel>
      </div>
    </Shell>
  );
}
