// test/hooks/prune.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPruneHook } from "../../lib/hooks/prune.js";

test("pruneHook returns non-object or small results unchanged", async () => {
  const hook = createPruneHook({}, {});
  assert.equal(await hook({ name: "t" }, "string-result"), "string-result");
  const small = { key: "small" };
  assert.deepEqual(await hook({ name: "t" }, small), small);
});

test("pruneHook compacts large objects via Jev", async () => {
  const bigObj = { data: "x".repeat(15000) };
  const mockJev = {
    triage: async () => ({ compact: JSON.stringify({ compacted: true, count: 5 }) }),
  };
  const hook = createPruneHook({}, mockJev);
  const res = await hook({ name: "bigTool" }, bigObj);
  assert.deepEqual(res, { compacted: true, count: 5 });
});

test("pruneHook handles non-json jev text response", async () => {
  const bigObj = { data: "x".repeat(15000) };
  const mockJev = {
    triage: async () => "summary text",
  };
  const hook = createPruneHook({}, mockJev);
  const res = await hook({ name: "bigTool" }, bigObj);
  assert.deepEqual(res, { pruned: true, summary: "summary text" });
});

test("pruneHook fails open on triage rejection", async () => {
  const bigObj = { data: "x".repeat(15000) };
  const mockJev = {
    triage: async () => {
      throw new Error("timeout");
    },
  };
  const hook = createPruneHook({}, mockJev);
  const res = await hook({ name: "bigTool" }, bigObj);
  assert.deepEqual(res, bigObj);
});
