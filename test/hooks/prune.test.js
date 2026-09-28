// test/hooks/prune.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPruneHook } from "../../lib/hooks/prune.js";

const mockLLMCtx = {
  llm: {
    stream: async function* () {
      yield { content: JSON.stringify({ compacted: true, count: 5 }) };
    }
  }
};

test("pruneHook returns non-object or small results unchanged", async () => {
  const hook = createPruneHook({}, {});
  assert.equal(await hook({ name: "t" }, "string-result"), "string-result");
  const small = { key: "small" };
  assert.deepEqual(await hook({ name: "t" }, small), small);
});

test("pruneHook compacts large objects via LLM", async () => {
  const bigObj = { data: "x".repeat(15000) };
  const hook = createPruneHook(mockLLMCtx);
  const res = await hook({ name: "bigTool" }, bigObj);
  assert.deepEqual(res, { compacted: true, count: 5 });
});

test("pruneHook handles non-json LLM text response", async () => {
  const bigObj = { data: "x".repeat(15000) };
  const mockTextCtx = {
    llm: {
      stream: async function* () {
        yield { content: "summary text" };
      }
    }
  };
  const hook = createPruneHook(mockTextCtx);
  const res = await hook({ name: "bigTool" }, bigObj);
  assert.deepEqual(res, { pruned: true, summary: "summary text" });
});

test("pruneHook fails back to structural truncation when LLM missing", async () => {
  const bigObj = { data: "x".repeat(15000) };
  const hook = createPruneHook({});
  const res = await hook({ name: "bigTool" }, bigObj);
  assert.equal(typeof res, "object");
  assert.equal(res.pruned, true);
  assert.ok(res.summary.length <= 12000);
});
