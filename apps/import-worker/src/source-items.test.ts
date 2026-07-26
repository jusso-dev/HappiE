import assert from "node:assert/strict";
import test from "node:test";
import { selectSourceItems, SourceItem } from "./source-items.js";

function items(...ids: string[]): SourceItem[] {
  return ids.map((id, index) => ({
    url: `https://www.youtube.com/watch?v=${id}`,
    external_id: id,
    index: index + 1,
  }));
}

test("first poll selects newest videos and records newest anchor", () => {
  const result = selectSourceItems(items("newest", "middle", "oldest"), "", 2);
  assert.deepEqual(result.items.map((item) => item.external_id), ["newest", "middle"]);
  assert.equal(result.observedExternalId, "newest");
});

test("later poll selects only videos newer than anchor", () => {
  const result = selectSourceItems(items("new-2", "new-1", "anchor", "old"), "anchor", 10);
  assert.deepEqual(result.items.map((item) => item.external_id), ["new-2", "new-1"]);
  assert.equal(result.observedExternalId, "new-2");
});

test("large backlog advances oldest chunk without dropping videos", () => {
  const result = selectSourceItems(
    items("new-4", "new-3", "new-2", "new-1", "anchor"),
    "anchor",
    2,
  );
  assert.deepEqual(result.items.map((item) => item.external_id), ["new-2", "new-1"]);
  assert.equal(result.observedExternalId, "new-2");
});

test("missing anchor restarts from newest videos", () => {
  const result = selectSourceItems(items("newest", "older"), "deleted", 1);
  assert.deepEqual(result.items.map((item) => item.external_id), ["newest"]);
  assert.equal(result.observedExternalId, "newest");
});
