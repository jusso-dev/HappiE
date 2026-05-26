"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Shell } from "@/components/shell";
import { Button, Field, Panel } from "@/components/ui";
import { api } from "@/lib/api";

export default function NewVideoPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose a video file");
    const form = new FormData();
    form.append("title", title);
    form.append("description", description);
    form.append("file", file);
    await api("/uploads/direct", { method: "POST", body: form });
    router.push("/videos");
  }
  return (
    <Shell>
      <h1 className="page-title">Upload video</h1>
      <p className="page-subtitle mb-6">Files are optimized by the Rust API, then stored in S3-compatible object storage.</p>
      <Panel>
        <form onSubmit={submit} className="grid max-w-2xl gap-4">
          <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
          <Field label="Description"><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} /></Field>
          <Field label="Video file"><input type="file" accept="video/*" onChange={(e) => setFile(e.target.files?.[0] || null)} required /></Field>
          {error && <p className="rounded-ui border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <Button className="w-full sm:w-fit"><Upload size={16} /> Upload</Button>
        </form>
      </Panel>
    </Shell>
  );
}
