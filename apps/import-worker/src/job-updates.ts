type Update = Record<string, unknown>;

// Serialize per job: background progress must finish before a terminal write.
export function createJobUpdates(send: (id: string, body: Update) => Promise<unknown>) {
  const pending = new Map<string, Promise<unknown>>();
  const progress = new Map<string, number>();
  const terminal = new Set<string>();
  return {
    reset(id: string) {
      progress.delete(id);
      terminal.delete(id);
    },
    async update(id: string, body: Update) {
      if (terminal.has(id)) return;
      if (typeof body.progress === "number") {
        const next = Math.max(progress.get(id) ?? 0, Math.min(100, Math.round(body.progress)));
        progress.set(id, next);
        body = { ...body, progress: next };
      }
      const finished = ["completed", "failed", "cancelled"].includes(String(body.status));
      if (finished) terminal.add(id);
      // Snapshot mutable diagnostics before waiting for preceding requests.
      const snapshot = JSON.parse(JSON.stringify(body)) as Update;
      const request = (pending.get(id) ?? Promise.resolve()).catch(() => {}).then(() => send(id, snapshot));
      pending.set(id, request);
      try {
        await request;
      } catch (error) {
        if (finished) terminal.delete(id);
        throw error;
      } finally {
        if (pending.get(id) === request) pending.delete(id);
        if (finished) progress.delete(id);
      }
    },
  };
}
