// Prune hook for dsh-tokenslash
// Executes after tool execution (tools/post-execute)
const DEFAULT_COMPACT_LIMIT = 10000;

export function createPruneHook(ctx, jevClient, configGetter) {
  return async function pruneHook(execOrTool, result, next) {
    const config = typeof configGetter === "function" ? configGetter() : configGetter;
    const mode = (config?.toolPruningMode || config?.modules?.toolPruningMode || "normal").toLowerCase();
    if (config && (!config.enabled || mode === "off" || config.modules?.toolPruning === false)) {
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

    try {
      const compacted = await jevClient.triage({
        compact: `Compact this tool output to preserve key facts under ${DEFAULT_COMPACT_LIMIT} chars:\n${str.slice(0, DEFAULT_COMPACT_LIMIT)}`,
      });
      const text = typeof compacted === "object" ? (compacted.compact || JSON.stringify(compacted)) : String(compacted);
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { pruned: true, summary: text };
      }
      return isWaterfall ? { kind: "accept", value: parsed } : parsed;
    } catch {
      return isWaterfall ? (typeof next === "function" ? next() : { kind: "accept" }) : result;
    }
  };
}
