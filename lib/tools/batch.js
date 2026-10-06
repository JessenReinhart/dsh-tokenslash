// lib/tools/batch.js
// Batch tool execution for dsh-tokenslash, inspired by Maki.
// Executes multiple independent tool calls in a single turn, eliminating
// multi-turn context re-send round trips.

export const MAX_BATCH_CALLS = 15;

/**
 * Strip provider/harness namespaces the model may copy verbatim from the
 * native tool-call payload (e.g. "functions.pwsh", "default_api:pwsh").
 * DSH registers tools under bare names, so lookup must match those.
 */
export function normalizeToolName(name) {
  if (typeof name !== "string") return "";
  return name.trim().replace(/^(?:functions\.|tools\.|default_api:|functions:)/i, "");
}

/**
 * Normalize one batch entry to { tool, args }. Accepts the shapes models
 * actually emit: { tool, args }, { name, arguments }, { function: { name, arguments } },
 * and even a bare tool-name string. Stringified args are JSON-parsed.
 */
export function normalizeBatchCall(call) {
  if (typeof call === "string") return { tool: normalizeToolName(call), args: {} };
  const fn = call?.function;
  let rawName = call?.tool ?? call?.name ?? fn?.name ?? "";
  let args = call?.args ?? call?.arguments ?? call?.input ?? fn?.arguments ?? {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  if (args === null || typeof args !== "object" || Array.isArray(args)) args = {};
  return { tool: normalizeToolName(rawName), args };
}

/**
 * Execute a batch of tool calls against the scoped tool registry.
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

  const scope = toolCtx?.agent ?? toolCtx?.scope;
  const results = [];

  const promises = calls.map(async (rawCall, index) => {
    const startTime = Date.now();
    const { tool: toolName, args } = normalizeBatchCall(rawCall);

    if (!toolName) {
      return {
        index,
        tool: "",
        success: false,
        error: "Missing tool name in batch call entry",
        durationMs: 0,
      };
    }

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

    // 2. Resolve tool from context with scope fallback
    let tool;
    if (typeof ctx?.tools?.get === "function") {
      if (scope) {
        tool = ctx.tools.get(toolName, scope);
      }
      if (!tool) {
        tool = ctx.tools.get(toolName);
      }
    }
    if (!tool && typeof ctx?.tools?.resolveExecution === "function") {
      tool = ctx.tools.resolveExecution(toolName, scope, true);
    }

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
      const callExec = toolCtx ? { ...toolCtx, name: toolName, arguments: args } : undefined;
      const res = await tool.execute(args, callExec);
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
