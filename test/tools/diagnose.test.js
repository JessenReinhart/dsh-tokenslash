// test/tools/diagnose.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { triageDiagnostic, screenRelevantTests, classifyTestFailure, planSpeculativeReads } from "../../lib/tools/diagnose.js";
import { clearTriageCache } from "../../lib/triage.js";

test("screenRelevantTests orders matched test files first", () => {
  const changed = ["lib/hooks/routing.js"];
  const allTests = [
    "test/client.test.js",
    "test/hooks/routing.test.js",
    "test/tools/batch.test.js",
  ];
  const screened = screenRelevantTests(changed, allTests);
  assert.equal(screened[0], "test/hooks/routing.test.js");
  assert.equal(screened.length, 3);
});

test("screenRelevantTests returns all tests when no changes given", () => {
  const allTests = ["test/a.test.js", "test/b.test.js"];
  assert.deepEqual(screenRelevantTests([], allTests), allTests);
});

test("triageDiagnostic classifies error using Jev choice", async () => {
  clearTriageCache();
  const mockClient = {
    triage: async () => ({
      answers: {
        category: { choice: "syntax" },
        is_transient: { noul: 0.05 },
      },
    }),
  };
  const res = await triageDiagnostic(mockClient, "SyntaxError: Unexpected token ')'");
  assert.equal(res.category, "syntax");
  assert.equal(res.isTransient, false);
  assert.ok(res.advice.includes("brackets"));
});

test("triageDiagnostic flags transient flake", async () => {
  clearTriageCache();
  const mockClient = {
    triage: async () => ({
      answers: {
        category: { choice: "env_flake" },
        is_transient: { noul: 0.95 },
      },
    }),
  };
  const res = await triageDiagnostic(mockClient, "FetchError: ETIMEDOUT connecting to host");
  assert.equal(res.category, "env_flake");
  assert.equal(res.isTransient, true);
  assert.ok(res.advice.includes("flake"));
});

test("triageDiagnostic handles empty input gracefully", async () => {
  const res = await triageDiagnostic(null, "");
  assert.equal(res.category, "unknown");
});

test("classifyTestFailure flags flaky error with shouldRetry true", async () => {
  clearTriageCache();
  const mockClient = {
    triage: async () => ({
      answers: {
        failure_kind: { choice: "flaky" },
      },
    }),
  };
  const res = await classifyTestFailure(mockClient, "Error: connect ECONNREFUSED 127.0.0.1:5432");
  assert.equal(res.kind, "flaky");
  assert.equal(res.shouldRetry, true);
  assert.equal(res.isFlaky, true);
});

test("classifyTestFailure handles assertion failure with shouldRetry false", async () => {
  clearTriageCache();
  const mockClient = {
    triage: async () => ({
      answers: {
        failure_kind: { choice: "assertion" },
      },
    }),
  };
  const res = await classifyTestFailure(mockClient, "AssertionError: expected 'foo' to equal 'bar'");
  assert.equal(res.kind, "assertion");
  assert.equal(res.shouldRetry, false);
  assert.equal(res.isFlaky, false);
});

test("classifyTestFailure fails open on throwing client", async () => {
  clearTriageCache();
  const mockClient = {
    triage: async () => {
      throw new Error("Jev service unavailable");
    },
  };
  const res = await classifyTestFailure(mockClient, "Some random error");
  assert.deepEqual(res, { kind: "assertion", shouldRetry: false, isFlaky: false });
});

test("classifyTestFailure handles null/empty/missing client gracefully", async () => {
  const resNull = await classifyTestFailure(null, "some output");
  assert.deepEqual(resNull, { kind: "assertion", shouldRetry: false, isFlaky: false });

  const resEmpty = await classifyTestFailure({ triage: async () => {} }, "");
  assert.deepEqual(resEmpty, { kind: "assertion", shouldRetry: false, isFlaky: false });
});

test("planSpeculativeReads returns mentioned file and test counterpart", () => {
  const candidates = [
    "lib/hooks/routing.js",
    "test/hooks/routing.test.js",
    "lib/index.js",
    "test/index.test.js",
  ];
  const reads = planSpeculativeReads("fix bug in lib/hooks/routing.js", candidates);
  assert.deepEqual(reads, [
    "lib/hooks/routing.js",
    "test/hooks/routing.test.js",
  ]);
});

test("planSpeculativeReads returns only candidates actually present", () => {
  const candidates = ["lib/tools/diagnose.js", "lib/triage.js"];
  const reads = planSpeculativeReads("inspect lib/hooks/compact.js and test/unknown.test.js", candidates);
  assert.deepEqual(reads, []);
});

test("planSpeculativeReads preserves candidate input order and ignores empty input", () => {
  const candidates = ["b.test.js", "a.js", "b.js", "a.test.js"];
  const reads = planSpeculativeReads("review a.js and b.js", candidates);
  assert.deepEqual(reads, ["b.test.js", "a.js", "b.js", "a.test.js"]);

  assert.deepEqual(planSpeculativeReads("", candidates), []);
  assert.deepEqual(planSpeculativeReads("no paths here", candidates), []);
  assert.deepEqual(planSpeculativeReads("check a.js", []), []);
});

