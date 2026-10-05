// Routing hook and subagent interceptor for dsh-tokenslash
// Intercepts ctx.subagents (startContinuable, start, fork/startFork) and tools/pre-execute for model routing, fork decoupling, and task triage

import { countTokens, countText, isBpeActive } from "../shared/tokenizer.js";

export function classifyTaskTier(task) {
  const lower = (task || "").toLowerCase();
  if (lower.length < 150 && !lower.includes("reason") && !lower.includes("analyze") && !lower.includes("complex")) return "cheap";
  if (lower.includes("extreme") || lower.includes("architecture") || lower.includes("benchmark") || lower.includes("audit")) return "extreme";
  if (lower.includes("complex") || lower.includes("deep") || lower.includes("reason") || lower.includes("refactor")) return "smart";
  return "medium";
}

export function pickTierModel(tier, config) {
  const tiers = config?.modelTiers || {};
  const raw = tiers[tier];
  const arr = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [];
  for (const candidate of arr) {
    const trimmed = candidate?.trim();
    // Must be non-empty and NOT a Jev triage model (Jev is purely a triage/decision engine, not a conversation agent)
    if (trimmed && !/^oc\/jev-|^jev-/i.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

export function isCheapTierOrModel(tier, modelName, config) {
  if (tier === "cheap") return true;
  if (!modelName) return false;
  const tiers = config?.modelTiers || {};
  const raw = tiers.cheap;
  const arr = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [];
  const normalized = modelName.trim().toLowerCase();
  return arr.some((c) => {
    const candidate = c.trim().toLowerCase();
    return candidate && (candidate === normalized || candidate.endsWith("/" + normalized) || normalized.endsWith("/" + candidate));
  });
}

export function extractTaskText(request) {
  const parts = [];
  if (request?.label) parts.push(request.label);
  if (request?.description) parts.push(request.description);
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

export async function triageTaskTier(taskText, jevClient, config = {}) {
  const client = typeof jevClient === "function" ? jevClient() : jevClient;
  if (!client || typeof client.triage !== "function") {
    return classifyTaskTier(taskText);
  }
  try {
    const res = await client.triage(
      {
        tier: {
          type: "choice",
          instructions: "Classify subagent task complexity into one tier",
          criteria: {
            cheap: "Simple query or trivial task",
            medium: "Standard coding or verification task",
            smart: "Complex architecture, deep reasoning, or refactoring",
            extreme: "Extreme benchmark, deep security audit, or system overhaul",
          },
        },
      },
      {
        state: taskText.slice(0, 1000),
        model: config?.model,
      }
    );
    const choice = res?.answers?.tier?.choice || res?.tier?.choice || res?.tier;
    if (typeof choice === "string") {
      const lower = choice.toLowerCase();
      if (["cheap", "medium", "smart", "extreme"].includes(lower)) return lower;
    }
    return classifyTaskTier(taskText);
  } catch {
    return classifyTaskTier(taskText);
  }
}

export async function interceptSubagentRequest(request, providerName, config, jevClient, telemetry, logger, isFork = false) {
  try {
    const parent = request?.parent;
    const parentModel = parent?.options?.model || parent?.session?.requestHeader()?.config?.model;
    const currentModel = request?.agentOptions?.model || request?.model;

    const taskText = extractTaskText(request);
    if (!taskText) return;

    // 1. Fork Decoupler: if subagent_fork, check confidence score against decoupleThreshold
    if (isFork && config.modules?.forkDecoupling !== false) {
      const threshold = config.decoupleThreshold ?? 0.85;
      const client = typeof jevClient === "function" ? jevClient() : jevClient;
      if (client && typeof client.triage === "function") {
        try {
          const check = await client.triage(
            {
              can_decouple: {
                type: "noul",
                instructions: "Is this fork request self-contained enough to strip parent conversation history?",
              },
            },
            {
              state: taskText.slice(0, 1000),
              model: config?.model,
            }
          );
          const score = check?.answers?.can_decouple?.noul ?? (parseFloat(check?.confidence) || 0.9);
          if (score >= threshold) {
            const historyToDrop = request.historySeed ?? request.seedMessages ?? request.payload?.messages ?? request.messages ?? [];
            request.omitHistorySeed = true;
            const model = currentModel || parentModel || config?.model;
            const savedTokens = countTokens(historyToDrop, model);
            const tokenizerMode = isBpeActive() ? "bpe" : "fallback";
            telemetry?.recordSubagentDecouple?.(savedTokens, {
              type: "fork_decoupled",
              confidence: score,
              threshold,
              model,
              tokenizerMode,
            });
            logger?.info?.(`[tokenslash] decoupled subagent fork (confidence ${score} >= ${threshold}), saved ~${savedTokens} tokens`);
          }
        } catch (err) {
          logger?.warn?.(`[tokenslash] fork decouple check failed: ${err.message}`);
        }
      }
    }

    // 2. Subagent Model Tier Rerouting
    // Never reroute if provider is "local" (DSH Desktop local runner only supports configured models, e.g. "work")
    const prov = (providerName || "").toLowerCase();
    if (prov === "local") return;

    const isUnspecified = !currentModel;
    const isDefault = Boolean(currentModel && parentModel && currentModel === parentModel);
    if (!isUnspecified && !isDefault && !isFork) {
      if (config.disableCheapThinking !== false && isCheapTierOrModel(null, currentModel, config)) {
        if (!request.agentOptions) request.agentOptions = {};
        request.agentOptions.reasoningEffort = "off";
        request.reasoning_effort = "off";
      }
      return;
    }

    const tier = await triageTaskTier(taskText, jevClient, config);
    const targetModel = pickTierModel(tier, config);
    if (!targetModel || targetModel === currentModel) {
      if (config.disableCheapThinking !== false && (tier === "cheap" || isCheapTierOrModel(tier, targetModel || currentModel, config))) {
        if (!request.agentOptions) request.agentOptions = {};
        request.agentOptions.reasoningEffort = "off";
        request.reasoning_effort = "off";
      }
      return;
    }

    if (request.agentOptions) {
      request.agentOptions.model = targetModel;
    } else {
      request.agentOptions = { model: targetModel };
    }
    telemetry?.recordSubagentModel?.({ model: targetModel, tier, task: taskText });

    // Disable visible reasoning for the cheap tier to reduce latency and cost
    if (config.disableCheapThinking !== false && (tier === "cheap" || isCheapTierOrModel(tier, targetModel, config))) {
      request.agentOptions.reasoningEffort = "off";
      request.reasoning_effort = "off";
    }

    // Estimate real savings based on task token count & model tier shift
    const promptTokens = countText(taskText, targetModel);
    const estimatedSavedTokens = tier === "cheap"
      ? promptTokens
      : tier === "extreme"
      ? 200
      : tier === "smart"
      ? 500
      : promptTokens;

    const rerouteTokenizerMode = isBpeActive() ? "bpe" : "fallback";
    telemetry?.recordSubagentDecouple?.(estimatedSavedTokens, {
      type: "model_reroute",
      fromModel: currentModel || parentModel,
      toModel: targetModel,
      tier,
      model: targetModel,
      provider: providerName,
      tokenizerMode: rerouteTokenizerMode,
    });
    logger?.info?.(
      `[tokenslash] auto-routed subagent (${providerName}) to tier '${tier}' (model: ${targetModel}) | estimated ~${estimatedSavedTokens} tokens saved`
    );
  } catch (err) {
    logger?.warn?.(`[tokenslash] subagent routing error: ${err.message}`);
  }
}

export function attachSubagentRouting(ctx, config, jevClient, telemetry) {
  return ctx.inject(["subagents"], (subCtx) => {
    const subagents = subCtx.subagents;
    if (!subagents) return;

    const origStartContinuable = subagents.startContinuable;
    const origStart = subagents.start;
    const origStartFork = subagents.startFork || subagents.fork;

    if (typeof origStartContinuable === "function") {
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
    }

    if (typeof origStart === "function") {
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
    }

    const forkFnName = subagents.startFork ? "startFork" : subagents.fork ? "fork" : null;
    if (forkFnName && typeof subagents[forkFnName] === "function") {
      const origFork = subagents[forkFnName];
      subagents[forkFnName] = async function (name, request) {
        if (config.enabled && (config.modules?.subagentRouting || config.modules?.forkDecoupling) && request) {
          await interceptSubagentRequest(
            request,
            name || "fork",
            config,
            jevClient,
            telemetry,
            ctx.logger,
            true // isFork
          );
        }
        return origFork.call(this, name, request);
      };
    }

    subCtx.effect(() => () => {
      if (typeof origStartContinuable === "function") subagents.startContinuable = origStartContinuable;
      if (typeof origStart === "function") subagents.start = origStart;
      if (forkFnName && typeof subagents[forkFnName] === "function") subagents[forkFnName] = origStartFork;
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
      const client = typeof jevClient === "function" ? jevClient() : jevClient;
      const result = await client.triage(questions);
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
