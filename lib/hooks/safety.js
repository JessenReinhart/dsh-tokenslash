// lib/hooks/safety.js
// Pre-execution tool safety classification via TypeSafe Jev

import { triageBatch, clipState } from "../triage.js";

const READ_ONLY_TOOLS = new Set([
  "read",
  "glob",
  "grep",
  "tokenslash_index",
  "tokenslash_peek",
  "tokenslash_batch",
  "list_agents",
  "job_list",
  "schedule_list",
  "get_goal",
  "team_task_list",
  "team_task_get",
]);

const SAFE_COMMAND_REGEX = /^\s*(?:git\s+(?:status|branch|log|diff)|ls|dir|echo|pwd|node\s+--version)(?:\s|$)/i;

const DESTRUCTIVE_REGEX = /(?:Remove-Item|rm\s+-[^\s]*[rf][^\s]*|git\s+reset\s+--hard|git\s+clean|git\s+push\s+(?:--force|-f\b)|Format-|Drop-Table|DROP\s+TABLE|TRUNCATE|Stop-Process|taskkill|\bkill\b|shutdown|DEL\s+\/F|rd\s+\/s)/i;

function extractCommand(exec) {
  if (!exec) return "";
  const args = exec.args;
  if (typeof args === "string") return args;
  if (args && typeof args === "object") {
    if (typeof args.command === "string") return args.command;
    if (typeof args.cmd === "string") return args.cmd;
    if (typeof args.script === "string") return args.script;
  }
  return "";
}

/**
 * Classifies tool execution risk.
 *
 * @param {object|function} jevClientOrGetter
 * @param {object} exec - { name, args, agent }
 * @param {object} [config]
 * @returns {Promise<{ decision: "allow"|"warn"|"block", risk: "safe"|"destructive"|"external"|"unknown", skip: boolean }>}
 */
export async function classifyToolRisk(jevClientOrGetter, exec, config = {}) {
  const toolName = exec?.name || "";
  const args = exec?.args || {};

  // 1. FAST-PATH: Read-only allowlist tools
  if (READ_ONLY_TOOLS.has(toolName)) {
    return { decision: "allow", risk: "safe", skip: true };
  }

  // working_directory without cd is read-only
  if (toolName === "working_directory" && (!args || typeof args !== "object" || !args.cd)) {
    return { decision: "allow", risk: "safe", skip: true };
  }

  const commandStr = extractCommand(exec);

  // 2. FAST-PATH: Safe command regex
  if (commandStr && SAFE_COMMAND_REGEX.test(commandStr)) {
    return { decision: "allow", risk: "safe", skip: true };
  }

  // 3. DESTRUCTIVE FAST-PATH: Regex match
  const rawPayload = commandStr || (typeof args === "object" ? JSON.stringify(args) : String(args));
  if (DESTRUCTIVE_REGEX.test(rawPayload)) {
    return { decision: "block", risk: "destructive", skip: true };
  }

  // 4. Jev classification
  try {
    const client = typeof jevClientOrGetter === "function" ? jevClientOrGetter() : jevClientOrGetter;
    if (!client || typeof client.triage !== "function") {
      return { decision: "allow", risk: "unknown", skip: false };
    }

    const state = clipState(
      `${toolName}\n${typeof args === "object" ? JSON.stringify(args) : String(args)}`,
      1200
    );

    const questions = {
      risk_tier: {
        type: "choice",
        instructions: "Classify the execution risk of this tool call",
        criteria: {
          safe: "Harmless read, listing, status, or standard scoped file edit",
          destructive: "Irreversible deletion, force reset, process/system kill, or out-of-scope modification",
          external: "Arbitrary external network transfer or exfiltration",
        },
      },
    };

    const res = await triageBatch(client, questions, {
      state,
      model: config?.model,
      timeoutMs: config?.timeoutMs ?? 5000,
      logger: config?.logger,
    });

    if (res?.skipped) {
      return { decision: "allow", risk: "unknown", skip: false };
    }

    const answer = res?.answers?.risk_tier;
    const rawChoice = typeof answer === "object" ? answer?.choice : answer;
    const risk = typeof rawChoice === "string" ? rawChoice.toLowerCase().trim() : "";

    if (risk === "destructive") {
      return { decision: "block", risk: "destructive", skip: false };
    }
    if (risk === "external") {
      return { decision: "warn", risk: "external", skip: false };
    }
    if (risk === "safe") {
      return { decision: "allow", risk: "safe", skip: false };
    }

    return { decision: "allow", risk: "unknown", skip: false };
  } catch {
    return { decision: "allow", risk: "unknown", skip: false };
  }
}

/**
 * Pre-Flight Diff Judge: analyzes edit and write tool payloads for syntax soundness
 * and excessive scope drift via batched Jev triage before touching disk.
 *
 * @param {object|function} jevClientOrGetter
 * @param {object} exec - { name, args, agent }
 * @param {object} [config]
 * @returns {Promise<{ decision: "allow"|"block", reason?: string, syntaxScore?: number, driftScore?: number, skip: boolean }>}
 */
export async function judgeDiff(jevClientOrGetter, exec, config = {}) {
  const toolName = exec?.name || "";
  if (toolName !== "edit" && toolName !== "write") {
    return { decision: "allow", skip: true };
  }

  const args = exec?.args || {};
  const filePath = args.file_path || "";
  const newContent = toolName === "write" ? args.content : args.new_string;
  const oldContent = toolName === "edit" ? args.old_string : "";

  // Bypass trivial / empty modifications
  if (typeof newContent !== "string" || newContent.trim().length === 0) {
    return { decision: "allow", skip: true };
  }

  try {
    const client = typeof jevClientOrGetter === "function" ? jevClientOrGetter() : jevClientOrGetter;
    if (!client || typeof client.triage !== "function") {
      return { decision: "allow", skip: true, reason: "no_client" };
    }

    const statePayload = [
      `File: ${filePath}`,
      `Tool: ${toolName}`,
      oldContent ? `Old String:\n${oldContent.slice(0, 400)}` : "",
      `New Content:\n${newContent.slice(0, 800)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const state = clipState(statePayload, 1400);

    const questions = {
      syntax_sound: {
        type: "noul",
        instructions:
          "Is the new code snippet syntactically sound and free of glaring truncation, unclosed brackets, or syntax corruption?",
      },
      scope_drift: {
        type: "noul",
        instructions:
          "Does this modification represent an excessive, unprompted, or destructive drift from the file's domain and scope?",
      },
    };

    const res = await triageBatch(client, questions, {
      state,
      model: config?.model,
      timeoutMs: config?.timeoutMs ?? 5000,
      logger: config?.logger,
    });

    if (res?.skipped) {
      return { decision: "allow", skip: false };
    }

    const rawSyntax = res?.answers?.syntax_sound;
    const syntaxScore =
      typeof rawSyntax === "object"
        ? (rawSyntax?.noul ?? rawSyntax?.confidence ?? 1.0)
        : typeof rawSyntax === "number"
          ? rawSyntax
          : 1.0;

    const rawDrift = res?.answers?.scope_drift;
    const driftScore =
      typeof rawDrift === "object"
        ? (rawDrift?.noul ?? rawDrift?.confidence ?? 0.0)
        : typeof rawDrift === "number"
          ? rawDrift
          : 0.0;

    // Policy: block_low (syntax_sound < 0.35 OR scope_drift > 0.8)
    const syntaxThreshold = config?.diffJudgeSyntaxThreshold ?? 0.35;
    const driftThreshold = config?.diffJudgeDriftThreshold ?? 0.8;

    if (syntaxScore < syntaxThreshold) {
      return {
        decision: "block",
        reason: `Blocked by Pre-Flight Diff Judge: likely syntax error/corruption detected (score: ${syntaxScore.toFixed(2)} < ${syntaxThreshold})`,
        syntaxScore,
        driftScore,
        skip: false,
      };
    }

    if (driftScore > driftThreshold) {
      return {
        decision: "block",
        reason: `Blocked by Pre-Flight Diff Judge: severe scope drift detected (score: ${driftScore.toFixed(2)} > ${driftThreshold})`,
        syntaxScore,
        driftScore,
        skip: false,
      };
    }

    return { decision: "allow", syntaxScore, driftScore, skip: false };
  } catch {
    return { decision: "allow", skip: false };
  }
}

/**
 * Creates tools/pre-execute waterfall hook for safety classification and diff judging.
 *
 * @param {object} ctx
 * @param {object|function} jevClientOrGetter
 * @param {object|function} configGetter
 * @returns {function(object, function): Promise<object>}
 */
export function createSafetyHook(ctx, jevClientOrGetter, configGetter) {
  return async (exec, next) => {
    try {
      const config = typeof configGetter === "function" ? configGetter() : configGetter;

      // 1. Pre-Flight Diff Judge (runs for edit / write tools when enabled)
      if (config?.modules?.diffJudge === true && (exec?.name === "edit" || exec?.name === "write")) {
        const diffJudgement = await judgeDiff(jevClientOrGetter, exec, config);
        if (diffJudgement.decision === "block") {
          return {
            kind: "cancel",
            reason: diffJudgement.reason || "Blocked by Jev Pre-Flight Diff Judge",
          };
        }
      }

      // 2. Safety Guard (runs for all tools when enabled)
      if (config?.modules?.safetyGuard !== true) {
        return typeof next === "function" ? await next() : { kind: "allow" };
      }

      const assessment = await classifyToolRisk(jevClientOrGetter, exec, config);

      if (assessment.decision === "block") {
        return {
          kind: "cancel",
          reason: "Blocked by Jev safety guard: destructive operation detected",
        };
      }

      if (assessment.decision === "warn") {
        ctx?.logger?.warn?.(
          `[safety-guard] Risky tool execution flagged (${assessment.risk}): ${exec?.name}`
        );
      }

      return typeof next === "function" ? await next() : { kind: "allow" };
    } catch {
      return typeof next === "function" ? await next() : { kind: "allow" };
    }
  };
}
