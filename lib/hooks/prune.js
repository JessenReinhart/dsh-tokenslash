// Prune hook for dsh-tokenslash
// Executes after tool execution (tools/post-execute) - pruning oversized output
import { summarizeWithLLM, structuralTruncate } from "./_llmSummarize.js";
import { countTokens, isBpeActive } from "../shared/tokenizer.js";

const DEFAULT_COMPACT_LIMIT = 4000;
const DISTILL_MIN_LENGTH = 500;

/**
 * Deterministic output distillation — strips noise from tool output text
 * to reduce token waste without changing semantic content.
 * Pure regex/string ops, no LLM calls.
 */
export function distillOutput(text) {
  if (typeof text !== "string") return text;

  let s = text;

  // 1. Strip ANSI escape sequences (color/style codes and OSC sequences)
  s = s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  s = s.replace(/\x1b\][^\x07]*\x07/g, "");

  // 6. Remove common npm/yarn/pnpm noise lines
  const npmNoisePatterns = [
    /^\[[\d/]+\]\s+(Resolving|Fetching|Linking|Building)\s+.*\.{3}\s*$/,
    /^(info|notice)\s+(No lockfile|Resolving|Fetching|Linking|Building)\b.*$/,
    /^Done in \d+(\.\d+)?s\.?\s*$/,
    /^npm warn\b.*$/,
    /^added \d+ packages?\b.*$/,
    /^\d+ packages? are looking for funding\b.*$/,
    /^run `npm fund` for details\s*$/,
    /^✨\s+Done in \d+.*$/,
    /^Packages:\s*\+\d+\s*$/,
    /^\+{3}\s*$/,
    /^Progress: resolved \d+.*$/,
  ];

  let lines = s.split("\n");

  // 2. Carriage return overwrites — keep only the final state after \r
  lines = lines.map((line, idx) => {
    if (line.includes("\r")) {
      // Split by \r, take the last non-empty segment
      const parts = line.split("\r");
      return parts[parts.length - 1];
    }
    return line;
  });

  // 6. (continued) Filter npm/yarn/pnpm noise lines
  lines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed) return true; // keep blank lines for now
    return !npmNoisePatterns.some(pat => pat.test(trimmed));
  });

  // 3. Collapse 3+ consecutive identical lines (skipping blank lines so Rule 5 handles them)
  const collapsed = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === "") {
      collapsed.push(lines[i]);
      i++;
      continue;
    }
    let runLen = 1;
    while (i + runLen < lines.length && lines[i + runLen] === lines[i]) {
      runLen++;
    }
    collapsed.push(lines[i]);
    if (runLen >= 3) {
      collapsed.push(`[... repeated ${runLen - 1} more times]`);
    } else {
      for (let j = 1; j < runLen; j++) {
        collapsed.push(lines[i + j]);
      }
    }
    i += runLen;
  }
  lines = collapsed;

  // 4. Collapse 5+ consecutive similar lines
  const similarPatterns = [
    /^\s*(PASS|FAIL)\s/,
    /^\s*warning:\s/i,
    /^\s*[✓✔]\s/,
    /^\s*\d+[.)]\s/,
    /^\s*[-*]\s/,
  ];

  function getSimilarityKey(line) {
    for (const pat of similarPatterns) {
      if (pat.test(line)) return pat.source;
    }
    return null;
  }

  const similarCollapsed = [];
  i = 0;
  while (i < lines.length) {
    const key = getSimilarityKey(lines[i]);
    if (key !== null) {
      let runLen = 1;
      while (
        i + runLen < lines.length &&
        getSimilarityKey(lines[i + runLen]) === key
      ) {
        runLen++;
      }
      if (runLen >= 5) {
        similarCollapsed.push(lines[i]);
        similarCollapsed.push(lines[i + 1]);
        similarCollapsed.push(`[... ${runLen - 3} similar lines omitted]`);
        similarCollapsed.push(lines[i + runLen - 1]);
      } else {
        for (let j = 0; j < runLen; j++) {
          similarCollapsed.push(lines[i + j]);
        }
      }
      i += runLen;
    } else {
      similarCollapsed.push(lines[i]);
      i++;
    }
  }
  lines = similarCollapsed;

  // 5. Strip trailing whitespace per line
  lines = lines.map(line => line.trimEnd());

  // 5. Collapse 3+ consecutive blank lines to 2
  const finalLines = [];
  let blankCount = 0;
  for (const line of lines) {
    if (line === "") {
      blankCount++;
      if (blankCount <= 2) {
        finalLines.push(line);
      }
    } else {
      blankCount = 0;
      finalLines.push(line);
    }
  }

  return finalLines.join("\n");
}

export function createPruneHook(ctx, _jevClientOrGetter, configGetter, telemetry, nativeServices = null) {
  // If host provides native tool-result pruner (DSH >= 0.2.0), yield to
  // the deterministic head/middle/tail pruner and avoid double-pruning.
  if (nativeServices?.nativeToolResultPruner) {
    return async function nativePassthroughPruneHook(execOrTool, result, next) {
      return typeof next === "function" ? next() : result;
    };
  }

  return async function pruneHook(execOrTool, result, next) {
    const config = typeof configGetter === "function" ? configGetter() : configGetter;
    const mode = (config?.toolPruningMode || config?.modules?.toolPruningMode || "normal").toLowerCase();
    const compactLimit = Number(config?.outputCompactLimit) > 0 ? Number(config.outputCompactLimit) : DEFAULT_COMPACT_LIMIT;

    // Skip if disabled or outputCompacting off
    if (config && (!config.enabled || mode === "off" || config.modules?.outputCompacting === false)) {
      return typeof next === "function" ? next() : result;
    }

    const isWaterfall = typeof next === "function" || (result !== undefined && typeof result === "object" && "kind" in result);
    let targetVal = isWaterfall ? (result?.value ?? result?.content) : result;

    if (!targetVal || (typeof targetVal !== "object" && typeof targetVal !== "string")) {
      return isWaterfall ? (typeof next === "function" ? next() : { kind: "accept" }) : result;
    }

    // Deterministic output distillation: strip noise, ANSI, overwrites from long text output
    if (typeof targetVal === "string" && targetVal.length > DISTILL_MIN_LENGTH) {
      const distilled = distillOutput(targetVal);
      if (distilled !== targetVal) {
        targetVal = distilled;
        if (result && typeof result === "object") {
          if ("value" in result) result.value = distilled;
          else if ("content" in result && typeof result.content === "string") result.content = distilled;
        } else if (typeof result === "string") {
          result = distilled;
        }
      }
    }

    const str = typeof targetVal === "string" ? targetVal : JSON.stringify(targetVal);
    if (str.length <= compactLimit) {
      return isWaterfall ? (typeof next === "function" ? next() : { kind: "accept" }) : result;
    }

    const originalLength = str.length;
    try {
      // llm is declared in plugin inject; plain test contexts may expose it directly
      const llm = ctx?.llm || (typeof ctx?.get === "function" ? ctx.get("llm") : null);
      let compactedStr;
      const cheapModel = config?.modelTiers?.cheap ? config.modelTiers.cheap.split(",")[0].trim() : undefined;
      const disableThinking = config?.disableCheapThinking !== false;
      if (llm && typeof llm.stream === "function") {
        try {
          compactedStr = await summarizeWithLLM(
            ctx,
            str,
            `Compact this tool output to preserve key facts under ${compactLimit} chars:`,
            cheapModel
              ? { model: cheapModel, ...(disableThinking ? { reasoningEffort: "off" } : {}) }
              : (disableThinking ? { reasoningEffort: "off" } : {})
          );
        } catch {
          compactedStr = structuralTruncate(str, compactLimit);
        }
      } else {
        compactedStr = structuralTruncate(str, compactLimit);
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
