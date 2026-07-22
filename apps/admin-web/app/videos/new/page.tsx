"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { Shell } from "@/components/shell";
import { Button, Field, Panel, ProgressBar } from "@/components/ui";
import { uploadWithProgress } from "@/lib/api";

export default function NewVideoPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const uploading = uploadPercent !== null;
  const optimizing = uploadPercent !== null && uploadPercent >= 100;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose a video file");
    setError("");
    setUploadPercent(0);
    try {
      const form = new FormData();
      form.append("title", title);
      form.append("description", description);
      form.append("file", file);
      await uploadWithProgress("/uploads/direct", form, setUploadPercent);
      router.push("/videos");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
      setUploadPercent(null);
    }
  }

  return (
    <Shell>
      <h1 className="page-title">Upload video</h1>
      <p className="page-subtitle mb-6">Files are optimized by the Rust API, then stored in S3-compatible object storage.</p>
      <Panel>
        <form onSubmit={submit} className="grid max-w-2xl gap-4">
          <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} required disabled={uploading} /></Field>
          <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} disabled={uploading} /></Field>
          <Field label="Video file"><input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} required disabled={uploading} /></Field>
          {uploading && (
            <div className="grid gap-2">
              <ProgressBar value={uploadPercent} label="Upload progress" />
              {optimizing && (
                <p className="flex items-center gap-2 text-sm text-muted">
                  <Loader2 size={15} className="animate-spin" /> Optimizing for iPad, this can take a few minutes for long videos.
                </p>
              )}
            </div>
          )}
          {error && <p className="rounded-ui border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <Button className="w-full sm:w-fit" disabled={uploading}>
            <Upload size={16} /> {optimizing ? "Optimizing..." : uploading ? "Uploading..." : "Upload"}
          </Button>
        </form>
      </Panel>
    </Shell>
  );
}
