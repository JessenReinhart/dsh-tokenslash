// Compact hook for dsh-tokenslash
// Executes during prompt assembly (system-prompt/assemble) - compact oversized conversation context
import { summarizeWithLLM } from "./_llmSummarize.js";
import { countTokens, countText, isBpeActive } from "../shared/tokenizer.js";
import { triageBatch, clipState } from "../triage.js";

const COMPACT_THRESHOLD = 8000;

/**
 * Jev gatekeeper for oversized tool output: decides whether to pass, mask, or distill.
 * @param {object|function} jevClient - JevClient instance or getter
 * @param {object} observation - { toolName, output, thresholdTokens }
 * @param {object} [config]
 * @returns {Promise<{ action: string }>}
 */
export async function classifyObservation(jevClient, { toolName, output, thresholdTokens } = {}, config = {}) {
  const text = typeof output === "string" ? output : output == null ? "" : JSON.stringify(output);
  const tokens = countText(text, config?.model);
  if (tokens < thresholdTokens) {
    return { action: "pass" };
  }

  try {
    const res = await triageBatch(
      jevClient,
      {
        action: {
          type: "choice",
          instructions: "Determine how to handle oversized tool output",
          criteria: {
            pass: "Dense code, error traces, or diffs needed verbatim",
            mask: "Repetitive logs, build output, or terminal spam for line masking",
            distill: "Long narrative or redundant data for structural extraction",
          },
        },
      },
      {
        state: `${toolName}\n${clipState(text, 800)}`,
        model: config?.model,
      }
    );

    const answer = res?.answers?.action;
    const choice = typeof answer === "object" ? answer?.choice ?? "pass" : String(answer ?? "pass");
    const lower = choice.toLowerCase();
    if (["pass", "mask", "distill"].includes(lower)) {
      return { action: lower };
    }
    return { action: "pass" };
  } catch {
    return { action: "pass" };
  }
}

export function createCompactHook(ctx, _jevClientOrGetter, configGetter, telemetry, nativeServices = null) {
  // If host provides native compaction (DSH >= 0.2.0), yield to host engine
  // to avoid corrupting tool-call/result pairing invariants.
  if (nativeServices?.compaction) {
    return async function nativePassthroughCompactHook(messages) {
      return messages;
    };
  }

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
