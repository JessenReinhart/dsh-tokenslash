import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  executeBatch,
  MAX_BATCH_CALLS,
  normalizeToolName,
  normalizeBatchCall,
} from "../../lib/tools/batch.js";

function makeCtx(tools) {
  return {
    tools: {
      get: (name) => tools[name] || null,
    },
  };
}

describe("tokenslash_batch", () => {
  test("executes multiple tools concurrently and returns results", async () => {
    const ctx = makeCtx({
      read: { execute: async (args) => `read:${args.path}` },
      grep: { execute: async (args) => `grep:${args.pattern}` },
      write: {
        execute: async (args) => {
          if (args.fail) throw new Error("write failed");
          return `write:${args.path}`;
        },
      },
    });

    const res = await executeBatch(
      [
        { tool: "read", args: { path: "a.js" } },
        { tool: "grep", args: { pattern: "foo" } },
        { tool: "write", args: { path: "b.js", fail: true } },
      ],
      ctx,
      { agent: { id: "agent-1" } }
    );

    assert.equal(res.count, 3);
    assert.equal(res.successful, 2);
    assert.equal(res.failed, 1);
    assert.equal(res.results[0].tool, "read");
    assert.equal(res.results[0].result, "read:a.js");
    assert.equal(res.results[2].tool, "write");
    assert.equal(res.results[2].success, false);
    assert.match(res.results[2].error, /write failed/);
  });

  test("isolates failures so other calls succeed", async () => {
    let writeRan = false;
    const ctx = makeCtx({
      read: { execute: async () => { throw new Error("read boom"); } },
      write: { execute: async () => { writeRan = true; return "ok"; } },
    });

    const res = await executeBatch(
      [
        { tool: "read", args: {} },
        { tool: "write", args: {} },
      ],
      ctx
    );

    assert.equal(res.successful, 1);
    assert.equal(res.failed, 1);
    assert.equal(writeRan, true);
  });

  test("rejects recursive tokenslash_batch calls", async () => {
    const ctx = makeCtx({
      tokenslash_batch: { execute: async () => "recursive" },
    });

    const res = await executeBatch([{ tool: "tokenslash_batch", args: { calls: [] } }], ctx);
    assert.equal(res.failed, 1);
    assert.match(res.results[0].error, /Recursive tokenslash_batch/);
  });

  test("rejects non-array and empty inputs", async () => {
    const ctx = makeCtx({});
    await assert.rejects(() => executeBatch(null, ctx));
    await assert.rejects(() => executeBatch({ tool: "read" }, ctx));

    const empty = await executeBatch([], ctx);
    assert.equal(empty.count, 0);
  });

  test("enforces max batch calls limit", async () => {
    const ctx = makeCtx({});
    const tooMany = Array.from({ length: MAX_BATCH_CALLS + 1 }, () => ({ tool: "read", args: {} }));
    await assert.rejects(() => executeBatch(tooMany, ctx), /Exceeded maximum batch calls/);
  });

  test("handles missing tools gracefully", async () => {
    const ctx = makeCtx({});
    const res = await executeBatch([{ tool: "nonexistent", args: {} }], ctx);
    assert.equal(res.failed, 1);
    assert.match(res.results[0].error, /not found/);
  });

  test("strips namespaces and handles function-calling aliases", async () => {
    assert.equal(normalizeToolName("functions.pwsh"), "pwsh");
    assert.equal(normalizeToolName("default_api:skill"), "skill");
    assert.equal(normalizeToolName("tools.read"), "read");
    assert.equal(normalizeToolName("functions:grep"), "grep");
    assert.equal(normalizeToolName("  pwsh  "), "pwsh");

    const norm1 = normalizeBatchCall({ name: "functions.pwsh", arguments: '{"command":"ls"}' });
    assert.equal(norm1.tool, "pwsh");
    assert.deepEqual(norm1.args, { command: "ls" });

    const norm2 = normalizeBatchCall({ function: { name: "default_api:skill", arguments: { name: "test" } } });
    assert.equal(norm2.tool, "skill");
    assert.deepEqual(norm2.args, { name: "test" });
  });

  test("resolves tools using agent scope when present", async () => {
    const scopedTools = {
      skill: { execute: async (args) => `skill:${args.name}` },
    };
    const ctx = {
      tools: {
        get: (name, scope) => {
          if (scope && scope.id === "agent-active") {
            return scopedTools[name] || null;
          }
          return null; // not in global view
        },
      },
    };

    const res = await executeBatch(
      [
        { tool: "functions.skill", args: { name: "tokenslash-workflow" } },
      ],
      ctx,
      { agent: { id: "agent-active" } }
    );

    assert.equal(res.count, 1);
    assert.equal(res.successful, 1);
    assert.equal(res.results[0].tool, "skill");
    assert.equal(res.results[0].result, "skill:tokenslash-workflow");
  });

  test("mode: series executes calls sequentially in order", async () => {
    const order = [];
    const ctx = makeCtx({
      first: { execute: async () => { await new Promise((r) => setTimeout(r, 20)); order.push("first"); return "first"; } },
      second: { execute: async () => { order.push("second"); return "second"; } },
      third: { execute: async () => { order.push("third"); return "third"; } },
    });

    const res = await executeBatch(
      [
        { tool: "first", args: {} },
        { tool: "second", args: {} },
        { tool: "third", args: {} },
      ],
      ctx,
      undefined,
      { mode: "series" }
    );

    assert.deepEqual(order, ["first", "second", "third"]);
    assert.equal(res.count, 3);
    assert.equal(res.successful, 3);
    assert.deepEqual(res.results.map((r) => r.result), ["first", "second", "third"]);
  });

  test("mode: series isolates failures and continues with remaining calls", async () => {
    const order = [];
    const ctx = makeCtx({
      boom: { execute: async () => { order.push("boom"); throw new Error("boom failed"); } },
      ok: { execute: async () => { order.push("ok"); return "ok"; } },
      after: { execute: async () => { order.push("after"); return "after"; } },
    });

    const res = await executeBatch(
      [
        { tool: "boom", args: {} },
        { tool: "ok", args: {} },
        { tool: "after", args: {} },
      ],
      ctx,
      undefined,
      { mode: "series" }
    );

    assert.deepEqual(order, ["boom", "ok", "after"]);
    assert.equal(res.successful, 2);
    assert.equal(res.failed, 1);
    assert.equal(res.results[0].success, false);
    assert.match(res.results[0].error, /boom failed/);
    assert.equal(res.results[2].result, "after");
  });

  test("omitted mode defaults to parallel", async () => {
    const runs = [];
    const ctx = makeCtx({
      a: { execute: async () => { runs.push("a-start"); await new Promise((r) => setTimeout(r, 20)); runs.push("a-end"); return "a"; } },
      b: { execute: async () => { runs.push("b-start"); await new Promise((r) => setTimeout(r, 5)); runs.push("b-end"); return "b"; } },
    });

    const res = await executeBatch(
      [{ tool: "a", args: {} }, { tool: "b", args: {} }],
      ctx
    );

    assert.equal(res.count, 2);
    assert.equal(res.successful, 2);
    // Both calls start before either finishes (parallel, default mode) —
    // demonstrates the default is not sequential.
    assert.equal(runs[0], "a-start");
    assert.equal(runs[1], "b-start");
  });
});