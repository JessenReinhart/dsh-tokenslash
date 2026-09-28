// Prune hook for dsh-tokenslash
// Executes after tool execution (tools/post-execute) - pruning oversized output
import { summarizeWithLLM, structuralTruncate } from "./_llmSummarize.js";

const DEFAULT_COMPACT_LIMIT = 10000;

export function createPruneHook(ctx, _jevClientOrGetter, configGetter, telemetry) {
  return async function pruneHook(execOrTool, result, next) {
    const config = typeof configGetter === "function" ? configGetter() : configGetter;
    const mode = (config?.toolPruningMode || config?.modules?.toolPruningMode || "normal").toLowerCase();

    // Respect outputCompacting flag (not toolPruning)
    if (config && (!config.enabled || mode === "off" || config.modules?.outputCompacting === false)) {
      return typeof next === "function" ? next() : result;
    }

    // Support both DSH lifecycle waterfall signature (exec, result, next) and legacy unit tests (tool, result)
    const isWaterfall = typeof next === "function" || (result !== undefined && typeof result === "object" && "kind" in result);
    const targetVal = isWaterfall ? (result?.value ?? result?.content) : result;

    if (!targetVal || (typeof targetVal !== "object" && typeof targetVal !== "string")) {
      return isWaterfall ? (typeof next === "function" ? next() : { kind: "accept" }) : result;
    }

    const str = typeof targetVal === "string" ? targetVal : JSON.stringify(targetVal);
    if (str.length <= DEFAULT_COMPACT_LIMIT) {
      return isWaterfall ? (typeof next === "function" ? next() : { kind: "accept" }) : result;
    }

    const originalLength = str.length;
    try {
      let parsed;
      const llm = ctx?.llm || (typeof ctx?.get === "function" ? ctx.get("llm") : null);

      if (llm && typeof llm.stream === "function") {
        // LLM path: try semantic summarization
        let compactedStr;
        try {
          compactedStr = await summarizeWithLLM(ctx, str, `Compact this tool output to preserve key facts under ${DEFAULT_COMPACT_LIMIT} chars:`);
        } catch {
          // LLM threw after being available — structural fallback
          compactedStr = structuralTruncate(str, DEFAULT_COMPACT_LIMIT);
        }
        try {
          parsed = JSON.parse(compactedStr);
        } catch {
          parsed = { pruned: true, summary: compactedStr };
        }
      } else {
        // No LLM available: deterministic structural truncation
        const truncated = structuralTruncate(str, DEFAULT_COMPACT_LIMIT);
        parsed = { pruned: true, summary: truncated };
      }

      // Record telemetry for saved tokens
      const compactedLength = JSON.stringify(parsed).length;
      const savedTokens = Math.max(0, Math.round((originalLength - compactedLength) / 4));
      telemetry?.recordOutputCompact?.(savedTokens, {
        toolName: execOrTool?.name || execOrTool?.tool?.name || "unknown",
        originalChars: originalLength,
        compactedChars: compactedLength,
      });

      return isWaterfall ? { kind: "accept", value: parsed } : parsed;
    } catch {
      return isWaterfall ? (typeof next === "function" ? next() : { kind: "accept" }) : result;
    }
  };
}
