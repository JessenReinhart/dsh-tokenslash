// Routing hook and subagent interceptor for dsh-tokenslash
// Intercepts ctx.subagents and tools/pre-execute for model routing and task triage

export function classifyTaskTier(task) {
  const lower = (task || "").toLowerCase();
  if (lower.length < 200 && !lower.includes("reason") && !lower.includes("analyze")) return "cheap";
  if (lower.includes("complex") || lower.includes("deep") || lower.includes("reason")) return "smart";
  return "medium";
}

export function pickTierModel(tier, config) {
  const tiers = config?.modelTiers || {};
  const raw = tiers[tier];
  const arr = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [];
  return arr[0]?.trim() || config?.model;
}

export function extractTaskText(request) {
  const parts = [];
  if (request?.label) parts.push(request.label);
  if (Array.isArray(request?.prompt)) {
    for (const block of request.prompt) {
      if (typeof block === "string") parts.push(block);
      else if (block && typeof block.text === "string") parts.push(block.text);
    }
  } else if (typeof request?.prompt === "string") {
    parts.push(request.prompt);
  }
  return parts.join("\n").trim();
}

export async function triageTaskTier(taskText, jevClient) {
  if (!jevClient || typeof jevClient.triage !== "function") {
    return classifyTaskTier(taskText);
  }
  try {
    const res = await jevClient.triage({
      tier: `Classify subagent task complexity (cheap, medium, smart): "${taskText.slice(0, 300)}". Reply one word: cheap, medium, or smart.`,
    });
    const decision = (res?.tier || res?.answer || (typeof res === "string" ? res : "")).toLowerCase();
    if (decision.includes("cheap")) return "cheap";
    if (decision.includes("smart") || decision.includes("complex") || decision.includes("deep")) return "smart";
    if (decision.includes("medium")) return "medium";
    return classifyTaskTier(taskText);
  } catch {
    return classifyTaskTier(taskText);
  }
}

export async function interceptSubagentRequest(request, providerName, config, jevClient, telemetry, logger) {
  const parent = request?.parent;
  const parentModel = parent?.options?.model || parent?.session?.requestHeader()?.config?.model;
  const currentModel = request?.agentOptions?.model;

  const isUnspecified = !currentModel;
  const isDefault = Boolean(currentModel && parentModel && currentModel === parentModel);
  if (!isUnspecified && !isDefault) return;

  const taskText = extractTaskText(request);
  if (!taskText) return;

  const tier = await triageTaskTier(taskText, jevClient);
  const targetModel = pickTierModel(tier, config);
  if (!targetModel || targetModel === currentModel) return;

  request.agentOptions = {
    ...request.agentOptions,
    model: targetModel,
  };

  const savedTokens = tier === "cheap" ? 3500 : tier === "smart" ? 500 : 1200;
  telemetry?.recordSubagentDecouple?.(savedTokens, {
    tier,
    model: targetModel,
    provider: providerName,
  });
  logger?.info?.(
    `[tokenslash] auto-routed subagent (${providerName}) to tier '${tier}' (model: ${targetModel}) | saved ~${savedTokens.toLocaleString()} tokens`
  );
}

export function attachSubagentRouting(ctx, config, jevClient, telemetry) {
  return ctx.inject(["subagents"], (subCtx) => {
    const subagents = subCtx.subagents;
    if (!subagents) return;

    const origStartContinuable = subagents.startContinuable;
    const origStart = subagents.start;

    subagents.startContinuable = async function (spec) {
      if (config.enabled && config.modules?.subagentRouting && spec?.request) {
        await interceptSubagentRequest(
          spec.request,
          spec.provider || "continuable",
          config,
          jevClient,
          telemetry,
          ctx.logger
        );
      }
      return origStartContinuable.call(this, spec);
    };

    subagents.start = async function (name, request) {
      if (config.enabled && config.modules?.subagentRouting && request) {
        await interceptSubagentRequest(
          request,
          name || "spawn",
          config,
          jevClient,
          telemetry,
          ctx.logger
        );
      }
      return origStart.call(this, name, request);
    };

    subCtx.effect(() => () => {
      subagents.startContinuable = origStartContinuable;
      subagents.start = origStart;
    }, "tokenslash.subagentsPatch");
  });
}

export function createRoutingHook(ctx, config, jevClient) {
  return async function routingHook(tool, args) {
    const { subagentRouting, toolPruning } = config.modules || {};
    if (!subagentRouting && !toolPruning) return { continue: true };
    try {
      const questions = {};
      if (subagentRouting) {
        questions.route = `Should ${tool.name} with args ${JSON.stringify(args).slice(0, 200)} be routed to subagent?`;
      }
      if (toolPruning) {
        questions.prune = `Should ${tool.name} output be pruned?`;
      }
      const result = await jevClient.triage(questions);
      const routeDecision = result?.route || "";
      if (routeDecision.includes("no") || routeDecision.includes("false")) {
        return { continue: false, reason: "routing veto" };
      }
      return { continue: true };
    } catch {
      return { continue: true };
    }
  };
}
