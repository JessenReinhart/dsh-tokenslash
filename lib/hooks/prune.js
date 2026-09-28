// Prune hook for dsh-tokenslash
// Executes after tool execution (tools/post-execute) - pruning oversized output
const DEFAULT_COMPACT_LIMIT = 10000;

export function createPruneHook(ctx, jevClientOrGetter, configGetter, telemetry) {
  const getClient = typeof jevClientOrGetter === "function" ? jevClientOrGetter : () => jevClientOrGetter;

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
      const client = getClient();
      const compacted = await client.triage({
        compact: `Compact this tool output to preserve key facts under ${DEFAULT_COMPACT_LIMIT} chars:\n${str.slice(0, DEFAULT_COMPACT_LIMIT)}`,
      });
      const text = typeof compacted === "object" ? (compacted.compact || JSON.stringify(compacted)) : String(compacted);
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { pruned: true, summary: text };
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
