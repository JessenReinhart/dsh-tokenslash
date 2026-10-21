// lib/tools/diagnose.js
// Dev-loop acceleration: maps errors, stack traces, and failure output to root cause classifications
// and routes them directly to corrective action or affected test targets, avoiding expensive full-model turns.

import { triageBatch, clipState } from "../triage.js";

/**
 * Classifies an error/stack trace/terminal failure using TypeSafe Jev System One.
 *
 * @param {object|function} jevClientOrGetter
 * @param {string} errorOutput - Raw stderr, test failure, or compiler diagnostic
 * @param {object} [options]
 * @returns {Promise<{ category: string, confidence: number, advice: string }>}
 */
export async function triageDiagnostic(jevClientOrGetter, errorOutput, options = {}) {
  if (!errorOutput || typeof errorOutput !== "string" || errorOutput.trim().length === 0) {
    return { category: "unknown", confidence: 0, advice: "No diagnostic output provided." };
  }

  const questions = {
    category: {
      type: "choice",
      instructions: "Classify this error or failure output into its primary category",
      criteria: {
        syntax: "Syntax error, parse error, or unexpected token",
        import_missing: "Missing module, unresolved import, or ENOENT file path",
        type_error: "TypeError, null dereference, undefined property, or signature mismatch",
        test_assertion: "Test failure, assert.equal / deepEqual mismatch",
        env_flake: "Network timeout, port collision, sandbox denial, or transient environmental error",
        logic_bug: "Semantic logic bug or incorrect business calculation",
      },
    },
    is_transient: {
      type: "noul",
      instructions: "Is this failure an environmental or transient flake that would succeed on retry?",
    },
  };

  const clipped = clipState(errorOutput, 1000);

  try {
    const res = await triageBatch(jevClientOrGetter, questions, {
      state: clipped,
      model: options.model,
      timeoutMs: options.timeoutMs || 4000,
      retries: 0,
      logger: options.logger,
      telemetry: options.telemetry,
    });

    const answers = res.answers || {};
    const catChoice = answers.category;
    const category = typeof catChoice === "object" ? catChoice?.choice || "unknown" : String(catChoice || "unknown");
    const isTransientProb = answers.is_transient?.noul ?? 0;

    let advice = "";
    switch (category) {
      case "syntax":
        advice = "Check line numbers and brackets/commas; do not overanalyze logic.";
        break;
      case "import_missing":
        advice = "Verify import path relative to workspace or install missing package.";
        break;
      case "type_error":
        advice = "Check optional chaining (?.) and ensure object is initialized.";
        break;
      case "test_assertion":
        advice = "Inspect expected vs actual diff; update expectation if behavior changed intentionally.";
        break;
      case "env_flake":
        advice = isTransientProb > 0.6 ? "Transient flake detected: safe to retry without code modification." : "Check environment variables and local services.";
        break;
      default:
        advice = "Inspect relevant code files with tokenslash_index.";
        break;
    }

    return { category, isTransient: isTransientProb > 0.6, confidence: 0.9, advice };
  } catch (err) {
    options.logger?.warn?.(`[tokenslash] diagnostic triage failed: ${err.message}`);
    return { category: "unknown", isTransient: false, confidence: 0, advice: "Triage unavailable, manual inspection required." };
  }
}

/**
 * Screen test files given a list of changed files, returning candidate test files to run first.
 *
 * @param {string[]} changedFiles - Array of relative file paths that changed
 * @param {string[]} allTestFiles - Array of candidate test file paths
 * @returns {string[]} Filtered test files ordered by likelihood of relevance
 */
export function screenRelevantTests(changedFiles, allTestFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) return allTestFiles;
  if (!Array.isArray(allTestFiles) || allTestFiles.length === 0) return [];

  const matched = new Set();
  for (const changed of changedFiles) {
    const base = changed.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "");
    if (!base) continue;

    for (const test of allTestFiles) {
      const testName = test.split(/[\\/]/).pop() || "";
      if (testName.includes(base)) {
        matched.add(test);
      }
    }
  }

  // If we matched specific test files, run them first followed by the rest
  if (matched.size > 0) {
    const list = [...matched];
    for (const t of allTestFiles) {
      if (!matched.has(t)) list.push(t);
    }
    return list;
  }

  return allTestFiles;
}

/**
 * Classifies the root nature of a failing test output using TypeSafe Jev.
 * Flaky failures (transient network/race conditions) are flagged for retry.
 *
 * @param {object|function} jevClientOrGetter -
 * @param {string|object} testOutput - Raw test failure output
 * @param {object} [options]
 * @returns {Promise<{ kind: string, shouldRetry: boolean, isFlaky: boolean }>}
 */
export async function classifyTestFailure(jevClientOrGetter, testOutput, options = {}) {
  const FAIL_OPEN = { kind: "assertion", shouldRetry: false, isFlaky: false };

  // Coerce to string
  let text = typeof testOutput === "string" ? testOutput : "";
  if (!text && testOutput && typeof testOutput === "object") {
    try {
      text = JSON.stringify(testOutput);
    } catch {
      text = String(testOutput);
    }
  } else if (typeof testOutput !== "string" && testOutput != null) {
    text = String(testOutput);
  }

  const clipped = clipState(text, 1200).trim();
  if (!clipped) return FAIL_OPEN;

  const client = typeof jevClientOrGetter === "function" ? jevClientOrGetter() : jevClientOrGetter;
  if (!client || typeof client.triage !== "function") return FAIL_OPEN;

  try {
    const res = await triageBatch(
      jevClientOrGetter,
      {
        failure_kind: {
          type: "choice",
          instructions: "Classify the root nature of this failing test output",
          criteria: {
            flaky: "Transient socket timeout, port already in use, race condition, ECONNREFUSED, or retriable network flake",
            assertion: "AssertionError, expected vs actual mismatch, wrong result, logic failure",
            compilation: "SyntaxError, ReferenceError, module not found, unresolved import, type error at parse time",
            environment: "Missing executable, missing environment variable, permission denied, binary not on PATH",
          },
        },
      },
      {
        state: clipped,
        model: options.model,
        logger: options.logger,
        telemetry: options.telemetry,
      }
    );

    const kindAnswer = res?.answers?.failure_kind ?? res?.answers?.kind;
    const rawKind = typeof kindAnswer === "object" ? kindAnswer?.choice : kindAnswer;
    const kind = typeof rawKind === "string" && rawKind.length > 0 ? rawKind : "assertion";

    const isFlaky = kind === "flaky";
    return { kind, shouldRetry: isFlaky, isFlaky };
  } catch {
    return FAIL_OPEN;
  }
}

/**
 * Pure, deterministic heuristic to select files to batch-read together on the first turn.
 * For a path-like mention (e.g. `lib/hooks/routing.js`), returns the mentioned file plus
 * its test counterpart(s) from `fileCandidates`.
 *
 * @param {string} userPrompt - User prompt text possibly containing path mentions
 * @param {string[]} [fileCandidates] - Array of candidate file paths (workspace-relative or absolute)
 * @returns {string[]} De-duplicated subset of `fileCandidates` (input order preserved)
 */
export function planSpeculativeReads(userPrompt, fileCandidates = []) {
  if (typeof userPrompt !== "string" || !userPrompt) return [];
  if (!Array.isArray(fileCandidates) || fileCandidates.length === 0) return [];

  const candidateSet = new Set(fileCandidates);
  const mentions = userPrompt.match(/([\w@/\\-]+\.[A-Za-z0-9]+)/g) || [];

  const selected = new Set();
  for (const mention of mentions) {
    const mentionBase = mention.split(/[\\/]/).pop(); // e.g. routing.js
    if (!mentionBase) continue;
    const stem = mentionBase.replace(/\.[^.]+$/, ""); // e.g. routing

    for (const candidate of fileCandidates) {
      if (selected.has(candidate)) continue;
      const candidateBase = candidate.split(/[\\/]/).pop();
      const normalizedCandidate = candidate.replace(/\\/g, "/");
      const normalizedMention = mention.replace(/\\/g, "/");

      // 1. Exact candidate match (basename equals mentioned basename)
      if (candidateBase === mentionBase) {
        selected.add(candidate);
        continue;
      }

      // 2. Test counterpart: candidate basename is X.test.js for mention X.js
      const testName = `${stem}.test.${mentionBase.split(".").slice(1).pop() || "js"}`;
      if (candidateBase === testName) {
        selected.add(candidate);
        continue;
      }

      // 3. Candidate path contains mentioned basename and a /test/ segment
      if (normalizedCandidate.includes(mentionBase) && /\/test\//.test(normalizedCandidate)) {
        selected.add(candidate);
        continue;
      }
    }
  }

  // Preserve input order
  return fileCandidates.filter((c) => selected.has(c));
}
