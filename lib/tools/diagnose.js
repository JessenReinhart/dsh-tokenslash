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
