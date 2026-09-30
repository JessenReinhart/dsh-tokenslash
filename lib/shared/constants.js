// Shared constants for dsh-tokenslash backend modularization

export const BRIDGE_PREFIX = "/api/dsh-tokenslash";
export const MAX_JSON_BODY_BYTES = 64 * 1024;
export const SYSTEM_ONE_ENDPOINT = "/v1/systemone";

export const JEV_PROVIDERS = {
  opencode: {
    name: "OpenCode Zen (Free)",
    baseUrl: "https://opencode.ai/zen/v1/systemone",
    defaultModel: "jev-1.13-free",
    needsAuth: false,
  },
  "9router": {
    name: "9Router Proxy",
    baseUrl: "http://127.0.0.1:20128/v1/systemone",
    defaultModel: "oc/jev-1.13-free",
    needsAuth: false,
  },
  openrouter: {
    name: "OpenRouter Fast Tier",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "deepseek/deepseek-chat",
    needsAuth: true,
  },
  typesafe: {
    name: "TypeSafe Jev Engine",
    baseUrl: "https://api.typesafe.ai/v1",
    defaultModel: "jev-1.13-fast",
    needsAuth: true,
  },
  localjev: {
    name: "LocalJev (Local Bun)",
    baseUrl: "http://127.0.0.1:8080/v1/systemone",
    defaultModel: "diffusiongemma-26B-A4B-it-4bit",
    needsAuth: false,
  },
  custom: {
    name: "Custom / Local Endpoint",
    baseUrl: "http://127.0.0.1:20128/v1/systemone",
    defaultModel: "custom",
    needsAuth: false,
  },
};

export const DEFAULT_CONFIG = {
  enabled: true,
  provider: "9router",
  customBaseUrl: "http://127.0.0.1:20128/v1/systemone",
  apiKey: "",
  model: "oc/jev-1.13-free",
  decoupleThreshold: 0.85,
  modelTiers: {
    cheap: "gemini-2.5-flash, deepseek-chat, gpt-4o-mini",
    medium: "gemini-2.5-pro, claude-3-5-haiku",
    smart: "deepseek-reasoner, claude-3-7-sonnet, gpt-4o",
  },
  pinnedTools: [],
  failOpen: true,
  modules: {
    subagentRouting: true,
    toolPruning: true,
    toolPruningMode: "normal", // "normal" | "extreme" | "off"
    promptPruning: true,
    outputCompacting: true,
    goalGuard: true,
  },
};

// Token cost per 1K tokens (USD) for common models - used for telemetry cost estimation
export const TOKEN_COST_PER_1K = {
  "diffusiongemma-26B-A4B-it-4bit": 0,
  "jev-1.13-free": 0,
  "jev-1.13-fast": 0,
  "deepseek-chat": 0.00014,
  "deepseek-reasoner": 0.00055,
  "gemini-2.5-flash": 0.000075,
  "gemini-2.5-pro": 0.00125,
  "gpt-4o-mini": 0.00015,
  "gpt-4o": 0.005,
  "claude-3-5-haiku": 0.00025,
  "claude-3-7-sonnet": 0.003,
  "custom": 0.0001,
};