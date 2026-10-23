// test/hooks/prune.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPruneHook, distillOutput } from "../../lib/hooks/prune.js";
import { TokenslashTelemetry } from "../../lib/telemetry.js";

const enabledConfig = { enabled: true, modules: { outputCompacting: true }, toolPruningMode: "extreme" };

function mockLLMCtx(text = "summary text") {
  return {
    llm: {
      stream: async function* () {
        yield { content: text };
      },
    },
  };
}

// Mirrors the Cordis scoped-context proxy: reading an uninjected service throws.
function strictCordisCtx(services = {}) {
  const injected = new Set(["llm"]);
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol") return undefined;
        if (!injected.has(prop)) {
          throw new Error(`cannot get property "${prop}" without inject`);
        }
        return services[prop];
      },
    }
  );
}

test("pruneHook returns small results unchanged (legacy signature)", async () => {
  const hook = createPruneHook({}, {}, () => enabledConfig);
  const small = { key: "small" };
  assert.deepEqual(await hook({ name: "t" }, small), small);
  assert.equal(await hook({ name: "t" }, "short string"), "short string");
});

test("pruneHook skips when outputCompacting disabled", async () => {
  const telemetry = new TokenslashTelemetry();
  const hook = createPruneHook(mockLLMCtx(), {}, () => ({ enabled: true, modules: { outputCompacting: false } }), telemetry);
  const big = { data: "x".repeat(15000) };
  const res = await hook({ name: "bigTool" }, big, async () => ({ kind: "accept" }));
  assert.deepEqual(res, { kind: "accept" });
  assert.equal(telemetry.outputsCompactedCount, 0);
});

test("pruneHook compacts large object via LLM and returns content blocks (legacy)", async () => {
  const telemetry = new TokenslashTelemetry();
  const hook = createPruneHook(mockLLMCtx(), {}, () => enabledConfig, telemetry);
  const res = await hook({ name: "bigTool" }, { data: "x".repeat(15000) });
  assert.ok(Array.isArray(res));
  assert.equal(res[0].type, "text");
  assert.equal(res[0].text, "summary text");
  assert.equal(telemetry.outputsCompactedCount, 1);
});

test("pruneHook waterfall signature compacts result.value and returns kind=accept content", async () => {
  const telemetry = new TokenslashTelemetry();
  const hook = createPruneHook(mockLLMCtx("compact summary"), {}, () => enabledConfig, telemetry);
  const exec = { name: "read", agent: { id: "a1" } };
  const result = { value: { path: "big.txt", lines: [{ number: 1, text: "x".repeat(15000) }] } };

  const decision = await hook(exec, result, async () => ({ kind: "accept" }));

  assert.equal(decision.kind, "accept");
  assert.ok(Array.isArray(decision.content));
  assert.equal(decision.content[0].type, "text");
  assert.equal(decision.content[0].text, "compact summary");
  assert.equal(Object.hasOwn(decision, "value"), false, "must not return value: DSH validates it against tool schema");
  assert.equal(telemetry.outputsCompactedCount, 1);
  assert.ok(telemetry.totalTokensSaved > 0);
});

test("pruneHook waterfall signature compacts large result.content arrays", async () => {
  const telemetry = new TokenslashTelemetry();
  const hook = createPruneHook(mockLLMCtx("content summary"), {}, () => enabledConfig, telemetry);
  const result = { content: [{ type: "text", text: "y".repeat(15000) }] };

  const decision = await hook({ name: "read" }, result, async () => ({ kind: "accept" }));
  assert.equal(decision.kind, "accept");
  assert.equal(decision.content[0].text, "content summary");
  assert.equal(telemetry.outputsCompactedCount, 1);
});

test("pruneHook waterfall passes through below-threshold output without telemetry", async () => {
  const telemetry = new TokenslashTelemetry();
  const hook = createPruneHook(mockLLMCtx(), {}, () => enabledConfig, telemetry);
  const decision = await hook({ name: "read" }, { value: { lines: [] } }, async () => ({ kind: "accept" }));
  assert.deepEqual(decision, { kind: "accept" });
  assert.equal(telemetry.outputsCompactedCount, 0);
});

test("pruneHook falls back to structural truncation when LLM missing", async () => {
  const telemetry = new TokenslashTelemetry();
  const hook = createPruneHook({}, {}, () => enabledConfig, telemetry);
  const input = { data: "x".repeat(15000) };
  const res = await hook({ name: "bigTool" }, input);
  assert.ok(Array.isArray(res));
  assert.equal(res[0].type, "text");
  assert.ok(res[0].text.length < JSON.stringify(input).length);
  assert.ok(res[0].text.length <= 12000);
  assert.match(res[0].text, /\.\.\. \[truncated\]/);
  assert.doesNotThrow(() => JSON.parse(res[0].text));
  assert.equal(telemetry.outputsCompactedCount, 1);
});

test("pruneHook falls back to structural truncation when LLM stream throws", async () => {
  const telemetry = new TokenslashTelemetry();
  const ctx = {
    llm: {
      stream: async function* () {
        throw new Error("llm unavailable");
      },
    },
  };
  const hook = createPruneHook(ctx, {}, () => enabledConfig, telemetry);
  const res = await hook({ name: "bigTool" }, { data: "x".repeat(15000) });
  assert.equal(res[0].type, "text");
  assert.equal(telemetry.outputsCompactedCount, 1);
});

test("pruneHook survives Cordis proxy rejection of uninjected services", async () => {
  const telemetry = new TokenslashTelemetry();
  const ctx = strictCordisCtx({ llm: mockLLMCtx().llm });
  const hook = createPruneHook(ctx, {}, () => enabledConfig, telemetry);
  const decision = await hook({ name: "read" }, { value: { text: "z".repeat(15000) } }, async () => ({ kind: "accept" }));
  assert.equal(decision.kind, "accept");
  assert.equal(decision.content[0].text, "summary text");
  assert.equal(telemetry.outputsCompactedCount, 1);
});

test("pruneHook: yields when nativeServices.nativeToolResultPruner is true without modifying result", async () => {
  const telemetry = new TokenslashTelemetry();
  const hook = createPruneHook({}, {}, () => enabledConfig, telemetry, { nativeToolResultPruner: true });
  const largeOutput = "z".repeat(20000);
  const res = await hook({ name: "read" }, largeOutput);
  assert.equal(res, largeOutput);
  assert.equal(telemetry.outputsCompactedCount, 0);

  const waterfallRes = await hook({ name: "read" }, { value: largeOutput }, async () => ({ kind: "nextCalled" }));
  assert.equal(waterfallRes.kind, "nextCalled");
});

test("pruneHook: passes result through unchanged when nativeToolResultPruner is true and next is undefined", async () => {
  const hook = createPruneHook({}, null, () => ({}), null, { nativeToolResultPruner: true });
  const largeResult = "x".repeat(30000);
  const res = await hook({ name: "bash" }, largeResult, undefined);
  assert.equal(res, largeResult);
});

test("distillOutput: strips ANSI escape sequences", () => {
  const input = "\x1b[32mSUCCESS\x1b[0m: Process completed \x1b[1;34mcleanly\x1b[0m\x1b]0;Title\x07";
  const distilled = distillOutput(input);
  assert.equal(distilled, "SUCCESS: Process completed cleanly");
});

test("distillOutput: resolves carriage-return overwrite lines", () => {
  const input = "Downloading: 10%\rDownloading: 50%\rDownloading: 100%\nDone.";
  const distilled = distillOutput(input);
  assert.equal(distilled, "Downloading: 100%\nDone.");
});

test("distillOutput: collapses 3+ repeated identical lines", () => {
  const input = ["warning: deprecated API", "warning: deprecated API", "warning: deprecated API", "warning: deprecated API"].join("\n");
  const distilled = distillOutput(input);
  assert.ok(distilled.includes("warning: deprecated API"));
  assert.ok(distilled.includes("[... repeated 3 more times]"));
});

test("distillOutput: collapses 5+ similar lines", () => {
  const input = [
    "  PASS  test/a.test.js",
    "  PASS  test/b.test.js",
    "  PASS  test/c.test.js",
    "  PASS  test/d.test.js",
    "  PASS  test/e.test.js",
  ].join("\n");
  const distilled = distillOutput(input);
  assert.ok(distilled.includes("test/a.test.js"));
  assert.ok(distilled.includes("test/b.test.js"));
  assert.ok(distilled.includes("similar lines omitted"));
  assert.ok(distilled.includes("test/e.test.js"));
});

test("distillOutput: collapses 3+ consecutive blank lines to 2", () => {
  const input = "start\n\n\n\n\nend";
  const distilled = distillOutput(input);
  assert.equal(distilled, "start\n\n\nend");
});

test("pruneHook: short outputs (< 500 chars) bypass distillation", async () => {
  const hook = createPruneHook({}, {}, () => enabledConfig);
  const shortAnsi = "\x1b[31mError\x1b[0m"; // < 500 chars
  const res = await hook({ name: "bash" }, shortAnsi);
  assert.equal(res, shortAnsi); // untouched because length < 500
});

test("pruneHook: distillation + truncation pipeline works end-to-end", async () => {
  const telemetry = new TokenslashTelemetry();
  const distillJev = {
    triage: async () => ({
      answers: { action: { choice: "distill" } },
    }),
  };
  const hook = createPruneHook(mockLLMCtx("compact summary"), distillJev, () => enabledConfig, telemetry);
  // Large output with ANSI codes and repetition > 500 chars
  const noise = "\x1b[32m  PASS  test/suite.test.js\x1b[0m\n".repeat(200);
  const res = await hook({ name: "bash" }, noise);
  // Distillation successfully collapses the 7KB repeated noise down below compactLimit
  assert.equal(typeof res, "string");
  assert.ok(res.includes("[... repeated 199 more times]"));
  assert.ok(!res.includes("\x1b[32m"));

  // When input is still > compactLimit even after distillation, LLM compaction triggers
  const hugeUncollapsible = "\x1b[33mWarning\x1b[0m: " + "a".repeat(100) + "\n";
  const uniqueLines = Array.from({ length: 80 }, (_, i) => `${hugeUncollapsible} unique line ${i}`).join("\n");
  const compacted = await hook({ name: "bash" }, uniqueLines);
  assert.ok(Array.isArray(compacted));
  assert.equal(compacted[0].type, "text");
  assert.equal(compacted[0].text, "compact summary");
  assert.equal(telemetry.outputsCompactedCount, 1);
});

test("pruneHook: classifyObservation action=pass preserves oversized output verbatim", async () => {
  const telemetry = new TokenslashTelemetry();
  const passJev = {
    triage: async () => ({
      answers: { action: { choice: "pass" } },
    }),
  };
  const hook = createPruneHook(mockLLMCtx("compact summary"), passJev, () => enabledConfig, telemetry);
  const largeDiff = "diff --git a/file b/file\n" + "+ line of critical code\n".repeat(250);
  const res = await hook({ name: "git_diff" }, largeDiff);
  assert.equal(res, largeDiff);
  assert.equal(telemetry.outputsCompactedCount, 0);
});

test("pruneHook: classifyObservation action=mask returns short deterministic stub", async () => {
  const telemetry = new TokenslashTelemetry();
  const maskJev = {
    triage: async () => ({
      answers: { action: { choice: "mask" } },
    }),
  };
  const hook = createPruneHook(mockLLMCtx("compact summary"), maskJev, () => enabledConfig, telemetry);
  const largeSpam = "build progress 12%\n".repeat(300);
  const res = await hook({ name: "build" }, largeSpam);
  assert.ok(Array.isArray(res));
  assert.equal(res[0].type, "text");
  assert.ok(res[0].text.includes("output masked"));
  assert.ok(res[0].text.includes("build"));
});

test("pruneHook: classifies shell test failure and appends diagnosis line", async () => {
  const flakyJev = {
    triage: async () => ({
      answers: { failure_kind: { choice: "flaky" } },
    }),
  };
  const hook = createPruneHook({}, flakyJev, () => enabledConfig);
  const shellFailure = {
    exitCode: 1,
    stderr: "Error: ECONNREFUSED connect 127.0.0.1:8080\n    at TCPConnectWrap.afterConnect",
  };
  const res = await hook({ name: "pwsh" }, shellFailure);
  assert.ok(res.stderr.includes("[tokenslash-diagnose: flaky - transient flake detected, safe to retry]"));
});

test("pruneHook: ranks glob output > 30 paths down to top 10 with omitted summary", async () => {
  const hook = createPruneHook({}, {}, () => enabledConfig);
  const paths = Array.from({ length: 40 }, (_, i) => `src/module-${String(i).padStart(2, "0")}/file-${i}.ts`);
  const res = await hook({ name: "glob" }, paths.join("\n"));
  const lines = res.split("\n");
  assert.equal(lines.length, 11);
  assert.equal(lines[0], "src/module-00/file-0.ts");
  assert.equal(lines[9], "src/module-09/file-9.ts");
  assert.equal(lines[10], "[... 30 lower-relevance paths omitted by tokenslash]");
});

test("pruneHook: leaves glob output with <= 30 paths untouched", async () => {
  const hook = createPruneHook({}, {}, () => enabledConfig);
  const paths = Array.from({ length: 30 }, (_, i) => `src/module-${i}/file.ts`).join("\n");
  const res = await hook({ name: "glob" }, paths);
  assert.equal(res, paths);
});

test("pruneHook: ranks grep output and preserves prompt-relevant candidates first", async () => {
  const tracker = new Map([["agent-1", "find auth token in middleware"]]);
  const hook = createPruneHook({ agent: { id: "agent-1" } }, {}, () => enabledConfig, null, null, tracker);
  const noise = Array.from({ length: 35 }, (_, i) => `src/noise/file-${i}.ts:12: match`).join("\n");
  const target = `src/auth/middleware.ts:10: token = issueToken(user)`;
  const res = await hook({ name: "grep" }, `${noise}\n${target}`);
  assert.ok(res.includes(target));
  assert.ok(res.includes("[... 26 lower-relevance paths omitted by tokenslash]"));
});


