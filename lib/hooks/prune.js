// Prune hook for dsh-tokenslash
// Executes after tool execution (tools/post-execute) - pruning oversized output
import { summarizeWithLLM, structuralTruncate } from "./_llmSummarize.js";
import { countTokens, isBpeActive } from "../shared/tokenizer.js";

const DEFAULT_COMPACT_LIMIT = 10000;

export function createPruneHook(ctx, _jevClientOrGetter, configGetter, telemetry) {
  return async function pruneHook(execOrTool, result, next) {
    const config = typeof configGetter === "function" ? configGetter() : configGetter;
    const mode = (config?.toolPruningMode || config?.modules?.toolPruningMode || "normal").toLowerCase();

    // Skip if disabled or outputCompacting off
    if (config && (!config.enabled || mode === "off" || config.modules?.outputCompacting === false)) {
      return typeof next === "function" ? next() : result;
    }

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
      // llm is declared in plugin inject; plain test contexts may expose it directly
      const llm = ctx?.llm || (typeof ctx?.get === "function" ? ctx.get("llm") : null);
      let compactedStr;
      const cheapModel = config?.modelTiers?.cheap ? config.modelTiers.cheap.split(",")[0].trim() : undefined;
      if (llm && typeof llm.stream === "function") {
        try {
          compactedStr = await summarizeWithLLM(
            ctx,
            str,
            `Compact this tool output to preserve key facts under ${DEFAULT_COMPACT_LIMIT} chars:`,
            cheapModel ? { model: cheapModel } : {}
          );
        } catch {
          compactedStr = structuralTruncate(str, DEFAULT_COMPACT_LIMIT);
        }
      } else {
        compactedStr = structuralTruncate(str, DEFAULT_COMPACT_LIMIT);
      }

      // Build content block array for DSH output
      const content = [{ type: "text", text: compactedStr }];

      const compactedLength = JSON.stringify(content).length;
      const originalTokens = countTokens(str, cheapModel);
      const compactedTokens = countTokens(compactedStr, cheapModel);
      const savedTokens = Math.max(0, originalTokens - compactedTokens);
      telemetry?.recordOutputCompact?.(savedTokens, {
        toolName: execOrTool?.name || execOrTool?.tool?.name || "unknown",
        originalTokens,
        compactedTokens,
        originalChars: originalLength,
        compactedChars: compactedLength,
        tokenizerMode: isBpeActive() ? "bpe" : "fallback",
      });

      return isWaterfall ? { kind: "accept", content } : content;
    } catch {
      return isWaterfall ? (typeof next === "function" ? next() : { kind: "accept" }) : result;
    }
  };
}
