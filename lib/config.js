// Configuration schema and validation for dsh-tokenslash
import z from "@deepseek-ai/schemastery";
import { DEFAULT_CONFIG, JEV_PROVIDERS } from "./shared/constants.js";

// RC dsh-settings 3.18.x reads this metadata directly; using metadata rather
// than Schema.volatile() keeps the plugin compatible with 3.18.2 and 3.18.4.
const volatile = (schema) => {
  schema.meta.volatile = true;
  return schema;
};

export const ConfigSchema = z.object({
  enabled: volatile(z.boolean().default(DEFAULT_CONFIG.enabled)),
  provider: volatile(z.string().default(DEFAULT_CONFIG.provider)),
  customBaseUrl: volatile(z.string().default(DEFAULT_CONFIG.customBaseUrl)),
  apiKey: volatile(z.string().default(DEFAULT_CONFIG.apiKey)),
  model: volatile(z.string().default(DEFAULT_CONFIG.model)),
  decoupleThreshold: volatile(z.number().default(DEFAULT_CONFIG.decoupleThreshold)),
  outputCompactLimit: volatile(z.number().default(DEFAULT_CONFIG.outputCompactLimit)),
  modelTiers: z
    .object({
      cheap: volatile(z.string().default(DEFAULT_CONFIG.modelTiers.cheap || "")),
      medium: volatile(z.string().default(DEFAULT_CONFIG.modelTiers.medium || "")),
      smart: volatile(z.string().default(DEFAULT_CONFIG.modelTiers.smart || "")),
      extreme: volatile(z.string().default(DEFAULT_CONFIG.modelTiers.extreme || "")),
    })
    .default(DEFAULT_CONFIG.modelTiers),
  toolPruningMode: volatile(z.string().default("normal")), // "normal" | "extreme" | "off"
  pinnedTools: volatile(z.array(z.string()).default(DEFAULT_CONFIG.pinnedTools)),
  failOpen: volatile(z.boolean().default(DEFAULT_CONFIG.failOpen)),
  disableCheapThinking: volatile(z.boolean().default(DEFAULT_CONFIG.disableCheapThinking ?? true)),
  modules: z
    .object({
      subagentRouting: volatile(z.boolean().default(DEFAULT_CONFIG.modules.subagentRouting)),
      forkDecoupling: volatile(z.boolean().default(true)),
      toolPruning: volatile(z.boolean().default(DEFAULT_CONFIG.modules.toolPruning)),
      toolPruningMode: volatile(z.string().default(DEFAULT_CONFIG.modules.toolPruningMode || "normal")),
      promptPruning: volatile(z.boolean().default(DEFAULT_CONFIG.modules.promptPruning)),
      compaction: volatile(z.boolean().default(true)),
      outputCompacting: volatile(z.boolean().default(DEFAULT_CONFIG.modules.outputCompacting)),
      goalGuard: volatile(z.boolean().default(DEFAULT_CONFIG.modules.goalGuard)),
    })
    .default(DEFAULT_CONFIG.modules),
});

export function unwrapConfig(value) {
  if (value && typeof value.get === "function") return unwrapConfig(value.get());
  if (Array.isArray(value)) return value.map(unwrapConfig);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrapConfig(child)]));
  }
  return value;
}

export function parseConfig(rawConfig = {}) {
  try {
    return unwrapConfig(ConfigSchema(rawConfig));
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
