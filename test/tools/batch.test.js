import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { executeBatch, MAX_BATCH_CALLS } from "../../lib/tools/batch.js";

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
});