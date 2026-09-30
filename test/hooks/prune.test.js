// test/hooks/prune.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPruneHook } from "../../lib/hooks/prune.js";
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
