// tokenslash Cordis Plugin for DeepSeek Harness (DSH)
// Main plugin entry: Config parsing, Host bridge, Jev engine wiring, Settings UI, Tool registration, Hooks
import z from "@deepseek-ai/schemastery";
import { parseConfig, getConfigForProvider } from "./config.js";
import { JevClient } from "./jev-client.js";
import { TokenslashTelemetry } from "./telemetry.js";
import { listProviders } from "./providers.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { registerBridgeRoutes } from "./routes/bridge.js";
import { createPruneHook } from "./hooks/prune.js";
import { createGoalGuardHook } from "./hooks/goal-guard.js";
import { attachSubagentRouting } from "./hooks/routing.js";

export const name = "tokenslash";
export const inject = ["tools", "webServer", "settings"];

const TOKENSLASH_NS = "tokenslash";

export const Config = z.object({
  enabled: z.boolean().default(true),
  provider: z.string().default("deepseek"),
  customBaseUrl: z.string().default(""),
  apiKey: z.string().default(""),
  model: z.string().default("deepseek-chat"),
  decoupleThreshold: z.number().default(0.6),
  modelTiers: z.object({
    cheap: z.string().default(""),
    medium: z.string().default(""),
    smart: z.string().default(""),
    extreme: z.string().default(""),
  }).default({}),
  modules: z.object({
    subagentRouting: z.boolean().default(true),
    forkDecoupling: z.boolean().default(true),
    toolPruning: z.boolean().default(true),
    compaction: z.boolean().default(true),
    goalGuard: z.boolean().default(true),
  }).default({}),
});

export function apply(ctx, rawConfig = {}) {
  const currentConfig = parseConfig(rawConfig);
  const telemetry = new TokenslashTelemetry();
  const jevClient = new JevClient(currentConfig);

  // 1. Register bridge routes on webServer
  let bridgeCleanup = null;
  if (ctx.webServer) {
    const { routes } = registerBridgeRoutes(ctx, currentConfig, telemetry, jevClient);
    bridgeCleanup = () => {
      for (const unregister of routes) {
        if (typeof unregister === "function") unregister();
      }
    };
  }

  // 2. Register settings section
  if (typeof ctx.settings?.installSection === "function") {
    ctx.settings.installSection(ctx, TOKENSLASH_NS, Config, currentConfig, {
      setSource: (source) => {
        if (typeof source === "function") {
          const val = source();
          if (val) Object.assign(currentConfig, val);
        } else if (source) {
          Object.assign(currentConfig, source);
        }
      },
      onChange: () => {
        const val = ctx.settings.get(TOKENSLASH_NS);
        if (val) Object.assign(currentConfig, val);
      },
    });
  }

  // 3. Register real tokenslash_triage tool
  ctx.tools.register(defineTool({
    name: "tokenslash_triage",
    description: "Run a TypeSafe Jev triage query against the configured System One endpoint.",
    parameters: {
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
      return await jevClient.triage(args.questions || {}, {
        model: args.model || currentConfig.model,
        timeoutMs: args.timeoutMs,
        retries: args.retries,
      });
    },
  }));

  // 4. Intercept ctx.subagents (startContinuable and start) via Cordis injection
  attachSubagentRouting(ctx, currentConfig, jevClient, telemetry);

  // 5. Tool pruning hook (tools/post-execute waterfall)
  const pruneHook = createPruneHook(ctx, jevClient, () => currentConfig);
  ctx.on("tools/post-execute", async (exec, result, next) => {
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
  ctx.on("goal/changed", (payload) => {
    try {
      goalGuardHook(payload);
    } catch (err) {
      ctx.logger?.warn?.(`[tokenslash] goal-guard error: ${err.message}`);
    }
  });

  ctx.logger?.info?.(
    `[tokenslash] plugin initialized (provider=${currentConfig.provider}, model=${currentConfig.model})`
  );

  return {
    config: currentConfig,
    telemetry,
    jevClient,
    providers: listProviders(),
    dispose: () => {
      if (bridgeCleanup) bridgeCleanup();
    },
  };
}

export default { name, inject, Config, apply };
