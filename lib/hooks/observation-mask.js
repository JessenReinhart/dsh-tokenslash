// lib/hooks/observation-mask.js
// SWE-Pruner observation masking: replaces large tool results from older turns
// with deterministic stubs before each agent pre-step, preserving turn freshness
// so the model keeps full context on recent work while shedding stale bulk.

import { countText } from "../shared/tokenizer.js";
import { triageBatch, clipState } from "../triage.js";

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

function isConfigObject(val) {
  if (!val || typeof val !== "object") return false;
  return (
    "modules" in val ||
    "observationMaskRetainTurns" in val ||
    "observationMaskMinChars" in val ||
    "modelTiers" in val ||
    "toolPruningMode" in val ||
    "enabled" in val ||
    "outputCompactLimit" in val
  );
}

function isConfigGetter(val) {
  if (!val) return false;
  if (isConfigObject(val)) return true;
  if (typeof val === "function") {
    try {
      const sample = val();
      if (isConfigObject(sample)) return true;
    } catch {}
  }
  return false;
}

function resolveHookArgs(jevClientOrGetter, configGetter, telemetry, promptTracker, argCount) {
  if (argCount >= 4) {
    return {
      jevClientOrGetter,
      configGetter,
      telemetry,
      promptTracker,
    };
  }

  // Handle argCount <= 3
  if (isConfigGetter(jevClientOrGetter)) {
    return {
      jevClientOrGetter: null,
      configGetter: jevClientOrGetter,
      telemetry: configGetter,
      promptTracker: telemetry,
    };
  }

  if (isConfigGetter(configGetter)) {
    return {
      jevClientOrGetter,
      configGetter,
      telemetry,
      promptTracker: undefined,
    };
  }

  return {
    jevClientOrGetter: null,
    configGetter: jevClientOrGetter,
    telemetry: configGetter,
    promptTracker: telemetry,
  };
}

export function createObservationMaskHook(ctx, jevClientOrGetter, configGetter, telemetry, promptTracker) {
  const resolved = resolveHookArgs(jevClientOrGetter, configGetter, telemetry, promptTracker, arguments.length);
  const resolvedJev = resolved.jevClientOrGetter;
  const resolvedConfigGetter = resolved.configGetter;
  const resolvedTelemetry = resolved.telemetry;
  const resolvedPromptTracker = resolved.promptTracker;

  const getJev = typeof resolvedJev === "function" ? resolvedJev : () => resolvedJev;

  return async function observationMaskHook(messages, agentId) {
    if (!Array.isArray(messages)) return messages;
    if (messages.length <= 2) return messages;

    const config = typeof resolvedConfigGetter === "function" ? resolvedConfigGetter() : resolvedConfigGetter;
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

    const candidateIndices = [];
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const turn = turnIndexOf[i];
      // Keep the most recent `retainTurns` turns completely untouched.
      if (turn < retainTurns) continue;
      if (!isToolResult(msg)) continue;
      if (contentLength(msg.content) <= minChars) continue;
      candidateIndices.push(i);
    }

    const result = messages.slice();
    if (candidateIndices.length === 0) return result;

    // Extract user prompt: from promptTracker (e.g. claimedPrompts.get(agentId)) or last user message in messages
    let userPrompt = "";
    const targetAgentId = typeof agentId === "string" ? agentId : agentId?.id || agentId;
    if (resolvedPromptTracker && targetAgentId) {
      if (typeof resolvedPromptTracker.get === "function") {
        userPrompt = resolvedPromptTracker.get(targetAgentId) || "";
      } else if (typeof resolvedPromptTracker === "function") {
        userPrompt = resolvedPromptTracker(targetAgentId) || "";
      } else if (typeof resolvedPromptTracker === "object") {
        userPrompt = resolvedPromptTracker[targetAgentId] || "";
      }
    }
    if (!userPrompt && Array.isArray(messages)) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (isUserMessage(messages[i])) {
          const content = messages[i].content;
          userPrompt = typeof content === "string" ? content : extractText(content);
          if (userPrompt) break;
        }
      }
    }

    const preservedSet = new Set();
    const client = getJev();
    const trimmedPrompt = typeof userPrompt === "string" ? userPrompt.trim() : "";

    if (client && typeof client.triage === "function" && trimmedPrompt) {
      const decisions = await Promise.all(
        candidateIndices.map(async (idx) => {
          const msg = messages[idx];
          try {
            const toolName = toolNameOf(msg);
            const toolOutput = extractText(msg.content);
            const state = `${clipState(trimmedPrompt, 400)}\nTool: ${toolName}\n${clipState(toolOutput, 400)}`;
            const res = await triageBatch(
              client,
              {
                relevant: {
                  type: "noul",
                  instructions:
                    "Is this prior tool output still actively referenced by or relevant to the current user task/prompt?",
                },
              },
              {
                state,
                model: config?.model,
                telemetry: resolvedTelemetry,
              }
            );
            const answer = res?.answers?.relevant ?? (res?.answers && Object.values(res.answers)[0]);
            const noulRaw = typeof answer === "object" && answer !== null ? answer.noul : answer;
            const noul = typeof noulRaw === "number" ? noulRaw : parseFloat(noulRaw);
            return Number.isFinite(noul) && noul >= 0.6;
          } catch {
            return false;
          }
        })
      );

      for (let j = 0; j < candidateIndices.length; j++) {
        if (decisions[j]) {
          preservedSet.add(candidateIndices[j]);
        }
      }
    }

    const model = config?.model;
    let totalSavedTokens = 0;
    let maskedCount = 0;

    for (const i of candidateIndices) {
      if (preservedSet.has(i)) continue;

      const msg = messages[i];
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

    if (resolvedTelemetry && maskedCount > 0) {
      if (typeof resolvedTelemetry.record === "function") {
        resolvedTelemetry.record("observation-mask", totalSavedTokens, { maskedCount });
      } else if (typeof resolvedTelemetry.recordSaved === "function") {
        resolvedTelemetry.recordSaved("observation-mask", totalSavedTokens);
      } else if (typeof resolvedTelemetry.recordTokenSavings === "function") {
        resolvedTelemetry.recordTokenSavings("observation-mask", totalSavedTokens);
      }
    }

    return result;
  };
}
