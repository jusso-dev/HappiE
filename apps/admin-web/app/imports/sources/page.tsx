"use client";

import { useEffect, useState } from "react";
import {
  Clock3,
  Pencil,
  Play,
  Radio,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { Badge, Button, Field, Panel } from "@/components/ui";
import { api, ChildProfile, VideoSource } from "@/lib/api";

type SourceForm = {
  name: string;
  source_url: string;
  cron_schedule: string;
  enabled: boolean;
  auto_approve: boolean;
  download_priority: string;
  max_videos_per_poll: string;
  child_profile_ids: string[];
};

const EMPTY_FORM: SourceForm = {
  name: "",
  source_url: "",
  cron_schedule: "0 */6 * * *",
  enabled: true,
  auto_approve: true,
  download_priority: "normal",
  max_videos_per_poll: "10",
  child_profile_ids: [],
};

function sourcePayload(form: SourceForm) {
  return {
    ...form,
    name: form.name.trim(),
    source_url: form.source_url.trim(),
    cron_schedule: form.cron_schedule.trim(),
    max_videos_per_poll: Number.parseInt(form.max_videos_per_poll, 10),
  };
}

function dateTime(value?: string) {
  return value ? new Date(value).toLocaleString() : "Not yet";
}

export default function TrustedSourcesPage() {
  const [sources, setSources] = useState<VideoSource[]>([]);
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [form, setForm] = useState<SourceForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function load() {
    const [sourceRows, childRows] = await Promise.all([
      api<VideoSource[]>("/video-sources"),
      api<ChildProfile[]>("/children"),
    ]);
    setSources(sourceRows);
    setChildren(childRows);
  }

  useEffect(() => {
    load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Could not load sources"));
  }, []);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId("");
    setError("");
  }

  function edit(source: VideoSource) {
    setEditingId(source.id);
    setForm({
      name: source.name,
      source_url: source.source_url,
      cron_schedule: source.cron_schedule,
      enabled: source.enabled,
      auto_approve: source.auto_approve,
      download_priority: source.download_priority,
      max_videos_per_poll: String(source.max_videos_per_poll),
      child_profile_ids: source.child_profile_ids,
    });
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleChild(id: string) {
    setForm((current) => ({
      ...current,
      child_profile_ids: current.child_profile_ids.includes(id)
        ? current.child_profile_ids.filter((childId) => childId !== id)
        : [...current.child_profile_ids, id],
    }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      await api(editingId ? `/video-sources/${editingId}` : "/video-sources", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(sourcePayload(form)),
      });
      resetForm();
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save source");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function updateEnabled(source: VideoSource) {
    setBusyId(source.id);
    setError("");
    try {
      await api(`/video-sources/${source.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ...source,
          enabled: !source.enabled,
        }),
      });
      await load();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not update source");
    } finally {
      setBusyId("");
    }
  }

  async function pollNow(source: VideoSource) {
    setBusyId(source.id);
    setError("");
    try {
      await api(`/video-sources/${source.id}/poll`, { method: "POST" });
      await load();
    } catch (pollError) {
      setError(pollError instanceof Error ? pollError.message : "Could not queue poll");
    } finally {
      setBusyId("");
    }
  }

  async function remove(source: VideoSource) {
    if (!window.confirm(`Delete trusted source "${source.name}"? Existing videos stay in the library.`)) return;
    setBusyId(source.id);
    try {
      await api(`/video-sources/${source.id}`, { method: "DELETE" });
      if (editingId === source.id) resetForm();
      await load();
    } finally {
      setBusyId("");
    }
  }

  const maxVideos = Number.parseInt(form.max_videos_per_poll, 10);
  const formValid = form.name.trim()
    && form.source_url.trim()
    && form.cron_schedule.trim()
    && Number.isFinite(maxVideos)
    && maxVideos >= 1
    && maxVideos <= 50;

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="page-title">Trusted video sources</h1>
        <p className="page-subtitle">Poll chosen YouTube channels or playlists and import unseen videos automatically.</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
        <Panel>
          <form onSubmit={save} className="grid gap-4">
            <div>
              <h2 className="font-semibold">{editingId ? "Edit source" : "Add trusted source"}</h2>
              <p className="mt-1 text-sm text-muted">New sources run their first poll after saving.</p>
            </div>
            <Field label="Source name">
              <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Cosmic Kids Yoga" required />
            </Field>
            <Field label="YouTube channel or playlist URL">
              <input type="url" value={form.source_url} onChange={(event) => setForm({ ...form, source_url: event.target.value })} placeholder="https://www.youtube.com/@channel/videos" required />
            </Field>
            <Field label="Poll schedule (UTC cron)">
              <input value={form.cron_schedule} onChange={(event) => setForm({ ...form, cron_schedule: event.target.value })} placeholder="0 */6 * * *" required />
            </Field>
            <p className="-mt-2 text-xs text-muted">Five fields: minute, hour, day, month, weekday. Example: <code>0 */6 * * *</code> polls every six hours.</p>
            <Field label="Maximum new videos per poll">
              <input type="number" min={1} max={50} value={form.max_videos_per_poll} onChange={(event) => setForm({ ...form, max_videos_per_poll: event.target.value })} required />
            </Field>
            <Field label="Download priority">
              <select value={form.download_priority} onChange={(event) => setForm({ ...form, download_priority: event.target.value })}>
                <option value="normal">Normal</option>
                <option value="required">Download for offline</option>
                <option value="optional">Optional</option>
              </select>
            </Field>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Assign new videos to children</legend>
              {children.map((child) => (
                <label key={child.id} className="flex cursor-pointer items-center justify-between rounded-ui border border-border px-3 py-2 text-sm hover:bg-ink/[0.03]">
                  <span>{child.name}</span>
                  <input type="checkbox" checked={form.child_profile_ids.includes(child.id)} onChange={() => toggleChild(child.id)} />
                </label>
              ))}
              {children.length === 0 && <p className="text-sm text-muted">No child profiles yet. Videos can still import into the library.</p>}
            </fieldset>

            <label className="flex items-start gap-3 rounded-ui border border-warn/35 bg-warn/10 p-3 text-sm">
              <input className="mt-0.5" type="checkbox" checked={form.auto_approve} onChange={(event) => setForm({ ...form, auto_approve: event.target.checked })} />
              <span>
                <span className="font-medium">Automatically approve new videos</span>
                <span className="mt-1 block text-muted">Enable only when every upload from this source is safe for your children.</span>
              </span>
            </label>
            <label className="flex items-center justify-between rounded-ui border border-border px-3 py-2 text-sm">
              <span>Polling enabled</span>
              <input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />
            </label>

            {error && <p role="alert" className="rounded-ui border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button disabled={isSubmitting || !formValid}>
                <ShieldCheck size={16} /> {isSubmitting ? "Saving..." : editingId ? "Save changes" : "Trust and add source"}
              </Button>
              {editingId && <Button type="button" variant="secondary" onClick={resetForm}>Cancel</Button>}
            </div>
          </form>
        </Panel>

        <Panel className="p-0">
          <div className="border-b border-border px-5 py-4">
            <h2 className="font-semibold">Scheduled sources</h2>
            <p className="mt-1 text-sm text-muted">{sources.length} configured</p>
          </div>
          {sources.map((source) => (
            <article key={source.id} className="border-b border-border px-5 py-4 last:border-b-0">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Radio size={16} />
                    <h3 className="font-medium">{source.name}</h3>
                    <Badge tone={source.enabled ? "success" : "neutral"}>{source.enabled ? "active" : "paused"}</Badge>
                    {source.auto_approve && <Badge tone="warning">auto-approved</Badge>}
                  </div>
                  <a className="mt-2 block truncate text-sm text-muted underline-offset-2 hover:text-ink hover:underline" href={source.source_url} target="_blank" rel="noreferrer">{source.source_url}</a>
                  <div className="mt-3 grid gap-1 text-xs text-muted sm:grid-cols-2">
                    <span><Clock3 className="mr-1 inline" size={13} /> Cron: <code>{source.cron_schedule}</code></span>
                    <span>Limit: {source.max_videos_per_poll} new videos</span>
                    <span>Last poll: {dateTime(source.last_polled_at)}</span>
                    <span>Next poll: {source.enabled ? dateTime(source.next_poll_at) : "Paused"}</span>
                  </div>
                  {source.child_names.length > 0 && <p className="mt-2 text-xs text-muted">Assigns to {source.child_names.join(", ")}</p>}
                  {source.last_error && <p className="mt-2 rounded-ui border border-danger/25 bg-danger/10 px-2 py-1 text-xs text-danger">{source.last_error}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => pollNow(source)} disabled={!source.enabled || busyId === source.id}><Play size={14} /> Poll now</Button>
                  <Button type="button" variant="secondary" onClick={() => updateEnabled(source)} disabled={busyId === source.id}>{source.enabled ? "Pause" : "Enable"}</Button>
                  <Button type="button" variant="secondary" onClick={() => edit(source)}><Pencil size={14} /> Edit</Button>
                  <Button type="button" variant="danger" onClick={() => remove(source)} disabled={busyId === source.id} aria-label={`Delete ${source.name}`}><Trash2 size={14} /></Button>
                </div>
              </div>
            </article>
          ))}
          {sources.length === 0 && (
            <div className="px-5 py-10 text-center">
              <Radio className="mx-auto mb-3 text-muted" size={24} />
              <p className="font-medium">No trusted sources yet</p>
              <p className="mt-1 text-sm text-muted">Add one to keep the family library fresh automatically.</p>
            </div>
          )}
        </Panel>
      </div>
    </Shell>
  );
}
