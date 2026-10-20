// test/hooks/compact.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompactHook } from "../../lib/hooks/compact.js";

const mockLLMCtx = {
  llm: {
    stream: async function* () {
      yield { content: "brief summary of old talk" };
    }
  }
};

test("compactHook leaves short conversations alone", async () => {
  const hook = createCompactHook({}, {});
  const msgs = [{ role: "user", content: "hello" }];
  const res = await hook(msgs);
  assert.deepEqual(res, msgs);
});

test("compactHook passes through non-arrays", async () => {
  const hook = createCompactHook({}, {});
  assert.equal(await hook(null), null);
});

test("compactHook condenses context when exceeding threshold", async () => {
  const longText = "word ".repeat(8000);
  const msgs = [
    { role: "user", content: longText },
    { role: "assistant", content: "ok" },
    { role: "user", content: "latest prompt" },
  ];
  const hook = createCompactHook(mockLLMCtx);
  const res = await hook(msgs);
  assert.equal(res.length, 2);
  assert.equal(res[0].role, "system");
  assert.ok(res[0].content.includes("brief summary of old talk"));
  assert.deepEqual(res[1], { role: "user", content: "latest prompt" });
});

test("compactHook fails open on error", async () => {
  const longText = "word ".repeat(8000);
  const msgs = [{ role: "user", content: longText }];
  const hook = createCompactHook({});
  const res = await hook(msgs);
  assert.deepEqual(res, msgs);
});

test("compactHook: yields when nativeServices.compaction is true without calling LLM", async () => {
  let llmCalled = false;
  const ctx = {
    llm: {
      stream: async function* () {
        llmCalled = true;
        yield { content: "compacted" };
      },
    },
  };
  const longText = "word ".repeat(8000);
  const msgs = [{ role: "user", content: longText }];
  const hook = createCompactHook(ctx, null, null, null, { compaction: true });
  const res = await hook(msgs);
  assert.equal(llmCalled, false, "native compaction must not invoke LLM");
  assert.deepEqual(res, msgs, "messages must be untouched");
});

test("compactHook: native passthrough returns 30k-char messages unchanged without LLM", async () => {
  const hook = createCompactHook({}, {}, null, null, { compaction: true });
  const longText = "x".repeat(30000);
  const msgs = [
    { role: "user", content: longText },
    { role: "assistant", content: "ok" },
    { role: "user", content: "latest prompt" },
  ];
  const res = await hook(msgs);
  assert.equal(res, msgs, "must return the exact same array reference");
  assert.equal(res[0].content.length, 30000, "content must not be truncated");
});
