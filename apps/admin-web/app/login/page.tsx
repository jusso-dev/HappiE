"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { API_BASE, setTokens } from "@/lib/api";
import { Button, Field, Panel } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Login failed");
      return;
    }
    setTokens(body.access_token, body.refresh_token);
    router.push("/dashboard");
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <Panel className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-ui bg-accent text-panel"><Lock size={18} /></div>
          <div>
            <h1 className="text-xl font-semibold">Heylo admin</h1>
            <p className="text-sm text-muted">Private family library controls.</p>
          </div>
        </div>
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error && <p className="rounded-ui border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <Button type="submit">Sign in</Button>
        </form>
      </Panel>
    </main>
  );
}
