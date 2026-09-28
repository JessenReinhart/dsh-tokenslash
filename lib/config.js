// Configuration schema and validation for dsh-tokenslash
import z from "@deepseek-ai/schemastery";
import { DEFAULT_CONFIG, JEV_PROVIDERS } from "./shared/constants.js";

export const ConfigSchema = z.object({
  enabled: z.boolean().default(DEFAULT_CONFIG.enabled),
  provider: z.string().default(DEFAULT_CONFIG.provider),
  customBaseUrl: z.string().default(DEFAULT_CONFIG.customBaseUrl),
  apiKey: z.string().default(DEFAULT_CONFIG.apiKey),
  model: z.string().default(DEFAULT_CONFIG.model),
  decoupleThreshold: z.number().default(DEFAULT_CONFIG.decoupleThreshold),
  modelTiers: z
    .object({
      cheap: z.string().default(DEFAULT_CONFIG.modelTiers.cheap || ""),
      medium: z.string().default(DEFAULT_CONFIG.modelTiers.medium || ""),
      smart: z.string().default(DEFAULT_CONFIG.modelTiers.smart || ""),
      extreme: z.string().default(DEFAULT_CONFIG.modelTiers.extreme || ""),
    })
    .default(DEFAULT_CONFIG.modelTiers),
  toolPruningMode: z.string().default("normal"), // "normal" | "extreme" | "off"
  modules: z
    .object({
      subagentRouting: z.boolean().default(DEFAULT_CONFIG.modules.subagentRouting),
      forkDecoupling: z.boolean().default(true),
      toolPruning: z.boolean().default(DEFAULT_CONFIG.modules.toolPruning),
      toolPruningMode: z.string().default(DEFAULT_CONFIG.modules.toolPruningMode || "normal"),
      promptPruning: z.boolean().default(DEFAULT_CONFIG.modules.promptPruning),
      compaction: z.boolean().default(true),
      outputCompacting: z.boolean().default(DEFAULT_CONFIG.modules.outputCompacting),
      goalGuard: z.boolean().default(DEFAULT_CONFIG.modules.goalGuard),
    })
    .default(DEFAULT_CONFIG.modules),
});

export function parseConfig(rawConfig = {}) {
  try {
    return ConfigSchema(rawConfig);
  } catch {
    return { ...DEFAULT_CONFIG, ...(rawConfig || {}) };
  }
}

export function getConfigForProvider(provider, overrides = {}) {
  const currentProvider = provider || overrides.provider || DEFAULT_CONFIG.provider;
  const providerMeta = JEV_PROVIDERS[currentProvider] || JEV_PROVIDERS.custom;
  return {
    ...DEFAULT_CONFIG,
    provider: currentProvider,
    customBaseUrl: overrides.customBaseUrl || providerMeta.baseUrl || DEFAULT_CONFIG.customBaseUrl,
    model: overrides.model || providerMeta.defaultModel,
    ...overrides,
  };
}

export function parseModelTiers(tiersConfig = {}) {
  const tiers = {
    cheap: [],
    medium: [],
    smart: [],
  };

  const raw = {
    ...DEFAULT_CONFIG.modelTiers,
    ...(tiersConfig || {}),
  };

  for (const tier of ["cheap", "medium", "smart"]) {
    const val = raw[tier];
    if (typeof val === "string") {
      tiers[tier] = val.split(",").map((s) => s.trim()).filter(Boolean);
    } else if (Array.isArray(val)) {
      tiers[tier] = val.map((s) => String(s).trim()).filter(Boolean);
    }
  }

  return tiers;
}
