// Bridge routes for TokenSlash - Host <-> Web Settings UI communication
import { BRIDGE_PREFIX, MAX_JSON_BODY_BYTES } from "../shared/constants.js";
import { getConfigForProvider, ConfigSchema } from "../config.js";
import { JevClient } from "../jev-client.js";
import { listProviders } from "../providers.js";

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(body);
}

function sendError(res, status, message, details = null) {
  const payload = { error: message };
  if (details) payload.details = details;
  sendJson(res, status, payload);
}

async function readJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw new Error(`Request body exceeds limit of ${maxBytes} bytes`);
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

export function registerBridgeRoutes(ctx, config, telemetry, getClientOrInstance, setClientFn) {
  const currentConfig = config;
  const getJevClient = typeof getClientOrInstance === "function" ? getClientOrInstance : () => getClientOrInstance;
  const setJevClient = typeof setClientFn === "function" ? setClientFn : () => {};

  let cachedModels = [];
  let lastModelsFetch = 0;
  const MODELS_CACHE_TTL = 30000;

  async function getOrFetchModels() {
    const now = Date.now();
    if (cachedModels.length > 0 && now - lastModelsFetch < MODELS_CACHE_TTL) {
      return cachedModels;
    }
    const models = await getJevClient().getModels().catch(() => []);
    if (models.length > 0) {
      cachedModels = models;
      lastModelsFetch = now;
    }
    return cachedModels.length > 0 ? cachedModels : models;
  }

  const routes = [
    ctx.webServer.register({
      kind: "exact",
      path: `${BRIDGE_PREFIX}/config`,
      handler: async (req, res) => {
        if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
        try {
          // Skipping model fetch for immediate config response\n
          sendJson(res, 200, { config: currentConfig, providers: listProviders() });
        } catch (err) {
          ctx.logger?.error?.(`[tokenslash] get config error: ${err.message}`);
          sendError(res, 500, err.message);
        }
      },
    }),

    ctx.webServer.register({
      kind: "exact",
      path: `${BRIDGE_PREFIX}/providers`,
      handler: async (req, res) => {
        if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
        try {
          sendJson(res, 200, { providers: listProviders() });
        } catch (err) {
          sendError(res, 500, err.message);
        }
      },
    }),

    ctx.webServer.register({
      kind: "exact",
      path: `${BRIDGE_PREFIX}/harness-models`,
      handler: async (req, res) => {
        if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
        try {
          const llm = ctx.get ? ctx.get("llm") : ctx.llm;
          if (!llm || typeof llm.listProviders !== "function") {
            return sendJson(res, 200, { models: [] });
          }
          const providers = llm.listProviders() || [];
          const allModels = [];
          for (const p of providers) {
            try {
              const mList = await llm.listModels(p.id);
              if (Array.isArray(mList)) {
                for (const m of mList) {
                  allModels.push({
                    id: m.id,
                    provider: p.id,
                    name: m.name || m.id,
                    displayName: `${p.name || p.id} / ${m.name || m.id}`,
                  });
                }
              }
            } catch {
              // ignore single provider failures
            }
          }
          sendJson(res, 200, { models: allModels });
        } catch (err) {
          ctx.logger?.error?.(`[tokenslash] harness-models error: ${err.message}`);
          sendJson(res, 200, { models: [] });
        }
      },
    }),

    ctx.webServer.register({
      kind: "exact",
      path: `${BRIDGE_PREFIX}/describe`,
      handler: async (req, res) => {
        if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
        try {
          const body = await readJsonBody(req);
          const { task, context, model } = body;
          if (!task) return sendError(res, 400, "Missing task");
          const prompt = `Analyze this task and determine optimal subagent tier (cheap/medium/smart) and recommended model. Task: ${task}${context ? ` Context: ${context}` : ""}`;
          const questions = {
            tier: {
              type: "choice",
              criteria: {
                cheap: "Simple, well-defined, low context",
                medium: "Moderate complexity, some reasoning",
                smart: "High complexity, deep reasoning, large context",
              },
              instructions: prompt,
            },
          };
          const result = await getJevClient().triage(questions, { model: model || currentConfig.model });
          sendJson(res, 200, {
            tier: result.tier?.choice || "medium",
            model: model || currentConfig.model,
            confidence: result.tier?.score || 0.5,
            reasoning: result.tier?.reasoning || "",
          });
        } catch (err) {
          ctx.logger?.error?.(`[tokenslash] describe error: ${err.message}`);
          sendError(res, err.message.includes("limit") ? 400 : 500, err.message);
        }
      },
    }),

    ctx.webServer.register({
      kind: "exact",
      path: `${BRIDGE_PREFIX}/save`,
      handler: async (req, res) => {
        if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
        try {
          const body = await readJsonBody(req);
          if (typeof body.pinnedTools === "string") {
            body.pinnedTools = body.pinnedTools.split(",").map((s) => s.trim()).filter(Boolean);
          }
          const validated = ConfigSchema(body);
          Object.assign(currentConfig, validated);
          if (typeof ctx.settings?.replace === "function") {
            await ctx.settings.replace("tokenslash", validated);
          } else if (typeof ctx.settings?.update === "function") {
            await ctx.settings.update("tokenslash", validated);
          } else if (typeof ctx.settings?.set === "function") {
            await ctx.settings.set("tokenslash", validated);
          }
          const newClientConfig = getConfigForProvider(validated.provider || currentConfig.provider, validated);
          const newClient = new JevClient(newClientConfig);
          setJevClient(newClient);
          sendJson(res, 200, { ok: true, config: currentConfig });
        } catch (err) {
          ctx.logger?.error?.(`[tokenslash] save error: ${err.message}`);
          sendError(res, 400, err.message);
        }
      },
    }),

    ctx.webServer.register({
      kind: "exact",
      path: `${BRIDGE_PREFIX}/test`,
      handler: async (req, res) => {
        if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
        try {
          const body = await readJsonBody(req);
          const { provider, customBaseUrl, apiKey, model, timeoutMs } = body;
          const testConfig = getConfigForProvider(provider || currentConfig.provider, {
            customBaseUrl: customBaseUrl || currentConfig.customBaseUrl,
            apiKey: apiKey || currentConfig.apiKey,
            model: model || currentConfig.model,
          });
          const testClient = new JevClient(testConfig, { timeoutMs: timeoutMs || 8000 });
          const result = await testClient.testConnection({ timeoutMs: timeoutMs || 8000 });
          sendJson(res, 200, result);
        } catch (err) {
          ctx.logger?.error?.(`[tokenslash] test error: ${err.message}`);
          sendJson(res, 200, { ok: false, error: err.message });
        }
      },
    }),

    ctx.webServer.register({
      kind: "exact",
      path: `${BRIDGE_PREFIX}/triage`,
      handler: async (req, res) => {
        if (req.method !== "POST") return sendError(res, 405, "Method not allowed");
        try {
          const body = await readJsonBody(req);
          const { questions, model, timeoutMs, retries } = body;
          const result = await getJevClient().triage(questions || {}, {
            model: model || currentConfig.model,
            timeoutMs,
            retries,
          });
          sendJson(res, 200, result);
        } catch (err) {
          ctx.logger?.error?.(`[tokenslash] triage error: ${err.message}`);
          sendError(res, 500, err.message);
        }
      },
    }),

    ctx.webServer.register({
      kind: "exact",
      path: `${BRIDGE_PREFIX}/models`,
      handler: async (req, res) => {
        if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
        try {
          const models = await getOrFetchModels();
          sendJson(res, 200, { models, current: currentConfig.model, provider: currentConfig.provider });
        } catch (err) {
          ctx.logger?.error?.(`[tokenslash] models error: ${err.message}`);
          sendError(res, 500, err.message);
        }
      },
    }),

    ctx.webServer.register({
      kind: "exact",
      path: `${BRIDGE_PREFIX}/stats`,
      handler: async (req, res) => {
        if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
        try {
          sendJson(res, 200, telemetry.getStats());
        } catch (err) {
          ctx.logger?.error?.(`[tokenslash] stats error: ${err.message}`);
          sendError(res, 500, err.message);
        }
      },
    }),

    ctx.webServer.register({
      kind: "exact",
      path: `${BRIDGE_PREFIX}/history`,
      handler: async (req, res) => {
        if (req.method !== "GET") return sendError(res, 405, "Method not allowed");
        try {
          const url = new URL(req.url || "/", "http://dsh.internal");
          const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10), 500);
          sendJson(res, 200, { history: telemetry.getHistory(limit) });
        } catch (err) {
          ctx.logger?.error?.(`[tokenslash] history error: ${err.message}`);
          sendError(res, 500, err.message);
        }
      },
    }),
  ];

  return { routes };
}

export default registerBridgeRoutes;

