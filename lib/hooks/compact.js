// Compact hook for dsh-tokenslash
// Executes during prompt assembly (system-prompt/assemble) - compact oversized conversation context
import { summarizeWithLLM } from "./_llmSummarize.js";
import { countTokens, countText, isBpeActive } from "../shared/tokenizer.js";

const COMPACT_THRESHOLD = 8000;

export function createCompactHook(ctx, _jevClientOrGetter, configGetter, telemetry) {
  return async function compactHook(messages) {
    if (!Array.isArray(messages)) return messages;
    const totalChars = messages.reduce((acc, m) => acc + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content || "").length), 0);
    // Conservative char pre-gate: skip only when definitely under threshold to avoid tokenising every step
    if (totalChars / 3 < COMPACT_THRESHOLD) return messages;
    try {
      const config = typeof configGetter === "function" ? configGetter() : configGetter;
      const cheapModel = config?.modelTiers?.cheap ? config.modelTiers.cheap.split(",")[0].trim() : undefined;
      const joined = messages.map((m) => `${m.role || "user"}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n").slice(0, 40000);
      const tokensBefore = countText(joined, cheapModel);
      if (tokensBefore <= COMPACT_THRESHOLD) return messages;

      const disableThinking = config?.disableCheapThinking !== false;
      const summary = await summarizeWithLLM(
        ctx,
        joined,
        "Compact this conversation context preserving key facts:",
        cheapModel
          ? { model: cheapModel, ...(disableThinking ? { reasoningEffort: "off" } : {}) }
          : (disableThinking ? { reasoningEffort: "off" } : {})
      );
      const lastMessage = messages[messages.length - 1];
      const tokensAfter = countText(summary, cheapModel) + countTokens(lastMessage, cheapModel);
      const savedTokens = Math.max(0, tokensBefore - tokensAfter);
      const tokenizerMode = isBpeActive() ? "bpe" : "fallback";

      telemetry?.recordOutputCompact?.(savedTokens, {
        toolName: "context_compaction",
        originalTokens: tokensBefore,
        compactedTokens: tokensAfter,
        tokenizerMode,
      });

      return [{ role: "system", content: `Compacted context summary:\n${summary}` }, lastMessage];
    } catch {
      return messages;
    }
  };
}
