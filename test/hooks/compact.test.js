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
