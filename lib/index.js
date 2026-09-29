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

export const name = "tokenslash";
export const inject = ["tools", "webServer", "settings"];

// Single source of truth: ConfigSchema from lib/config.js
export { ConfigSchema as Config } from "./config.js";

const TOKENSLASH_NS = "tokenslash";

export function apply(ctx, rawConfig = {}) {
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
  const bindSection = (settingsService) => {
    settingsService.installSection(ctx, TOKENSLASH_NS, ConfigSchema, currentConfig, {
      setSource: (s) => {
        source = typeof s === "function" ? s : () => s;
        syncConfig();
      },
      onChange: () => {
        syncConfig();
      },
    });
  };

  if (typeof ctx.settings?.installSection === "function") {
    bindSection(ctx.settings);
  } else {
    ctx.inject(["settings"], (settingsCtx) => {
      bindSection(settingsCtx.settings);
    });
  }
  // 3. Register real tokenslash_triage tool
  ctx.tools.register(defineTool({
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

  // 4. Intercept ctx.subagents (startContinuable, start, and fork) via Cordis injection
  attachSubagentRouting(ctx, currentConfig, getClient, telemetry);

  // 5. Tool output pruning + compaction hook (tools/post-execute waterfall)
  const pruneHook = createPruneHook(ctx, getClient, () => currentConfig, telemetry);
  const offPostExecute = ctx.on("tools/post-execute", async (exec, result, next) => {
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
  const offGoalChanged = ctx.on("goal/changed", (payload) => {
    try {
      goalGuardHook(payload);
    } catch (err) {
      ctx.logger?.warn?.(`[tokenslash] goal-guard error: ${err.message}`);
    }
  });

  // 7. Track claimed user messages per agent (inbox/claimed fires right before system-prompt/assemble)
  const claimedPrompts = new Map();
  const offInboxClaimed = ctx.on("agent/inbox/claimed", ({ agent, message }) => {
    try {
      if (!agent || !message) return;
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
  const promptPruneHook = createPromptPruneHook(ctx, getClient, () => currentConfig, telemetry, claimedPrompts);
  const offAssemble = ctx.on("system-prompt/assemble", async (assembly, context, next) => {
    try {
      return await promptPruneHook(assembly, context, next);
    } catch (err) {
      ctx.logger?.warn?.(`[tokenslash] system-prompt/assemble error: ${err.message}`);
      return typeof next === "function" ? next() : assembly;
    }
  });

  // 9. Context compaction hook (agent/pre-step)
  const compactHook = createCompactHook(ctx, getClient, () => currentConfig);
  const offPreStep = ctx.on("agent/pre-step", async (payload = {}, next) => {
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

  return {
    config: currentConfig,
    telemetry,
    get jevClient() { return getClient(); },
    providers: listProviders(),
    claimedPrompts,
    dispose: () => {
      if (bridgeCleanup) bridgeCleanup();
      if (typeof offPostExecute === "function") offPostExecute();
      if (typeof offGoalChanged === "function") offGoalChanged();
      if (typeof offInboxClaimed === "function") offInboxClaimed();
      if (typeof offAssemble === "function") offAssemble();
      if (typeof offPreStep === "function") offPreStep();
    },
  };
}

export default { name, inject, Config: ConfigSchema, apply };

