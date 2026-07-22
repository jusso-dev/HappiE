"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, ImageIcon, Save, Trash2, X } from "lucide-react";
import { Shell } from "@/components/shell";
import { Button, ChildAvatar, Field, Panel } from "@/components/ui";
import { api, ChildProfile, Video } from "@/lib/api";

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [video, setVideo] = useState<Video | null>(null);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [priority, setPriority] = useState("normal");
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const [assignmentError, setAssignmentError] = useState("");
  const [childQuery, setChildQuery] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [childSort, setChildSort] = useState("name_asc");
  const [unassigningChildId, setUnassigningChildId] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    loadVideo().catch(() => {});
    api<ChildProfile[]>("/children").then(setChildren).catch(() => {});
  }, [id]);

  async function loadVideo() {
    const nextVideo = await api<Video>(`/videos/${id}`);
    setVideo(nextVideo);
    setSelectedChildIds((nextVideo.assignments || []).map((assignment) => assignment.child_profile_id));
  }

  async function save() {
    if (!video) return;
    setSaveMessage("");
    try {
      const saved = await api<Video>(`/videos/${id}`, { method: "PUT", body: JSON.stringify(video) });
      setVideo({ ...video, ...saved });
      setSaveMessage("Saved.");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Save failed");
    }
  }

  async function unassignChild(childId: string) {
    setUnassigningChildId(childId);
    setAssignmentError("");
    setAssignmentMessage("");
    try {
      await api(`/videos/${id}/assign/${childId}`, { method: "DELETE" });
      await loadVideo();
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : "Unassign failed");
    } finally {
      setUnassigningChildId("");
    }
  }

  async function deleteVideo() {
    if (!video) return;
    if (!window.confirm(`Delete “${video.title}” and its stored files? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api(`/videos/${id}`, { method: "DELETE" });
      router.push("/videos");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Delete failed");
      setDeleting(false);
    }
  }

  function toggleChild(childId: string) {
    setSelectedChildIds((ids) => ids.includes(childId) ? ids.filter((id) => id !== childId) : [...ids, childId]);
  }

  async function saveAssignments() {
    if (!video) return;
    setAssignmentError("");
    setAssignmentMessage("");
    setSavingAssignments(true);

    const currentIds = new Set((video.assignments || []).map((assignment) => assignment.child_profile_id));
    const nextIds = new Set(selectedChildIds);

    try {
      await Promise.all([
        ...selectedChildIds
          .filter((childId) => !currentIds.has(childId))
          .map((childId) => api(`/videos/${id}/assign`, { method: "POST", body: JSON.stringify({ child_profile_id: childId, download_priority: priority }) })),
        ...(video.assignments || [])
          .filter((assignment) => !nextIds.has(assignment.child_profile_id))
          .map((assignment) => api(`/videos/${id}/assign/${assignment.child_profile_id}`, { method: "DELETE" })),
        ...(video.assignments || [])
          .filter((assignment) => nextIds.has(assignment.child_profile_id) && assignment.download_priority !== priority)
          .map((assignment) => api(`/videos/${id}/assign`, { method: "POST", body: JSON.stringify({ child_profile_id: assignment.child_profile_id, download_priority: priority }) })),
      ]);
      await loadVideo();
      setAssignmentMessage("Assignments saved");
    } catch (error) {
      setAssignmentError(error instanceof Error ? error.message : "Assignment failed");
    } finally {
      setSavingAssignments(false);
    }
  }

  const selectedNames = useMemo(() => {
    const names = children.filter((child) => selectedChildIds.includes(child.id)).map((child) => child.name);
    return names.length ? names.join(", ") : "No children selected";
  }, [children, selectedChildIds]);
  const filteredChildren = useMemo(() => {
    const normalizedQuery = childQuery.trim().toLowerCase();
    return [...children]
      .filter((child) => {
        const selected = selectedChildIds.includes(child.id);
        return (!normalizedQuery || child.name.toLowerCase().includes(normalizedQuery))
          && (assignmentFilter === "all" || (assignmentFilter === "selected" ? selected : !selected));
      })
      .sort((a, b) => {
        if (childSort === "selected_first") {
          return Number(selectedChildIds.includes(b.id)) - Number(selectedChildIds.includes(a.id)) || a.name.localeCompare(b.name);
        }
        return a.name.localeCompare(b.name);
      });
  }, [assignmentFilter, childQuery, childSort, children, selectedChildIds]);

  if (!video) return <Shell><p>Loading</p></Shell>;

  return (
    <Shell>
      <h1 className="page-title mb-6 break-words">{video.title}</h1>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Panel>
          <div className="grid gap-4">
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-ui bg-ink/[0.07]">
              {video.thumbnail_url ? <img src={video.thumbnail_url} alt="" className="h-full w-full object-cover" /> : <ImageIcon className="text-muted" size={32} />}
            </div>
            <Field label="Title"><input value={video.title} onChange={(e) => setVideo({ ...video, title: e.target.value })} /></Field>
            <Field label="Description"><textarea rows={5} value={video.description || ""} onChange={(e) => setVideo({ ...video, description: e.target.value })} /></Field>
            <label className="flex items-center gap-2"><input type="checkbox" checked={video.approved} onChange={(e) => setVideo({ ...video, approved: e.target.checked })} /> Approved for kids</label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button onClick={save} className="w-full sm:w-fit"><Save size={16} /> Save</Button>
              <Button variant="danger" onClick={deleteVideo} disabled={deleting} className="w-full sm:w-fit">
                <Trash2 size={15} /> {deleting ? "Deleting..." : "Delete video"}
              </Button>
            </div>
            {saveMessage && <p className="text-sm text-muted">{saveMessage}</p>}
          </div>
        </Panel>
        <Panel>
          <h2 className="mb-1 text-base font-semibold">Assignments</h2>
          <p className="mb-4 text-sm text-muted">Select every child who should see this video.</p>

          <Field label="Download priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="required">Required</option>
              <option value="normal">Normal</option>
              <option value="optional">Optional</option>
            </select>
          </Field>

          <div className="mt-4 grid gap-2">
            <input value={childQuery} onChange={(e) => setChildQuery(e.target.value)} placeholder="Search children" />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              <select value={assignmentFilter} onChange={(e) => setAssignmentFilter(e.target.value)} aria-label="Filter assignments">
                <option value="all">All children</option>
                <option value="selected">Selected</option>
                <option value="unselected">Unselected</option>
              </select>
              <select value={childSort} onChange={(e) => setChildSort(e.target.value)} aria-label="Sort assignments">
                <option value="name_asc">Name A-Z</option>
                <option value="selected_first">Selected first</option>
              </select>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            {filteredChildren.map((child) => {
              const selected = selectedChildIds.includes(child.id);
              return (
                <label key={child.id} className="flex cursor-pointer items-center justify-between rounded-ui border border-border bg-panel px-3 py-2.5 text-sm transition hover:border-accent/25 hover:bg-accent/5">
                  <span className="flex items-center gap-2 font-medium text-ink">
                    <ChildAvatar name={child.name} color={child.avatar_color} size="sm" />
                    {child.name}
                  </span>
                  <span className="flex items-center gap-2 text-muted">
                    {selected && <Check size={15} className="text-accent" />}
                    <input type="checkbox" checked={selected} onChange={() => toggleChild(child.id)} />
                  </span>
                </label>
              );
            })}
            {filteredChildren.length === 0 && <p className="text-sm text-muted">No matching children.</p>}
          </div>

          <p className="mt-3 text-sm text-muted">{selectedNames}</p>

          {assignmentMessage && <p className="mt-3 rounded-ui border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-ink">{assignmentMessage}</p>}
          {assignmentError && <p className="mt-3 rounded-ui border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{assignmentError}</p>}

          <Button className="mt-4 w-full" disabled={savingAssignments} onClick={saveAssignments}>
            {savingAssignments ? "Saving..." : "Save assignments"}
          </Button>

          {video.assignments && video.assignments.length > 0 && (
            <div className="mt-5 grid gap-2">
              <div className="text-xs font-medium uppercase text-muted">Currently assigned</div>
              {video.assignments.map((assignment) => {
                const child = children.find((item) => item.id === assignment.child_profile_id);
                return (
                  <div key={assignment.child_profile_id} className="flex items-center justify-between gap-3 rounded-ui border border-border bg-ink/[0.03] px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <ChildAvatar name={assignment.child_name} color={child?.avatar_color} size="sm" />
                      <span className="truncate">{assignment.child_name}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-muted">{assignment.download_priority}</span>
                      <button
                        type="button"
                        onClick={() => unassignChild(assignment.child_profile_id)}
                        disabled={unassigningChildId === assignment.child_profile_id}
                        aria-label={`Unassign ${assignment.child_name}`}
                        className="grid size-6 place-items-center rounded-full text-danger transition hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30 disabled:opacity-50"
                      >
                        <X size={14} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
