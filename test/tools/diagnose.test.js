// test/tools/diagnose.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { triageDiagnostic, screenRelevantTests } from "../../lib/tools/diagnose.js";
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
