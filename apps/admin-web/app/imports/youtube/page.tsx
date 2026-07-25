"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Link as LinkIcon,
  ListVideo,
  Search,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { Button, Field, Panel, ProgressBar } from "@/components/ui";
import {
  api,
  ChildProfile,
  ImportJob,
  SearchImportResponse,
  YoutubeSearchResult,
} from "@/lib/api";

function formatDuration(seconds?: number) {
  if (!seconds || seconds < 1) return "";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function formatViews(views?: number) {
  if (!views || views < 1) return "";
  return `${new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(views)} views`;
}

function resultsFromJob(job: ImportJob) {
  const results = job.metadata?.search_results;
  if (!Array.isArray(results)) return [];
  return results.filter((item): item is YoutubeSearchResult => (
    typeof item === "object"
    && item !== null
    && typeof item.id === "string"
    && typeof item.title === "string"
    && typeof item.url === "string"
  ));
}

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
  const [searchJob, setSearchJob] = useState<ImportJob | null>(null);
  const [activeSearchId, setActiveSearchId] = useState("");
  const [searchResults, setSearchResults] = useState<YoutubeSearchResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [isQueueing, setIsQueueing] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState("");
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

  useEffect(() => {
    if (!activeSearchId) return;
    let requestInFlight = false;

    async function refreshSearch() {
      if (requestInFlight) return;
      requestInFlight = true;
      try {
        const job = await api<ImportJob>(`/imports/${activeSearchId}`);
        setSearchJob(job);
        if (job.status === "completed") {
          setSearchResults(resultsFromJob(job));
          setSelectedResults(new Set());
          setIsSearching(false);
          setActiveSearchId("");
        } else if (job.status === "failed" || job.status === "cancelled") {
          setSearchError("YouTube search failed. Check the Imports page for safe diagnostic details.");
          setIsSearching(false);
          setActiveSearchId("");
        }
      } catch (pollError) {
        setSearchError(pollError instanceof Error ? pollError.message : "Could not read search progress");
        setIsSearching(false);
        setActiveSearchId("");
      } finally {
        requestInFlight = false;
      }
    }

    void refreshSearch();
    const timer = window.setInterval(refreshSearch, 1200);
    return () => window.clearInterval(timer);
  }, [activeSearchId]);

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
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Import failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setSearchError("");
    setSelectionMessage("");
    setSearchResults([]);
    setSelectedResults(new Set());
    setSearchJob(null);
    setIsSearching(true);
    try {
      const job = await api<ImportJob>("/imports/youtube/search", {
        method: "POST",
        body: JSON.stringify({
          query: query.trim(),
          limit: parsedSearchLimit,
        }),
      });
      setSearchJob(job);
      setActiveSearchId(job.id);
    } catch (searchRequestError) {
      setSearchError(searchRequestError instanceof Error ? searchRequestError.message : "Search failed");
      setIsSearching(false);
    }
  }

  async function importSelected() {
    if (!searchJob || selectedResults.size === 0) return;
    setSelectionMessage("");
    setIsQueueing(true);
    try {
      const result = await api<SearchImportResponse>(`/imports/youtube/search/${searchJob.id}/import`, {
        method: "POST",
        body: JSON.stringify({
          selected_external_ids: [...selectedResults],
          child_profile_ids: childProfileIds,
          approve: childProfileIds.length > 0,
          download_priority: downloadPriority,
        }),
      });
      if (result.created_count > 0) {
        router.push("/imports");
        return;
      }
      setSelectionMessage(
        result.skipped_duplicates > 0
          ? "Those videos are already in your library or import queue."
          : "No import jobs were created.",
      );
    } catch (queueError) {
      setSelectionMessage(queueError instanceof Error ? queueError.message : "Could not import the selected videos");
    } finally {
      setIsQueueing(false);
    }
  }

  function toggleChild(childId: string) {
    setChildProfileIds((ids) => ids.includes(childId) ? ids.filter((id) => id !== childId) : [...ids, childId]);
  }

  function toggleResult(externalId: string) {
    setSelectedResults((current) => {
      const next = new Set(current);
      if (next.has(externalId)) next.delete(externalId);
      else next.add(externalId);
      return next;
    });
    setSelectionMessage("");
  }

  function toggleAllResults() {
    setSelectedResults((current) => (
      current.size === searchResults.length
        ? new Set()
        : new Set(searchResults.map((result) => result.id))
    ));
    setSelectionMessage("");
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

  const allResultsSelected = searchResults.length > 0 && selectedResults.size === searchResults.length;

  return (
    <Shell>
      <h1 className="page-title">YouTube import</h1>
      <p className="page-subtitle mb-6">Import a link directly, or search first and choose exactly which videos to add.</p>

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
                Every video in the playlist is queued. Use search when you want to review individual videos first.
              </div>
            )}
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
            <Field label="Number of results">
              <input type="number" min={1} max={50} value={searchLimit} onChange={(e) => setSearchLimit(e.target.value)} required />
            </Field>
            <div className="soft-section p-3 text-sm text-muted">
              Search results appear below. Nothing downloads until you select videos and confirm the import.
            </div>
            {searchError && <p className="rounded-ui border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{searchError}</p>}
            <Button variant="secondary" className="w-full sm:w-fit" disabled={isSearching || !query.trim() || !searchLimitValid}>
              <Search size={16} /> {isSearching ? "Searching..." : "Show results"}
            </Button>
          </form>
        </Panel>

        <Panel className="lg:col-span-2">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <label>Assign imported videos to children</label>
              <p className="text-sm text-muted">Selected children and download priority apply when you start an import. Assigned videos are auto-approved.</p>
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
          </div>
        </Panel>
      </div>

      {isSearching && (
        <Panel className="mt-6" aria-live="polite">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Searching YouTube</h2>
              <p className="mt-1 text-sm text-muted">Finding videos for “{query.trim()}”</p>
            </div>
            <span className="text-sm font-medium text-muted">{searchJob?.progress || 0}%</span>
          </div>
          <ProgressBar value={searchJob?.progress || 5} label="YouTube search progress" />
          <div className="mt-5 grid gap-3" aria-hidden>
            {[0, 1, 2].map((item) => (
              <div key={item} className="grid animate-pulse grid-cols-[112px_minmax(0,1fr)] gap-3">
                <div className="aspect-video rounded-ui bg-ink/10" />
                <div className="grid content-center gap-2">
                  <div className="h-3 w-3/4 rounded-full bg-ink/10" />
                  <div className="h-3 w-2/5 rounded-full bg-ink/[0.07]" />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {searchResults.length > 0 && (
        <section className="mt-6" aria-labelledby="search-results-heading">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="search-results-heading" className="text-lg font-semibold">Choose videos to import</h2>
              <p className="mt-1 text-sm text-muted">{searchResults.length} results for “{searchJob?.query || query.trim()}”</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" onClick={toggleAllResults}>
                {allResultsSelected ? "Clear selection" : "Select all"}
              </Button>
              <Button type="button" onClick={importSelected} disabled={isQueueing || selectedResults.size === 0}>
                <Check size={16} />
                {isQueueing ? "Creating imports..." : `Import selected (${selectedResults.size})`}
              </Button>
            </div>
          </div>

          {selectionMessage && (
            <p role="status" className="mb-3 rounded-ui border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-ink">
              {selectionMessage}
            </p>
          )}

          <Panel className="p-0">
            {searchResults.map((result) => {
              const selected = selectedResults.has(result.id);
              const duration = formatDuration(result.duration_seconds);
              const views = formatViews(result.view_count);
              return (
                <article
                  key={result.id}
                  className={`grid gap-3 border-b border-border p-3 transition last:border-b-0 sm:grid-cols-[auto_144px_minmax(0,1fr)_auto] sm:items-center ${selected ? "bg-accent/5" : "hover:bg-ink/[0.025]"}`}
                >
                  <input
                    id={`search-result-${result.id}`}
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleResult(result.id)}
                    aria-label={`Select ${result.title}`}
                    className="self-start sm:self-center"
                  />
                  <label htmlFor={`search-result-${result.id}`} className="relative block aspect-video cursor-pointer overflow-hidden rounded-ui bg-ink/[0.07]">
                    {result.thumbnail_url
                      ? <img src={result.thumbnail_url} alt="" className="h-full w-full object-cover" />
                      : <span className="grid h-full place-items-center text-xs text-muted">No thumbnail</span>}
                    {duration && <span className="absolute bottom-1 right-1 rounded bg-ink/85 px-1.5 py-0.5 text-[11px] font-medium text-panel">{duration}</span>}
                  </label>
                  <label htmlFor={`search-result-${result.id}`} className="min-w-0 cursor-pointer">
                    <span className="line-clamp-2 text-sm font-medium leading-5 text-ink">{result.title}</span>
                    <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted">
                      {result.channel && <span>{result.channel}</span>}
                      {views && <span>{views}</span>}
                    </span>
                  </label>
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-9 items-center gap-1.5 justify-self-start rounded-ui px-2 text-sm font-medium text-muted transition hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 sm:justify-self-end"
                  >
                    Preview <ExternalLink size={14} />
                  </a>
                </article>
              );
            })}
          </Panel>
        </section>
      )}
    </Shell>
  );
}
