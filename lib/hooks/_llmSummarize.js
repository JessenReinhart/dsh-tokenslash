// lib/hooks/_llmSummarize.js
// LLM-backed summarization for compaction/pruning (replaces Jev text summarization)
const LLM_SUMMARY_MAX_TOKENS = 2000;

export async function summarizeWithLLM(ctx, text, hint, options = {}) {
  const llm = ctx?.llm || (typeof ctx?.get === "function" ? ctx.get("llm") : null);
  if (!llm || typeof llm.stream !== "function") {
    throw new Error("ctx.llm not available for text summarization");
  }

  const prompt = hint ? `${hint}\n\n${text}` : text;
  const messages = [
    {
      role: "user",
      content: prompt,
    },
  ];

  const streamOpts = {
    messages,
    maxTokens: options.maxTokens || LLM_SUMMARY_MAX_TOKENS,
    ...(options.model ? { model: options.model } : {}),
    ...(options.provider ? { provider: options.provider } : {}),
  };

  let summary = "";
  for await (const chunk of llm.stream(streamOpts)) {
    if (!chunk) continue;
    if (typeof chunk === "string") {
      summary += chunk;
    } else if (typeof chunk.content === "string") {
      summary += chunk.content;
    } else if (chunk.type === "text-delta" && typeof chunk.text === "string") {
      summary += chunk.text;
    } else if (typeof chunk.text === "string") {
      summary += chunk.text;
    }
  }

  const trimmed = summary.trim();
  if (!trimmed) {
    throw new Error("Empty summary received from LLM");
  }
  return trimmed;
}

function truncateJSON(obj, maxChars = 10000) {
  if (typeof obj === "string") {
    return obj.length > 2000 ? obj.slice(0, 2000) + "... [truncated]" : obj;
  }
  if (Array.isArray(obj)) {
    if (obj.length > 20) {
      return [...obj.slice(0, 20).map((i) => truncateJSON(i, maxChars)), { _omitted_items: obj.length - 20 }];
    }
    return obj.map((i) => truncateJSON(i, maxChars));
  }
  if (obj && typeof obj === "object") {
    const result = {};
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === "string" && val.length > 2000) {
        result[key] = val.slice(0, 2000) + "... [truncated]";
      } else if (Array.isArray(val) && val.length > 20) {
        result[key] = [...val.slice(0, 20).map((i) => truncateJSON(i, maxChars)), { _omitted_items: val.length - 20 }];
      } else if (val && typeof val === "object") {
        result[key] = truncateJSON(val, maxChars);
      } else {
        result[key] = val;
      }
    }
    return result;
  }
  return obj;
}

export function structuralTruncate(str, maxChars = 10000) {
  if (typeof str !== "string") {
    try {
      str = JSON.stringify(str);
    } catch {
      str = String(str);
    }
  }
  if (str.length <= maxChars) return str;

  // JSON path
  try {
    const parsed = JSON.parse(str);
    const pruned = truncateJSON(parsed, maxChars);
    const serialized = JSON.stringify(pruned);
    if (serialized.length <= maxChars) return serialized;
  } catch {
    // raw text path
  }

  // Head + tail truncation fallback
  const half = Math.floor(maxChars / 2);
  const omitted = str.length - maxChars;
  return `${str.slice(0, half)}\n\n[... ${omitted} characters truncated by tokenslash ...]\n\n${str.slice(-half)}`;
}

export { LLM_SUMMARY_MAX_TOKENS };
