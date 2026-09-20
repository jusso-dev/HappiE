import { test } from "node:test";
import assert from "node:assert/strict";
import { createJobUpdates } from "./job-updates.js";

test("failure waits for in-flight progress and ignores late thumbnail updates", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const writes: Record<string, unknown>[] = [];
  const updates = createJobUpdates(async (_id, body) => {
    if (body.status === "processing") await blocked;
    writes.push(body);
  });
  const first = updates.update("job", { status: "processing", progress: 52 });
  const failed = updates.update("job", { status: "failed", progress: 100 });
  await updates.update("job", { status: "processing", progress: 54 });
  assert.equal(writes.length, 0);
  release();
  await Promise.all([first, failed]);
  assert.deepEqual(writes.map((body) => body.status), ["processing", "failed"]);
  updates.reset("job");
  await updates.update("job", { status: "processing", progress: 15 });
  assert.equal(writes.at(-1)?.progress, 15);
});

test("failed progress request does not block terminal status; metadata is snapshotted", async () => {
  const writes: Record<string, unknown>[] = [];
  const updates = createJobUpdates(async (_id, body) => {
    if (body.status === "processing") throw new Error("temporary API failure");
    writes.push(body);
  });
  const first = updates.update("job", { status: "processing", progress: 52 }).catch(() => {});
  const metadata = { detail: "failure" };
  const last = updates.update("job", { status: "failed", progress: 100, metadata });
  metadata.detail = "late thumbnail";
  await Promise.all([first, last]);
  assert.deepEqual(writes[0]?.metadata, { detail: "failure" });
});
