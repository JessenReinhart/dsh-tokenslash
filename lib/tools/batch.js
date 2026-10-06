// lib/tools/batch.js
// Batch tool execution for dsh-tokenslash, inspired by Maki.
// Executes multiple independent tool calls in a single turn, eliminating
// multi-turn context re-send round trips.

export const MAX_BATCH_CALLS = 15;

/**
 * Execute a batch of tool calls against ctx.tools
 */
export async function executeBatch(calls, ctx, toolCtx) {
  if (!Array.isArray(calls)) {
    throw new Error("calls must be an array of tool invocations");
  }

  if (calls.length === 0) {
    return { count: 0, results: [] };
  }

  if (calls.length > MAX_BATCH_CALLS) {
    throw new Error(`Exceeded maximum batch calls limit of ${MAX_BATCH_CALLS} (received ${calls.length})`);
  }

  const results = [];

  const promises = calls.map(async (call, index) => {
    const startTime = Date.now();
    const toolName = call?.tool;
    const args = call?.args || {};

    // 1. Guard against recursive batches
    if (toolName === "tokenslash_batch") {
      return {
        index,
        tool: toolName,
        success: false,
        error: "Recursive tokenslash_batch calls are disallowed",
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Resolve tool from context
    const tool = ctx?.tools?.get?.(toolName);
    if (!tool || typeof tool.execute !== "function") {
      return {
        index,
        tool: toolName,
        success: false,
        error: `Tool '${toolName}' not found or not executable`,
        durationMs: Date.now() - startTime,
      };
    }

    // 3. Execute tool with isolated error handling
    try {
      const res = await tool.execute(args, toolCtx);
      return {
        index,
        tool: toolName,
        success: true,
        result: res,
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      return {
        index,
        tool: toolName,
        success: false,
        error: err?.message || String(err),
        durationMs: Date.now() - startTime,
      };
    }
  });

  const settled = await Promise.allSettled(promises);
  for (const s of settled) {
    if (s.status === "fulfilled") {
      results.push(s.value);
    } else {
      results.push({
        index: results.length,
        tool: "unknown",
        success: false,
        error: s.reason?.message || "Execution rejected",
        durationMs: 0,
      });
    }
  }

  // Sort by original invocation index
  results.sort((a, b) => a.index - b.index);

  return {
    count: results.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  };
}

export default { executeBatch, MAX_BATCH_CALLS };
