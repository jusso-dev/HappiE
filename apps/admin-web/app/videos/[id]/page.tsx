"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Check, ImageIcon, Save } from "lucide-react";
import { Shell } from "@/components/shell";
import { Button, Field, Panel } from "@/components/ui";
import { api, ChildProfile, Video } from "@/lib/api";

export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [video, setVideo] = useState<Video | null>(null);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [priority, setPriority] = useState("normal");
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [savingAssignments, setSavingAssignments] = useState(false);
  const [assignmentMessage, setAssignmentMessage] = useState("");
  const [assignmentError, setAssignmentError] = useState("");
  const [childQuery, setChildQuery] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState("all");
  const [childSort, setChildSort] = useState("name_asc");

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
    setVideo(await api<Video>(`/videos/${id}`, { method: "PUT", body: JSON.stringify(video) }));
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
            <Button onClick={save} className="w-full sm:w-fit"><Save size={16} /> Save</Button>
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
                <label key={child.id} className="flex cursor-pointer items-center justify-between rounded-ui border border-border bg-panel px-3 py-3 text-sm transition hover:border-accent/25 hover:bg-accent/5">
                  <span className="font-medium text-ink">{child.name}</span>
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
              {video.assignments.map((assignment) => (
                <div key={assignment.child_profile_id} className="flex items-center justify-between gap-3 rounded-ui border border-border bg-ink/[0.03] px-3 py-2 text-sm">
                  <span>{assignment.child_name}</span>
                  <span className="shrink-0 text-muted">{assignment.download_priority}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
