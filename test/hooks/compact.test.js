// test/hooks/compact.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createCompactHook, classifyObservation } from "../../lib/hooks/compact.js";
import { goalDriftCheck } from "../../lib/hooks/goal-guard.js";
import { clearTriageCache } from "../../lib/triage.js";

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

test("classifyObservation: returns pass when output under threshold", async () => {
  const res = await classifyObservation(null, { toolName: "read", output: "hello world", thresholdTokens: 100 });
  assert.deepEqual(res, { action: "pass" });
});

test("classifyObservation: invokes triageBatch and returns choice when over threshold", async () => {
  clearTriageCache();
  let triageCalled = false;
  let receivedState = "";
  const mockJev = {
    triage: async (questions, opts) => {
      triageCalled = true;
      receivedState = opts?.state || "";
      return {
        answers: {
          action: {
            choice: "mask",
            score: 0.95,
          },
        },
      };
    },
  };

  const largeOutput = "log line: process running...\n".repeat(200);
  const res = await classifyObservation(mockJev, { toolName: "run_build", output: largeOutput, thresholdTokens: 50 });

  assert.equal(triageCalled, true);
  assert.ok(receivedState.startsWith("run_build\n"));
  assert.deepEqual(res, { action: "mask" });
});

test("classifyObservation: fails open to pass on error", async () => {
  clearTriageCache();
  const failingJev = {
    triage: async () => {
      throw new Error("System One unavailable");
    },
  };
  const largeOutput = "large text ".repeat(100);
  const res = await classifyObservation(failingJev, { toolName: "bash", output: largeOutput, thresholdTokens: 10 });
  assert.deepEqual(res, { action: "pass" });
});

test("goalDriftCheck: returns onTrack and confidence from noul score", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => ({
      answers: {
        on_track: {
          noul: 0.88,
        },
      },
    }),
  };

  const res = await goalDriftCheck(mockJev, "Fix authentication bug", "Refactoring auth middleware token check");
  assert.deepEqual(res, { onTrack: true, confidence: 0.88 });
});

test("goalDriftCheck: flags drift when noul score is below threshold", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => ({
      answers: {
        on_track: {
          noul: 0.25,
        },
      },
    }),
  };

  const res = await goalDriftCheck(mockJev, "Fix authentication bug", "Playing chess game in terminal");
  assert.deepEqual(res, { onTrack: false, confidence: 0.25 });
});

test("goalDriftCheck: fails open to onTrack: true on error", async () => {
  clearTriageCache();
  const failingJev = {
    triage: async () => {
      throw new Error("Network timeout");
    },
  };

  const res = await goalDriftCheck(failingJev, "Fix bug", "Some output");
  assert.equal(res.onTrack, true);
});
