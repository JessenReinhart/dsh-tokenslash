// tokenslash Cordis Plugin for DeepSeek Harness (DSH)
// Main plugin entry: Config parsing, Host bridge, Jev engine wiring, Settings UI, Tool registration, Hooks
import { parseConfig, getConfigForProvider, ConfigSchema } from "./config.js";
import { JevClient } from "./jev-client.js";
import { TokenslashTelemetry } from "./telemetry.js";
import { listProviders } from "./providers.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { registerBridgeRoutes } from "./routes/bridge.js";
import { createPruneHook } from "./hooks/prune.js";
import { createGoalGuardHook } from "./hooks/goal-guard.js";
import { attachSubagentRouting } from "./hooks/routing.js";
import { createPromptPruneHook } from "./hooks/prompt-prune.js";
import { createCompactHook } from "./hooks/compact.js";
import { indexFile } from "./tools/index.js";
import { executeBatch } from "./tools/batch.js";
import { bindSettingsSection, onEvent, registerTool } from "./shared/capabilities.js";

export const name = "tokenslash";
export const inject = ["tools", "webServer", "settings", "llm"];

// Single source of truth: ConfigSchema from lib/config.js
export { ConfigSchema as Config } from "./config.js";

const TOKENSLASH_NS = "tokenslash";

export function apply(ctx, rawConfig = {}) {
  const unlockRegistry = new Map();
  let source = () => rawConfig;
  const currentConfig = parseConfig(rawConfig);
  const telemetry = new TokenslashTelemetry();

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
  bindSettingsSection(ctx, TOKENSLASH_NS, ConfigSchema, currentConfig, {
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
    description: "Run a TypeSafe Jev triage query against the configured System One endpoint.",
    parameters: {
      reason: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      questions: {
        type: "object",
        additionalProperties: true,
        required: true,
        description: "Triage question definitions to send to the Jev engine.",
      },
      model: {
        type: "string",
        description: "Override model for this triage call.",
      },
      timeoutMs: {
        type: "number",
        description: "Per-request timeout in milliseconds.",
      },
      retries: {
        type: "number",
        description: "Number of retry attempts.",
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
        const schemas = {};
        for (const t of targetTools) {
          if (typeof t !== "string" || !t.trim()) continue;
          const name = t.trim();
          const tool = ctx.tools?.get?.(name);
          if (tool) {
            schemas[name] = {
              name: tool.name || name,
              description: tool.description || "",
              parameters: tool.parameters || null,
            };
          } else {
            schemas[name] = {
              name,
              notFound: true,
            };
          }
        }
        return {
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
    execute: async (args) => {
      if (!currentConfig.enabled) throw new Error("tokenslash plugin is disabled");
      const { file_path } = args;
      if (!file_path || typeof file_path !== "string") {
        throw new Error("file_path parameter is required");
      }
      return await indexFile(file_path.trim());
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
      const { calls } = args;
      return await executeBatch(calls, ctx, toolCtx);
    },
  }));

  // 4. Intercept ctx.subagents (startContinuable, start, and fork) via Cordis injection
  attachSubagentRouting(ctx, currentConfig, getClient, telemetry);

  // 5. Tool output pruning + compaction hook (tools/post-execute waterfall)
  const pruneHook = createPruneHook(ctx, getClient, () => currentConfig, telemetry);
  const offPostExecute = onEvent(ctx, "tools/post-execute", async (exec, result, next) => {
    try {
      const decision = await pruneHook(exec, result, next);
      if (decision && decision.kind === "accept") {
        return decision;
      }
    } catch (err) {
      ctx.logger?.warn?.(`[tokenslash] prune error: ${err.message}`);
    }
    return typeof next === "function" ? next() : { kind: "accept" };
  });

  // 6. Goal guard hook
  const goalGuardHook = createGoalGuardHook(ctx, () => currentConfig);
  const offGoalChanged = onEvent(ctx, "goal/changed", (payload) => {
    try {
      goalGuardHook(payload);
    } catch (err) {
      ctx.logger?.warn?.(`[tokenslash] goal-guard error: ${err.message}`);
    }
  });

  // 7. Track claimed user messages per agent (inbox/claimed fires right before system-prompt/assemble)
  const claimedPrompts = new Map();
  const offInboxClaimed = onEvent(ctx, "agent/inbox/claimed", ({ agent, message }) => {
    try {
      if (!agent || !message) return;
      if (agent.id) {
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
      }
    } catch (err) {
      ctx.logger?.warn?.(`[tokenslash] inbox/claimed error: ${err.message}`);
    }
  });

  // 8. System prompt & tool schema pruning waterfall hook (system-prompt/assemble)
  const promptPruneHook = createPromptPruneHook(ctx, getClient, () => currentConfig, telemetry, claimedPrompts, unlockRegistry);
  const offAssemble = onEvent(ctx, "system-prompt/assemble", async (assembly, context, next) => {
    try {
      return await promptPruneHook(assembly, context, next);
    } catch (err) {
      ctx.logger?.warn?.(`[tokenslash] system-prompt/assemble error: ${err.message}`);
      return typeof next === "function" ? next() : assembly;
    }
  });

  // 9. Context compaction hook (agent/pre-step)
  const compactHook = createCompactHook(ctx, getClient, () => currentConfig, telemetry);
  const offPreStep = onEvent(ctx, "agent/pre-step", async (payload = {}, next) => {
    let currentMessages = payload.messages;

    // Context compaction (compact.js) runs first when enabled
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

  ctx.logger?.info?.(
    `[tokenslash] plugin initialized (provider=${currentConfig.provider}, model=${currentConfig.model})`
  );

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (bridgeCleanup) bridgeCleanup();
    if (typeof offPostExecute === "function") offPostExecute();
    if (typeof offGoalChanged === "function") offGoalChanged();
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

