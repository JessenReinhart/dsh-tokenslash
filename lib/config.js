// Configuration schema and validation for dsh-tokenslash
import z from "@deepseek-ai/schemastery";
import { DEFAULT_CONFIG, JEV_PROVIDERS } from "./shared/constants.js";

// RC dsh-settings 3.18.x reads this metadata directly; using metadata rather
// than Schema.volatile() keeps the plugin compatible with 3.18.2 and 3.18.4.
const volatile = (schema) => {
  schema.meta.volatile = true;
  return schema;
};

// Build a Schemastery schema for dsh-tokenslash.
// When volatileFields is true (the RC contract), individual fields carry
// schema.meta.volatile = true for host-side form and change detection.
// When volatileFields is false (legacy dsh-settings contract), fields stay plain
// primitives so descriptor serialization and deep copies are not corrupted by proxies.
function buildConfigSchema(volatileFields = true) {
  const mark = volatileFields ? volatile : (s) => s;
  return z.object({
    enabled: mark(z.boolean().default(DEFAULT_CONFIG.enabled)),
    provider: mark(z.string().default(DEFAULT_CONFIG.provider)),
    customBaseUrl: mark(z.string().default(DEFAULT_CONFIG.customBaseUrl)),
    apiKey: mark(z.string().default(DEFAULT_CONFIG.apiKey)),
    model: mark(z.string().default(DEFAULT_CONFIG.model)),
    decoupleThreshold: mark(z.number().default(DEFAULT_CONFIG.decoupleThreshold)),
    outputCompactLimit: mark(z.number().default(DEFAULT_CONFIG.outputCompactLimit)),
    modelTiers: z
      .object({
        cheap: mark(z.string().default(DEFAULT_CONFIG.modelTiers.cheap || "")),
        medium: mark(z.string().default(DEFAULT_CONFIG.modelTiers.medium || "")),
        smart: mark(z.string().default(DEFAULT_CONFIG.modelTiers.smart || "")),
        extreme: mark(z.string().default(DEFAULT_CONFIG.modelTiers.extreme || "")),
      })
      .default(DEFAULT_CONFIG.modelTiers),
    toolPruningMode: mark(z.string().default("normal")), // "normal" | "extreme" | "off"
    pinnedTools: mark(z.array(z.string()).default(DEFAULT_CONFIG.pinnedTools)),
    failOpen: mark(z.boolean().default(DEFAULT_CONFIG.failOpen)),
    disableCheapThinking: mark(z.boolean().default(DEFAULT_CONFIG.disableCheapThinking ?? true)),
    modules: z
      .object({
        subagentRouting: mark(z.boolean().default(DEFAULT_CONFIG.modules.subagentRouting)),
        forkDecoupling: mark(z.boolean().default(true)),
        toolPruning: mark(z.boolean().default(DEFAULT_CONFIG.modules.toolPruning)),
        toolPruningMode: mark(z.string().default(DEFAULT_CONFIG.modules.toolPruningMode || "normal")),
        promptPruning: mark(z.boolean().default(DEFAULT_CONFIG.modules.promptPruning)),
        compaction: mark(z.boolean().default(true)),
        outputCompacting: mark(z.boolean().default(DEFAULT_CONFIG.modules.outputCompacting)),
        goalGuard: mark(z.boolean().default(DEFAULT_CONFIG.modules.goalGuard)),
      })
      .default(DEFAULT_CONFIG.modules),
  });
}

export const PlainConfigSchema = buildConfigSchema(false);
export const ConfigSchema = buildConfigSchema(true);

export function unwrapConfig(value) {
  if (value && typeof value.get === "function") return unwrapConfig(value.get());
  if (Array.isArray(value)) return value.map(unwrapConfig);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, unwrapConfig(child)]));
  }
  return value;
}

export function parseConfig(rawConfig = {}) {
  // The old dsh-settings host resolves the schema itself and hands values back
  // through `hooks.setSource(scope.get())` already wrapped in schemastery
  // volatile proxies (objects with a `.get()` accessor). Unwrap BEFORE schema
  // validation so `ConfigSchema(value)` receives primitives; otherwise it throws
  // ("expected boolean but got [object Object]") and the fallback below would
  // preserve the wrapper objects, causing `.toLowerCase`/truthiness failures in
  // the pruning and compaction hooks.
  const unwrappedInput = unwrapConfig(rawConfig);
  try {
    return unwrapConfig(ConfigSchema(unwrappedInput));
  } catch {
    return { ...DEFAULT_CONFIG, ...(unwrappedInput || {}) };
  }
}

export function getConfigForProvider(provider, overrides = {}) {
  // Unwrap proxy wrappers on entry; this factory also feeds JevClient and the
  // bridge /test route, any of which may receive host-resolved config directly.
  const ov = unwrapConfig(overrides);
  const p = unwrapConfig(provider);
  const currentProvider = p || ov.provider || DEFAULT_CONFIG.provider;
  const providerMeta = JEV_PROVIDERS[currentProvider] || JEV_PROVIDERS.custom;
  return {
    ...DEFAULT_CONFIG,
    provider: currentProvider,
    customBaseUrl: String(ov.customBaseUrl || providerMeta.baseUrl || DEFAULT_CONFIG.customBaseUrl),
    model: ov.model || providerMeta.defaultModel,
    ...ov,
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
