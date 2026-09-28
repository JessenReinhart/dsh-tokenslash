// Compact hook for dsh-tokenslash
// Executes during prompt assembly (system-prompt/assemble) - compact oversized conversation context
import { summarizeWithLLM } from "./_llmSummarize.js";

const COMPACT_THRESHOLD = 8000;

export function createCompactHook(ctx, _jevClientOrGetter) {
  return async function compactHook(messages) {
    if (!Array.isArray(messages)) return messages;
    const totalChars = messages.reduce((acc, m) => acc + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content || "").length), 0);
    const approxTokens = totalChars / 4;
    if (approxTokens <= COMPACT_THRESHOLD) return messages;
    try {
      const joined = messages.map((m) => `${m.role || "user"}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n").slice(0, 40000);
      const summary = await summarizeWithLLM(ctx, joined, "Compact this conversation context preserving key facts:");
      return [{ role: "system", content: `Compacted context summary:\n${summary}` }, messages[messages.length - 1]];
    } catch {
      return messages;
    }
  };
}
