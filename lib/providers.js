// Provider metadata and model discovery helpers

import { DEFAULT_CONFIG, JEV_PROVIDERS } from "./shared/constants.js";
import { getConfigForProvider } from "./config.js";

const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const modelCache = new Map();

export function getProviderConfig(provider, config = {}) {
  const key = provider || config.provider || DEFAULT_CONFIG.provider;
  const metadata = JEV_PROVIDERS[key] || JEV_PROVIDERS.custom;
  const effectiveBaseUrl = config.customBaseUrl || metadata.baseUrl || DEFAULT_CONFIG.customBaseUrl;
  return {
    ...metadata,
    id: key,
    provider: key,
    baseUrl: effectiveBaseUrl,
    apiKey: config.apiKey || "",
    model: config.model || metadata.defaultModel,
  };
}

export function listProviders() {
  return Object.entries(JEV_PROVIDERS).map(([id, metadata]) => ({ id, ...metadata }));
}

export async function fetchModels(provider, options = {}) {
  const providerConfig = getProviderConfig(provider, options.config || options);
  const cacheKey = `${providerConfig.id}:${providerConfig.baseUrl}:${providerConfig.apiKey ? "auth" : "anon"}`;
  const cached = modelCache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.timestamp < MODEL_CACHE_TTL_MS) return cached.models;

  const modelsUrl = providerConfig.baseUrl.replace(/\/$/, "").endsWith("/systemone")
    ? providerConfig.baseUrl.replace(/\/systemone$/, "") + "/models"
    : providerConfig.baseUrl.replace(/\/$/, "") + "/models";
  const headers = { accept: "application/json" };
  if (providerConfig.apiKey) headers.authorization = `Bearer ${providerConfig.apiKey}`;

  try {
    const response = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(options.timeoutMs || 10000) });
    if (!response.ok) throw new Error(`Model discovery failed (${response.status})`);
    const payload = await response.json();
    const models = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];
    const normalized = models.map((model) => (typeof model === "string" ? model : model?.id || model?.name)).filter(Boolean);
    if (!normalized.length && providerConfig.model) normalized.push(providerConfig.model);
    modelCache.set(cacheKey, { timestamp: now, models: normalized });
    return normalized;
  } catch (error) {
    const fallback = providerConfig.model ? [providerConfig.model] : [];
    modelCache.set(cacheKey, { timestamp: now, models: fallback });
    if (options.throwOnError) throw error;
    return fallback;
  }
}

export function getDefaultModel(provider) {
  return getConfigForProvider(provider).model;
}

export function clearModelsCache() {
  modelCache.clear();
}
