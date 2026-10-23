// test/triage.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  triageBatch,
  clipState,
  triageHashKey,
  clearTriageCache,
  _triageCache,
} from "../lib/triage.js";

test("clipState returns full text when under maxChars", () => {
  assert.equal(clipState("short text"), "short text");
});

test("clipState head+tail clips long text preserving both ends", () => {
  const long = "A".repeat(1000) + " IMPORTANT_TAIL " + "B".repeat(1000);
  const clipped = clipState(long, 800);
  assert.ok(clipped.length <= 800);
  assert.ok(clipped.startsWith("AAAA"));
  assert.ok(clipped.includes("IMPORTANT_TAIL") === false, "middle is elided");
  assert.ok(clipped.includes("..."));
  assert.ok(clipped.endsWith("BBBB"));
});

test("clipState handles empty/null", () => {
  assert.equal(clipState(""), "");
  assert.equal(clipState(null), "");
  assert.equal(clipState(undefined), "");
});

test("triageHashKey is deterministic and order-independent", () => {
  const a = triageHashKey({ q1: { type: "noul", instructions: "x" }, q2: { type: "choice" } }, "state", "model");
  const b = triageHashKey({ q2: { type: "choice" }, q1: { type: "noul", instructions: "x" } }, "state", "model");
  assert.equal(a, b);
});

test("triageHashKey distinguishes states with identical prefix beyond 300 chars", () => {
  const prefix = "X".repeat(350);
  const key1 = triageHashKey({ q: { type: "noul" } }, `${prefix}_tail_1`, "model");
  const key2 = triageHashKey({ q: { type: "noul" } }, `${prefix}_tail_2`, "model");
  assert.notEqual(key1, key2);
});

test("triageBatch returns empty answers for no client", async () => {
  clearTriageCache();
  const res = await triageBatch(null, { q: { type: "noul" } });
  assert.deepEqual(res.answers, {});
});

test("triageBatch caches identical requests", async () => {
  clearTriageCache();
  let calls = 0;
  const client = {
    triage: async () => {
      calls++;
      return { answers: { q: { noul: 0.9 } } };
    },
  };
  const opts = { state: "hello" };
  const r1 = await triageBatch(client, { q: { type: "noul" } }, opts);
  const r2 = await triageBatch(client, { q: { type: "noul" } }, opts);
  assert.equal(calls, 1, "second call served from cache");
  assert.equal(r1.answers.q.noul, 0.9);
  assert.equal(r2.answers.q.noul, 0.9);
});

test("triageBatch deduplicates in-flight identical requests", async () => {
  clearTriageCache();
  let calls = 0;
  const client = {
    triage: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return { answers: { q: { noul: 0.5 } } };
    },
  };
  const p1 = triageBatch(client, { q: { type: "noul" } }, { state: "race" });
  const p2 = triageBatch(client, { q: { type: "noul" } }, { state: "race" });
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(calls, 1, "in-flight dedup prevents stampede");
  assert.equal(a.answers.q.noul, 0.5);
  assert.equal(b.answers.q.noul, 0.5);
});

test("triageBatch respects noCache", async () => {
  clearTriageCache();
  let calls = 0;
  const client = {
    triage: async () => {
      calls++;
      return { answers: { q: { noul: 1 } } };
    },
  };
  await triageBatch(client, { q: { type: "noul" } }, { state: "nc", noCache: true });
  await triageBatch(client, { q: { type: "noul" } }, { state: "nc", noCache: true });
  assert.equal(calls, 2);
});

test("triageBatch scales state capacity with question count", async () => {
  clearTriageCache();
  let receivedState = "";
  const questions = {};
  for (let i = 0; i < 4; i++) {
    questions[`q${i}`] = { type: "noul", instructions: `q${i}` };
  }
  const client = {
    triage: async (_questions, opts) => {
      receivedState = opts.state;
      return { answers: {} };
    },
  };
  // 4 questions -> effective max 1400 chars, so an 1100-char state survives intact
  const state = `H${"x".repeat(1098)}T`;
  await triageBatch(client, questions, { state, noCache: true });
  assert.equal(receivedState, state);
});

test("triageBatch honors explicit maxStateChars", async () => {
  clearTriageCache();
  let receivedState = "";
  const client = {
    triage: async (_questions, opts) => {
      receivedState = opts.state;
      return { answers: {} };
    },
  };
  const state = `head${"m".repeat(1200)}tail`;
  await triageBatch(client, { q: { type: "noul" } }, {
    state,
    maxStateChars: 300,
    noCache: true,
  });
  assert.ok(receivedState.length <= 300, "state should be clipped to explicit max");
  assert.ok(receivedState.includes("head") && receivedState.includes("tail"));
});

test("clearTriageCache empties cache", async () => {
  clearTriageCache();
  const client = { triage: async () => ({ answers: { q: { noul: 1 } } }) };
  await triageBatch(client, { q: { type: "noul" } }, { state: "c" });
  assert.ok(_triageCache.size > 0);
  clearTriageCache();
  assert.equal(_triageCache.size, 0);
});