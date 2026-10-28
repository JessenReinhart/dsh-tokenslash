// tokenslash Cordis Plugin for DeepSeek Harness (DSH)
// Main plugin entry: Config parsing, Host bridge, Jev engine wiring, Settings UI, Tool registration, Hooks
import { parseConfig, getConfigForProvider, ConfigSchema, PlainConfigSchema } from "./config.js";
import { JevClient } from "./jev-client.js";
import { TokenslashTelemetry } from "./telemetry.js";
import { listProviders } from "./providers.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { registerBridgeRoutes } from "./routes/bridge.js";
import { createPruneHook } from "./hooks/prune.js";
import { createGoalGuardHook } from "./hooks/goal-guard.js";
import { attachSubagentRouting } from "./hooks/routing.js";
import { createPromptPruneHook, TOOL_GROUPS } from "./hooks/prompt-prune.js";
import { triageBatch } from "./triage.js";
import { createCompactHook } from "./hooks/compact.js";
import { createObservationMaskHook } from "./hooks/observation-mask.js";
import { createSafetyHook } from "./hooks/safety.js";
import { createTurnGuardHook } from "./hooks/turn-guard.js";
import { indexFile } from "./tools/index.js";
import { executeBatch } from "./tools/batch.js";
import { triageDiagnostic, classifyTestFailure, planSpeculativeReads, screenRelevantTests } from "./tools/diagnose.js";
import { bindSettingsSection, onEvent, registerTool, detectNativeServices, getService } from "./shared/capabilities.js";

export const name = "tokenslash";
export const inject = ["tools", "webServer", "settings", "llm"];

// Single source of truth: ConfigSchema from lib/config.js
export { ConfigSchema as Config } from "./config.js";

const TOKENSLASH_NS = "tokenslash";

export function apply(ctx, rawConfig = {}) {
  const nativeServices = detectNativeServices(ctx);
  const unlockRegistry = new Map();
  let source = () => rawConfig;
  const currentConfig = parseConfig(rawConfig);
  const telemetry = new TokenslashTelemetry();
  if (nativeServices?.tokenMeter) {
    telemetry.attachTokenMeter(getService(ctx, "tokenMeter"));
  }

  // Shared mutable JevClient reference — hooks read from this box so bridge
  // save propagation updates all hooks simultaneously.
  const clientRef = { current: new JevClient(currentConfig) };
  const getClient = () => clientRef.current;
  const setClient = (c) => { clientRef.current = c; };
  const refreshClient = () => {
    setClient(new JevClient(currentConfig));
  };

  // 1. Register bridge routes on webServer
  let bridgeCleanup = null;
  if (ctx.webServer) {
    const { routes } = registerBridgeRoutes(ctx, currentConfig, telemetry, getClient, setClient);
    bridgeCleanup = () => {
      for (const unregister of routes) {
        if (typeof unregister === "function") unregister();
      }
    };
  }

  const syncConfig = () => {
    const resolved = source();
    if (resolved) {
      Object.assign(currentConfig, parseConfig(resolved));
      refreshClient();
    }
  };

  // 2. Register settings section FIRST so setSource delivers the resolved
  // disk-persisted value before any hook or bridge reads currentConfig.
  // Hint: legacy dsh-settings (installSection path) should use the plain schema so
  // descriptor values stay primitives; the RC (configure path) reads volatile Config
  // from the plugin's exported Config. The adapter inspects the host's surface, not
  // the schema, so pass the plain variant here and keep volatile only on `Config`.
  bindSettingsSection(ctx, TOKENSLASH_NS, PlainConfigSchema, currentConfig, {
    setSource: (s) => {
      source = typeof s === "function" ? s : () => s;
      syncConfig();
    },
    onChange: () => {
      syncConfig();
    },
  }, (settingsService) => {
    ctx.logger?.warn?.(
      `[tokenslash] settings section unavailable (${typeof settingsService?.installSection})`
    );
  });
  // 3. Register real tokenslash_triage tool
  registerTool(ctx, defineTool({
    name: "tokenslash_triage",
    description:
      "Run a structured micro-decision against the TypeSafe Jev triage engine (System One endpoint). " +
      "Jev is a lightweight classifier, NOT a chat model: use it only for narrow yes/no or pick-one decisions " +
      "(probability thresholds, tiering, routing, tool-group gating, fork decoupling). " +
      "Do NOT use it for conversation, code writing, file reading, web search, or open-ended answers. " +
      "Pass context inside each question's instructions/string; the tool has no separate state/input field.",
    parameters: {
      reason: {
        type: "string",
        description:
          "Short human-readable reason for this triage call (for audit/logging). It is stripped and NOT sent to the endpoint.",
        required: true,
      },
      questions: {
        type: "object",
        additionalProperties: true,
        required: true,
        description:
          "Map of question ids to definitions. Each value is either: " +
          "(a) { type: 'choice', instructions: string, criteria: { key: 'description' } } for picking one of a fixed set, returning .choice/.score/.reasoning; " +
          "(b) { type: 'noul', instructions: string } for a 0..1 probability, returned as .noul number; " +
          "(c) a plain string prompt for a free-form short answer (auto-wrapped to { type: 'noul', instructions: prompt }).",
      },
      model: {
        type: "string",
        description: "Override triage model for this call (defaults to configured Jev model).",
      },
      timeoutMs: {
        type: "number",
        description: "Per-request timeout in milliseconds (default 15000).",
      },
      retries: {
        type: "number",
        description: "Retry attempts on network failure (default 2).",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        description: "Triage results mapped by question key",
      },
      render: (_args, value) => [{
        type: "text",
        text: JSON.stringify(value, null, 2),
      }],
    },
    execute: async (args) => {
      if (!currentConfig.enabled) throw new Error("tokenslash plugin is disabled");
      telemetry.record("triage_call", 0, { model: args.model || currentConfig.model });
      // Strip top-level `reason` — it's for the model, not the endpoint
      const { reason: _reason, questions, model, timeoutMs, retries } = args;
      return await getClient().triage(questions || {}, {
        model: model || currentConfig.model,
        timeoutMs,
        retries,
      });
    },
  }));

  // 3b. Register tokenslash_peek tool
  registerTool(ctx, defineTool({
    name: "tokenslash_peek",
    description: "Inspect schema/descriptions of pruned tools, or unlock them so they survive pruning in subsequent steps of this turn.",
    parameters: {
      action: {
        type: "string",
        enum: ["inspect", "unlock"],
        description: "Action to perform: 'inspect' to view tool descriptions/schemas, 'unlock' to restore tools for this turn.",
        required: true,
      },
      tools: {
        type: "array",
        items: { type: "string" },
        description: "Names of tools to inspect or unlock.",
        required: true,
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        description: "Inspection schemas or unlock confirmation",
      },
      render: (_args, value) => [{
        type: "text",
        text: JSON.stringify(value, null, 2),
      }],
    },
    execute: async (args, toolCtx) => {
      if (!currentConfig.enabled) throw new Error("tokenslash plugin is disabled");
      const { action, tools: targetTools = [] } = args;
      const agentId = toolCtx?.agent?.id || "default";

      if (action === "unlock") {
        if (!unlockRegistry.has(agentId)) {
          unlockRegistry.set(agentId, new Set());
        }
        const set = unlockRegistry.get(agentId);
        for (const t of targetTools) {
          if (typeof t === "string" && t.trim()) set.add(t.trim());
        }
        return {
          unlocked: Array.from(set),
          count: set.size,
          agentId,
        };
      }

      if (action === "inspect") {
        const mode = (typeof ctx.tools?.modeFor === "function" ? ctx.tools.modeFor() : null) || "native";
        const presentation = mode === "ptc" ? "ptc" : "native";
        const schemas = {};
        for (const t of targetTools) {
          if (typeof t !== "string" || !t.trim()) continue;
          const name = t.trim();
          const tool = ctx.tools?.get?.(name);
          if (tool) {
            let parameters = tool.parameters || null;
            if (presentation === "ptc") {
              const concise = tool.output ?? (
                typeof ctx.tools?.sdkSchemas === "function"
                  ? (ctx.tools.sdkSchemas(name) ?? ctx.tools.sdkSchemas(tool))
                  : ctx.tools?.sdkSchemas?.[name]
              );
              if (concise != null) parameters = concise;
            }
            schemas[name] = {
              name: tool.name || name,
              description: tool.description || "",
              parameters,
            };
          } else {
            schemas[name] = {
              name,
              notFound: true,
            };
          }
        }
        return {
          presentation,
          tools: schemas,
          count: Object.keys(schemas).length,
        };
      }

      throw new Error(`Unknown tokenslash_peek action: ${action}`);
    },
  }));

  // 3c. Register tokenslash_index tool (structural skeleton to avoid full reads, inspired by Maki)
  registerTool(ctx, defineTool({
    name: "tokenslash_index",
    description: "Inspect high-level structural skeleton of a file (signatures, types, classes, headers, line ranges [start-end]) ~70-90% smaller than full file reading. Call FIRST before read with offset/limit.",
    parameters: {
      file_path: {
        type: "string",
        description: "Path to source file or directory to index.",
        required: true,
      },
      filter: {
        type: "string",
        description: "Optional symbol name or keyword to filter results (e.g. 'export', 'auth', 'handle*'). Case-insensitive; accepts regex literals like '/async\\s+function/i'.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        description: "File skeleton and metrics",
      },
      render: (_args, value) => [{
        type: "text",
        text: value?.skeletonText || JSON.stringify(value, null, 2),
      }],
    },
    execute: async (args, exec) => {
      if (!currentConfig.enabled) throw new Error("tokenslash plugin is disabled");
      const { file_path, filter } = args;
      if (!file_path || typeof file_path !== "string") {
        throw new Error("file_path parameter is required");
      }
      const sessionCwd = exec?.agent?.session?.header?.cwd;
      return await indexFile(file_path.trim(), filter ? { filter } : null, sessionCwd);
    },
  }));

  // 3d. Register tokenslash_batch tool (multi-tool execution in 1 turn to eliminate round trips)
  registerTool(ctx, defineTool({
    name: "tokenslash_batch",
    description: "Execute multiple independent tool calls in a single turn without incurring multiple context re-transmission round trips.",
    parameters: {
      calls: {
        type: "array",
        required: true,
        description: "List of tool invocations to run in batch.",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            tool: { type: "string", description: "Tool name to execute" },
            args: { type: "object", additionalProperties: true, description: "Arguments for the tool" },
          },
        },
      },
      mode: {
        type: "string",
        enum: ["parallel", "series"],
        default: "parallel",
        description: "Execution mode: parallel (default) runs calls concurrently; series runs them sequentially.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        description: "Batch results for each tool invocation",
      },
      render: (_args, value) => [{
        type: "text",
        text: JSON.stringify(value, null, 2),
      }],
    },
    execute: async (args, toolCtx) => {
      if (!currentConfig.enabled) throw new Error("tokenslash plugin is disabled");
      const { calls, mode } = args;
      return await executeBatch(calls, ctx, toolCtx, { mode });
    },
  }));

  // 3e. Register tokenslash_diagnose tool (Jev-driven error/test diagnosis helpers)
  registerTool(ctx, defineTool({
    name: "tokenslash_diagnose",
    description:
      "Diagnose errors, stack traces, and failing test output using the TypeSafe Jev triage engine. " +
      "Supports four modes: 'diagnose' classifies an error into a category with generated advice, " +
      "'classify-test-failure' decides whether a test failure is flaky and safe to retry, " +
      "'plan-reads' proposes files to batch-read from path mentions in a prompt, and " +
      "'screen-tests' orders candidate test files by relevance to changed files.",
    parameters: {
      mode: {
        type: "string",
        enum: ["diagnose", "classify-test-failure", "plan-reads", "screen-tests"],
        default: "diagnose",
        description: "Which diagnosis capability to run.",
      },
      input: {
        type: "string",
        description:
          "Primary input: raw error/stack trace/test output for the Jev-backed modes, or user prompt text for 'plan-reads'.",
      },
      changedFiles: {
        type: "array",
        items: { type: "string" },
        description: "For 'screen-tests': relative file paths that changed.",
      },
      fileCandidates: {
        type: "array",
        items: { type: "string" },
        description:
          "Candidate file paths for 'plan-reads', or candidate test file paths for 'screen-tests'.",
      },
      model: {
        type: "string",
        description: "Override triage model for the Jev-backed modes.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: true,
        description: "Diagnosis result object (error category, test classification, or selected file list).",
      },
      render: (_args, value) => [{
        type: "text",
        text: JSON.stringify(value, null, 2),
      }],
    },
    execute: async (args) => {
      if (!currentConfig.enabled) throw new Error("tokenslash plugin is disabled");
      const { mode = "diagnose", input, changedFiles = [], fileCandidates = [], model } = args;
      switch (mode) {
        case "classify-test-failure":
          return await classifyTestFailure(getClient, input, { model });
        case "plan-reads":
          return planSpeculativeReads(input, fileCandidates);
        case "screen-tests":
          return screenRelevantTests(changedFiles, fileCandidates);
        case "diagnose":
        default:
          return await triageDiagnostic(getClient, input, { model });
      }
    },
  }));

  // 4. Intercept ctx.subagents (startContinuable, start, and fork) via Cordis injection
  attachSubagentRouting(ctx, currentConfig, getClient, telemetry, nativeServices);

  // 5. Tool safety pre-execution guard hook (tools/pre-execute waterfall)
  const safetyHook = createSafetyHook(ctx, getClient, () => currentConfig);
  const offPreExecute = onEvent(ctx, "tools/pre-execute", async (exec, next) => {
    try {
      if (exec?.agent?.id) telemetry.setActiveSession(exec.agent.id);
      return await safetyHook(exec, next);
    } catch (err) {
      ctx.logger?.warn?.(`[tokenslash] safety guard error: ${err.message}`);
      return typeof next === "function" ? next() : { kind: "allow" };
    }
  });

  // 6. Track claimed user messages per agent (inbox/claimed fires right before system-prompt/assemble)
  const claimedPrompts = new Map();

  // 7. Tool output pruning + compaction hook (tools/post-execute waterfall)
  const pruneHook = createPruneHook(ctx, getClient, () => currentConfig, telemetry, nativeServices, claimedPrompts);
  const offPostExecute = onEvent(ctx, "tools/post-execute", async (exec, result, next) => {
    try {
      if (exec?.agent?.id) telemetry.setActiveSession(exec.agent.id);
      const decision = await pruneHook(exec, result, next);
      if (decision && decision.kind === "accept") {
        return decision;
      }
    } catch (err) {
      ctx.logger?.warn?.(`[tokenslash] prune error: ${err.message}`);
    }
    return typeof next === "function" ? next() : { kind: "accept" };
  });

  // 7. Goal guard hook
  const goalGuardHook = createGoalGuardHook(ctx, () => currentConfig, nativeServices, getClient);
  const offGoalChanged = onEvent(ctx, "goal/changed", (payload) => {
    try {
      goalGuardHook(payload);
    } catch (err) {
      ctx.logger?.warn?.(`[tokenslash] goal-guard error: ${err.message}`);
    }
  });

  // 8. Turn-stopping task completion guard hook (agent/turn-stopping)
  const turnGuardHook = createTurnGuardHook(ctx, getClient, () => currentConfig, telemetry);
  const offTurnStopping = onEvent(ctx, "agent/turn-stopping", async (payload) => {
    try {
      if (payload?.agent?.id) telemetry.setActiveSession(payload.agent.id);
      await turnGuardHook(payload);
    } catch (err) {
      ctx.logger?.warn?.(`[tokenslash] turn-guard error: ${err.message}`);
    }
  });

  // 9. Track claimed user messages per agent (inbox/claimed fires right before system-prompt/assemble)
  const offInboxClaimed = onEvent(ctx, "agent/inbox/claimed", ({ agent, message }) => {
    try {
      if (!agent || !message) return;
      if (agent.id) {
        telemetry.setActiveSession(agent.id);
        unlockRegistry.delete(agent.id);
      }
      let text = "";
      const content = message.content;
      if (typeof content === "string") {
        text = content;
      } else if (Array.isArray(content)) {
        text = content.map((c) => (typeof c === "string" ? c : c?.text || "")).join(" ");
      }
      if (text.trim()) {
        if (claimedPrompts.size > 50) {
          const firstKey = claimedPrompts.keys().next().value;
          claimedPrompts.delete(firstKey);
        }
        claimedPrompts.set(agent.id, text.trim());

        // Pre-fire triage so results are cached before system-prompt/assemble runs
        const allGroups = Object.keys(TOOL_GROUPS);
        const questions = {};
        for (const groupKey of allGroups) {
          const g = TOOL_GROUPS[groupKey];
          const tools = g.tools.join(", ");
          questions[groupKey] = {
            type: "noul",
            instructions: `Does this user request require tools in group '${groupKey}' (tools: ${tools})?`,
          };
        }
        triageBatch(getClient, questions, {
          state: text.trim().slice(0, 800),
          model: currentConfig?.model,
          timeoutMs: 4000,
          retries: 0,
        }).catch(() => {});
      }
    } catch (err) {
      ctx.logger?.warn?.(`[tokenslash] inbox/claimed error: ${err.message}`);
    }
  });

  // 8. System prompt & tool schema pruning waterfall hook (system-prompt/assemble)
  const promptPruneHook = createPromptPruneHook(ctx, getClient, () => currentConfig, telemetry, claimedPrompts, unlockRegistry);
  const offAssemble = onEvent(ctx, "system-prompt/assemble", async (assembly, context, next) => {
    try {
      if (context?.agent?.id) telemetry.setActiveSession(context.agent.id);
      return await promptPruneHook(assembly, context, next);
    } catch (err) {
      ctx.logger?.warn?.(`[tokenslash] system-prompt/assemble error: ${err.message}`);
      return typeof next === "function" ? next() : assembly;
    }
  });

  // 9. Context compaction hook & observation masking hook (agent/pre-step)
  const compactHook = createCompactHook(ctx, getClient, () => currentConfig, telemetry, nativeServices);
  const observationMaskHook = createObservationMaskHook(ctx, getClient, () => currentConfig, telemetry, claimedPrompts);
  const offPreStep = onEvent(ctx, "agent/pre-step", async (payload = {}, next) => {
    let currentMessages = payload.messages;

    // Goal drift check (Jev-scored) against the objective tracked on goal/changed.
    // Fire-and-forget: the hook is fail-open and gates on enabled/modules.goalGuard.
    try {
      goalGuardHook(payload);
    } catch (err) {
      ctx.logger?.warn?.(`[tokenslash] goal-drift error: ${err.message}`);
    }

    // SWE-Pruner observation masking: masks oversized settled tool results from earlier turns
    if (currentConfig.enabled && currentConfig.modules?.observationMasking && Array.isArray(currentMessages)) {
      try {
        currentMessages = await observationMaskHook(currentMessages, payload?.agent?.id);
      } catch (err) {
        ctx.logger?.warn?.(`[tokenslash] observation-mask error: ${err.message}`);
      }
    }

    // Context compaction (compact.js) runs when enabled
    if (currentConfig.enabled && currentConfig.modules?.compaction && Array.isArray(currentMessages)) {
      try {
        currentMessages = await compactHook(currentMessages);
      } catch (err) {
        ctx.logger?.warn?.(`[tokenslash] compact error: ${err.message}`);
      }
    }

    if (typeof next === "function") {
      const res = await next();
      if (res && typeof res === "object" && currentMessages !== payload.messages) {
        return { ...res, messages: currentMessages };
      }
      return res;
    }
    return currentMessages !== payload.messages ? { kind: "enter", messages: currentMessages } : undefined;
  });

  const yieldedHooks = [];
  if (nativeServices.compaction) yieldedHooks.push("compaction");
  if (nativeServices.nativeToolResultPruner) yieldedHooks.push("tool-result-pruning");
  if (nativeServices.goalRoundDriver) yieldedHooks.push("goal-guard");
  if (nativeServices.subagentModelSelection) yieldedHooks.push("subagent-routing");

  ctx.logger?.info?.(
    `[tokenslash] plugin initialized (provider=${currentConfig.provider}, model=${currentConfig.model})${
      yieldedHooks.length > 0 ? ` [native DSH services active, yielded: ${yieldedHooks.join(", ")}]` : ""
    }`
  );

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (bridgeCleanup) bridgeCleanup();
    if (typeof offPreExecute === "function") offPreExecute();
    if (typeof offPostExecute === "function") offPostExecute();
    if (typeof offGoalChanged === "function") offGoalChanged();
    if (typeof offTurnStopping === "function") offTurnStopping();
    if (typeof offInboxClaimed === "function") offInboxClaimed();
    if (typeof offAssemble === "function") offAssemble();
    if (typeof offPreStep === "function") offPreStep();
  };
  const service = {
    config: currentConfig,
    telemetry,
    get jevClient() { return getClient(); },
    providers: listProviders(),
    claimedPrompts,
    unlockRegistry,
    dispose,
  };

  // Cordis invokes constructible plugin apply functions with `new` and ignores
  // their return value. Register cleanup as an effect so namespace plugins
  // still dispose routes and listeners. The idempotent service disposer remains
  // available to direct callers and adapters.
  if (typeof ctx.effect === "function") ctx.effect(() => dispose);
  return service;
}

export default { name, inject, Config: ConfigSchema, apply };

