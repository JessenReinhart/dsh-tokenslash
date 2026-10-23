// Prune hook for dsh-tokenslash
// Executes after tool execution (tools/post-execute) - pruning oversized output
import { summarizeWithLLM, structuralTruncate } from "./_llmSummarize.js";
import { countTokens, isBpeActive } from "../shared/tokenizer.js";
import { classifyObservation } from "./compact.js";
import { classifyTestFailure } from "../tools/diagnose.js";

const DEFAULT_COMPACT_LIMIT = 4000;
const DISTILL_MIN_LENGTH = 500;

const SHELL_TOOLS = new Set(["pwsh", "bash"]);
const TEST_FAILURE_RE = /\b(fail|failed|failure|failing tests?|assertionerror|assert\.(equal|strictequal|deepequal|notdeepequal|match|ok)|✖|✗|not ok\s)\b/i;
const DIAGNOSE_ADVICE = {
  flaky: "transient flake detected, safe to retry",
  assertion: "expected vs actual mismatch; inspect diff",
  compilation: "fix syntax, import, or type error before retry",
  environment: "check environment, permissions, or binary on PATH",
};

const RANK_TOOLS = new Set(["glob", "grep"]);
const RANK_MAX_CANDIDATES = 30;
const RANK_TOP_K = 10;
const RANK_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "using", "across",
  "where", "which", "what", "when", "while", "under", "over", "between", "about",
  "after", "before", "could", "should", "would", "will", "can", "not", "are", "was",
  "were", "been", "have", "has", "had", "does", "did", "doing", "them", "they", "their",
  "find", "search", "list", "show", "file", "files", "path", "paths", "please",
]);

function rankToolName(execOrTool) {
  const raw = String(execOrTool?.name || execOrTool?.tool?.name || "").trim();
  const base = (raw.split(/[.:]/).pop() || "").toLowerCase();
  return RANK_TOOLS.has(base) ? base : "";
}

function getRankPrompt(ctx, execOrTool, promptTracker) {
  if (typeof promptTracker === "string" && promptTracker.trim()) return promptTracker.trim();
  const agent = ctx?.agent || execOrTool?.agent;
  const agentId = (agent && typeof agent === "object" ? agent.id : undefined) ?? execOrTool?.id ?? ctx?.id;

  if (promptTracker) {
    let tracked;
    if (typeof promptTracker === "function") {
      try {
        tracked = agentId !== undefined ? promptTracker(agentId) : promptTracker(agent || execOrTool);
      } catch {
        tracked = undefined;
      }
    } else if (typeof promptTracker.get === "function") {
      if (agentId !== undefined) {
        tracked = promptTracker.get(agentId);
      }
      if (tracked === undefined && agent) {
        tracked = promptTracker.get(agent);
      }
    } else if (typeof promptTracker === "object") {
      if (agentId !== undefined) {
        tracked = promptTracker[agentId];
      }
    }
    if (typeof tracked === "string" && tracked.trim()) return tracked.trim();
    if (tracked && typeof tracked.prompt === "string" && tracked.prompt.trim()) return tracked.prompt.trim();
  }

  if (typeof execOrTool?.userPrompt === "string" && execOrTool.userPrompt.trim()) return execOrTool.userPrompt.trim();
  if (typeof execOrTool?.prompt === "string" && execOrTool.prompt.trim()) return execOrTool.prompt.trim();
  if (typeof agent?.prompt === "string" && agent.prompt.trim()) return agent.prompt.trim();
  if (typeof ctx?.userPrompt === "string" && ctx.userPrompt.trim()) return ctx.userPrompt.trim();
  return "";
}

function rankTokens(prompt) {
  if (typeof prompt !== "string") return [];
  return (prompt.toLowerCase().match(/[a-z0-9+.#/-]+/g) || [])
    .filter((tok) => tok.length >= 3 && !RANK_STOPWORDS.has(tok));
}

function rankCandidateScore(candidate, tokens) {
  if (!tokens.length) return 0;
  const leaf = String(candidate).trim();
  if (!leaf) return 0;
  const lower = leaf.toLowerCase();
  const basename = (leaf.split(/[/\\]/).pop() || "").toLowerCase();
  const noExt = basename.replace(/\.[^.]+$/, "").toLowerCase();
  const segments = lower.split(/[/\\]/);
  let score = 0;
  for (const tok of tokens) {
    if (basename === tok || noExt === tok) score += 10;
    else if (basename.includes(tok) || noExt.includes(tok)) score += 4;
    else if (segments.some((seg) => seg === tok)) score += 3;
    else if (lower.includes(tok)) score += 1;
  }
  return score;
}

function rankCandidateLines(lines, prompt) {
  if (!Array.isArray(lines) || lines.length <= RANK_MAX_CANDIDATES) return null;
  const tokens = rankTokens(prompt);
  const items = lines.map((line, index) => ({
    line: String(line).trim(),
    index,
    score: 0,
  })).filter((item) => item.line.length > 0);

  if (tokens.length > 0) {
    for (const item of items) item.score = rankCandidateScore(item.line, tokens);
    items.sort((a, b) => b.score - a.score || a.index - b.index);
  }

  const top = items.slice(0, RANK_TOP_K).map((item) => item.line);
  const omittedCount = items.length - top.length;
  return {
    top,
    omittedCount,
    originalCount: items.length,
    ranked: tokens.length > 0,
  };
}

function candidatePaths(value) {
  if (typeof value === "string") return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      if (typeof item === "string") out.push(item);
      else if (item && typeof item === "object") {
        if (typeof item.path === "string") out.push(item.path);
        else if (typeof item.file === "string") out.push(item.file);
        else if (typeof item.text === "string") out.push(...item.text.split(/\r?\n/));
        else if (typeof item.content === "string") out.push(...item.content.split(/\r?\n/));
      }
    }
    return out.map((line) => String(line).trim()).filter(Boolean);
  }
  if (value && typeof value === "object") {
    for (const key of ["text", "result", "output", "value", "content", "stdout", "matches", "paths", "results"]) {
      if (typeof value[key] === "string") return value[key].split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (Array.isArray(value[key])) return candidatePaths(value[key]);
    }
  }
  return [];
}

function applyRankedResult(result, newText) {
  if (result && typeof result === "object") {
    if (typeof result.value === "string") { result.value = newText; return; }
    if (typeof result.content === "string") { result.content = newText; return; }
    if (typeof result.result === "string") { result.result = newText; return; }
    if (typeof result.output === "string") { result.output = newText; return; }
    if (typeof result.stdout === "string") { result.stdout = newText; return; }
    if (typeof result.text === "string") { result.text = newText; return; }
    if (Array.isArray(result.value)) { result.value = [{ type: "text", text: newText }]; return; }
    if (Array.isArray(result.content)) { result.content = [{ type: "text", text: newText }]; return; }
  }
}

function shellToolBase(execOrTool) {
  const raw = String(execOrTool?.name || execOrTool?.tool?.name || "").trim();
  const base = (raw.split(/[.:]/).pop() || "").toLowerCase();
  return SHELL_TOOLS.has(base) ? base : "";
}

function detectShellFailure(execOrTool, result) {
  if (!shellToolBase(execOrTool)) return null;
  const value = result && typeof result === "object" && "value" in result ? result.value : result;
  const valueObj = value && typeof value === "object" ? value : {};
  const wrapper = result && typeof result === "object" ? result : {};

  const exitCode =
    valueObj.exitCode ?? valueObj.exit_code ?? valueObj.exit ?? valueObj.code ??
    wrapper.exitCode ?? wrapper.exit_code ?? wrapper.exit ?? wrapper.code;
  const code = typeof exitCode === "number" ? exitCode : parseInt(exitCode, 10);
  const nonZeroExit = Number.isInteger(code) && code !== 0;

  const chunks = [];
  if (typeof value === "string" && value.trim()) chunks.push(value);
  for (const key of ["stderr", "stdout", "text", "output", "message", "error"]) {
    const v = valueObj[key] ?? wrapper[key];
    if (typeof v === "string" && v.trim()) chunks.push(v);
  }
  const text = chunks.join("\n");

  if (!nonZeroExit && !TEST_FAILURE_RE.test(text)) return null;
  return text || JSON.stringify(value ?? result ?? "");
}

async function classifyShellFailure(jevClient, execOrTool, result, config) {
  const text = detectShellFailure(execOrTool, result);
  if (!text) return "";
  const diagnosed = await classifyTestFailure(jevClient, text, { model: config?.model });
  const kind = typeof diagnosed?.kind === "string" && diagnosed.kind ? diagnosed.kind : "assertion";
  const advice = DIAGNOSE_ADVICE[kind] || DIAGNOSE_ADVICE.assertion;
  return `[tokenslash-diagnose: ${kind} - ${advice}]`;
}

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

export function createPruneHook(ctx, jevClientOrGetter, configGetter, telemetry, nativeServices = null, promptTracker = null) {
  const getJev = typeof jevClientOrGetter === "function" ? jevClientOrGetter : () => jevClientOrGetter;

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

    // Zero-Rescan glob/grep Candidate Ranking
    const rankTool = rankToolName(execOrTool);
    if (rankTool) {
      const prompt = getRankPrompt(ctx, execOrTool, promptTracker);
      const candidates = candidatePaths(targetVal);
      const rankedPlan = rankCandidateLines(candidates, prompt);
      if (rankedPlan) {
        const summary = `\n[... ${rankedPlan.omittedCount} lower-relevance paths omitted by tokenslash]`;
        const newText = `${rankedPlan.top.join("\n")}${summary}`;

        if (typeof targetVal === "string") {
          targetVal = newText;
        } else if (Array.isArray(targetVal) && targetVal.every((item) => typeof item === "string")) {
          targetVal = [...rankedPlan.top, `[... ${rankedPlan.omittedCount} lower-relevance paths omitted by tokenslash]`];
        } else {
          applyRankedResult(targetVal, newText);
        }

        if (typeof result === "string") {
          result = newText;
        } else {
          applyRankedResult(result, newText);
        }

        const savedTokens = Math.max(0, rankedPlan.omittedCount * 8);
        telemetry?.record?.("glob_rank_prune", savedTokens, {
          toolName: rankTool,
          originalCount: rankedPlan.originalCount,
          retainedCount: rankedPlan.top.length,
          omittedCount: rankedPlan.omittedCount,
        });

        const currentLen = typeof targetVal === "string" ? targetVal.length : JSON.stringify(targetVal).length;
        if (currentLen <= compactLimit) {
          const content = [{ type: "text", text: newText }];
          return isWaterfall ? (typeof next === "function" ? next() : { kind: "accept", content }) : result;
        }
      }
    }

    // Part B: shell failure triage (pwsh/bash only). On a non-zero exit or stderr test
    // failure, append a tokenslash-diagnose line to the preserved output. Fail open.
    let diagnoseLine = "";
    try {
      diagnoseLine = await classifyShellFailure(getJev(), execOrTool, result, config);
    } catch {
      diagnoseLine = "";
    }

    if (diagnoseLine) {
      const appendDiagnose = (text) => (typeof text === "string" ? `${text}\n${diagnoseLine}` : text);
      if (typeof targetVal === "string") {
        targetVal = appendDiagnose(targetVal);
        if (result && typeof result === "object") {
          if ("value" in result && typeof result.value === "string") result.value = appendDiagnose(result.value);
          else if ("content" in result && typeof result.content === "string") result.content = appendDiagnose(result.content);
          else if (typeof result.stderr === "string") result.stderr = appendDiagnose(result.stderr);
          else if (typeof result.stdout === "string") result.stdout = appendDiagnose(result.stdout);
          else if (typeof result.text === "string") result.text = appendDiagnose(result.text);
        } else if (typeof result === "string") {
          result = targetVal;
        }
      } else if (Array.isArray(targetVal) && targetVal[0] && targetVal[0].type === "text" && typeof targetVal[0].text === "string") {
        targetVal[0].text = appendDiagnose(targetVal[0].text);
      } else if (targetVal && typeof targetVal === "object") {
        if (typeof targetVal.stderr === "string") targetVal.stderr = appendDiagnose(targetVal.stderr);
        else if (typeof targetVal.stdout === "string") targetVal.stdout = appendDiagnose(targetVal.stdout);
        else if (typeof targetVal.text === "string") targetVal.text = appendDiagnose(targetVal.text);
        else if (typeof targetVal.output === "string") targetVal.output = appendDiagnose(targetVal.output);
      }
    }

    // Part A: Jev observation gate. Oversized string outputs may need to be preserved
    // verbatim (code diffs / stack traces) or masked before the distillation pipeline.
    const toolName = execOrTool?.name || execOrTool?.tool?.name;
    if (typeof targetVal === "string" && targetVal.length > compactLimit) {
      let action = "distill";
      try {
        const decision = await classifyObservation(
          getJev(),
          { toolName, output: targetVal, thresholdTokens: compactLimit },
          config
        );
        action = decision?.action || "distill";
      } catch {
        action = "distill";
      }

      if (action === "pass") {
        return isWaterfall ? (typeof next === "function" ? next() : { kind: "accept" }) : result;
      }
      if (action === "mask") {
        const stub = `[tokenslash: ${toolName || "tool"} output masked — ${targetVal.length} chars omitted]`;
        const content = [{ type: "text", text: stub }];
        return isWaterfall ? { kind: "accept", content } : content;
      }
    }

    // Deterministic output distillation: strip noise, ANSI, overwrites from long text output
    if (typeof targetVal === "string" && targetVal.length > DISTILL_MIN_LENGTH) {
      const distilled = distillOutput(targetVal);
      if (distilled !== targetVal) {
        const beforeTokens = countTokens(targetVal, config?.model);
        const afterTokens = countTokens(distilled, config?.model);
        const distillSaved = Math.max(0, beforeTokens - afterTokens);
        targetVal = distilled;
        if (result && typeof result === "object") {
          if ("value" in result) result.value = distilled;
          else if ("content" in result && typeof result.content === "string") result.content = distilled;
        } else if (typeof result === "string") {
          result = distilled;
        }
        telemetry?.record?.("output-distill", distillSaved, {
          toolName: typeof execOrTool?.name === "string" ? execOrTool.name : undefined,
          originalTokens: beforeTokens,
          distilledTokens: afterTokens,
          model: config?.model,
        });
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
