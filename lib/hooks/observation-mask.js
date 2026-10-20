// lib/hooks/observation-mask.js
// SWE-Pruner observation masking: replaces large tool results from older turns
// with deterministic stubs before each agent pre-step, preserving turn freshness
// so the model keeps full context on recent work while shedding stale bulk.

import { countText } from "../shared/tokenizer.js";

const DEFAULT_RETAIN_TURNS = 2;
const DEFAULT_MIN_CHARS = 800;

function numConfig(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function isUserMessage(msg) {
  return Boolean(msg && msg.role === "user");
}

function isToolResult(msg) {
  if (!msg || typeof msg !== "object") return false;
  return (
    msg.role === "tool" ||
    Boolean(msg.tool_call_id) ||
    msg.kind === "tool_result"
  );
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block.text === "string" ? block.text : ""))
      .join("\n");
  }
  return "";
}

function contentLength(content) {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) return extractText(content).length;
  return 0;
}

function toolNameOf(msg) {
  return msg.toolName || msg.name || msg.tool?.name || "tool";
}

function maskArrayContent(blocks, stub) {
  let placed = false;
  return blocks.map((block) => {
    if (block && typeof block === "object" && typeof block.text === "string") {
      const clone = { ...block };
      clone.text = placed ? "" : stub;
      placed = true;
      return clone;
    }
    return block;
  });
}

export function createObservationMaskHook(ctx, configGetter, telemetry) {
  return async function observationMaskHook(messages) {
    if (!Array.isArray(messages)) return messages;
    if (messages.length <= 2) return messages;

    const config = typeof configGetter === "function" ? configGetter() : configGetter;
    const enabled = config?.modules?.observationMasking ?? true;
    if (!enabled) return messages;

    const retainTurns = numConfig(config?.observationMaskRetainTurns ?? DEFAULT_RETAIN_TURNS, DEFAULT_RETAIN_TURNS);
    const minChars = numConfig(config?.observationMaskMinChars ?? DEFAULT_MIN_CHARS, DEFAULT_MIN_CHARS);

    // Assign turn indices from newest (0) to oldest, scanning newest to oldest.
    // A user message delineates a turn boundary: when walking backward past a
    // user message we enter the previous (older) turn.
    const turnIndexOf = new Array(messages.length);
    let turnIndex = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      turnIndexOf[i] = turnIndex;
      if (isUserMessage(messages[i])) turnIndex++;
    }

    const model = config?.model;
    const result = messages.slice();
    let totalSavedTokens = 0;
    let maskedCount = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const turn = turnIndexOf[i];
      // Keep the most recent `retainTurns` turns completely untouched.
      if (turn < retainTurns) continue;
      if (!isToolResult(msg)) continue;

      const length = contentLength(msg.content);
      if (length <= minChars) continue;

      const text = extractText(msg.content);
      const lines = text.length > 0 ? text.split("\n").length : 0;
      const chars = text.length;
      let estimatedTokens = 0;
      try {
        estimatedTokens = countText(text, model);
      } catch {
        estimatedTokens = Math.ceil(chars / 4);
      }

      const stub = `[output masked: tool "${toolNameOf(msg)}" (${lines} lines, ~${estimatedTokens} tokens) — result settled in prior turn]`;

      const masked = { ...msg };
      if (Array.isArray(msg.content)) {
        masked.content = maskArrayContent(msg.content, stub);
      } else {
        masked.content = stub;
      }

      result[i] = masked;
      maskedCount++;

      let stubTokens = 0;
      try {
        stubTokens = countText(stub, model);
      } catch {
        stubTokens = Math.ceil(stub.length / 4);
      }
      totalSavedTokens += Math.max(0, estimatedTokens - stubTokens);
    }

    if (telemetry && maskedCount > 0) {
      if (typeof telemetry.recordSaved === "function") {
        telemetry.recordSaved("observation-mask", totalSavedTokens);
      } else if (typeof telemetry.recordTokenSavings === "function") {
        telemetry.recordTokenSavings("observation-mask", totalSavedTokens);
      }
    }

    return result;
  };
}