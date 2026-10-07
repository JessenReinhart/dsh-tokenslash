// test/config.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig, parseModelTiers, getConfigForProvider, ConfigSchema } from "../lib/config.js";
import z from "@deepseek-ai/schemastery";

// Verified against RC app.asar @deepseek-ai/dsh-settings/lib/index.js,
// extracted as %TEMP%/rc-extract/rc-settings.js:103-131.
function plainSchema(schema) {
  const result = new z(schema.toJSON());
  const walk = (node) => {
    delete node.meta.volatile;
    if (node.meta.role === "secret") {
      delete node.meta.default;
      delete node.meta.required;
    }
    for (const child of Object.values(node.dict ?? {})) walk(child);
    if (node.inner) walk(node.inner);
    for (const child of node.list ?? []) walk(child);
  };
  walk(result);
  return result;
}

function rcVolatileForm(schema) {
  if (schema.meta.volatile) return plainSchema(schema);
  if (schema.type === "object") {
    const dict = Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) => {
      const field = rcVolatileForm(child);
      return field === undefined ? [] : [[key, field]];
    }));
    return Object.keys(dict).length === 0 ? undefined : z.object(dict);
  }
}

function rcProject(schema, value) {
  if (schema.type !== "object") return value;
  return Object.fromEntries(Object.entries(schema.dict ?? {}).flatMap(([key, child]) =>
    Object.hasOwn(value ?? {}, key) ? [[key, rcProject(child, value[key])]] : []));
}

await test("parseConfig defaults", async () => {
  const cfg = parseConfig({});
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.pinnedTools, []);
  assert.equal(cfg.failOpen, true);
  const custom = parseConfig({ pinnedTools: ["custom_tool", "another_tool"], failOpen: false });
  assert.deepEqual(custom.pinnedTools, ["custom_tool", "another_tool"]);
  assert.equal(custom.failOpen, false);
});

await test("RC volatileForm exposes every writable config field", async () => {
  const form = rcVolatileForm(ConfigSchema);
  assert.ok(form, "actual RC logic must find volatile fields");
  const writable = rcProject(form, {
    enabled: false,
    provider: "custom",
    customBaseUrl: "https://example.test/v1",
    apiKey: "secret",
    model: "model-x",
    decoupleThreshold: 0.4,
    outputCompactLimit: 1234,
    modelTiers: { cheap: "cheap-x", medium: "medium-x", smart: "smart-x", extreme: "extreme-x" },
    toolPruningMode: "off",
    pinnedTools: ["custom_tool"],
    failOpen: false,
    disableCheapThinking: false,
    modules: {
      subagentRouting: false,
      forkDecoupling: false,
      toolPruning: false,
      toolPruningMode: "extreme",
      promptPruning: false,
      compaction: false,
      outputCompacting: false,
      goalGuard: false,
    },
  });
  const parsed = form(writable);
  assert.equal(parsed.enabled, false);
  assert.equal(parsed.model, "model-x");
  assert.equal(parsed.modules.toolPruning, false);
  assert.deepEqual(parsed.modelTiers, {
    cheap: "cheap-x", medium: "medium-x", smart: "smart-x", extreme: "extreme-x",
  });
});

await test("parseModelTiers splits strings", async () => {
  const tiers = parseModelTiers({ cheap: "a,b", medium: ["c"], smart: "d" });
  assert.deepEqual(tiers, { cheap: ["a", "b"], medium: ["c"], smart: ["d"] });
});

await test("getConfigForProvider overrides", async () => {
  const cfg = getConfigForProvider("custom", { customBaseUrl: "https://example.com", model: "test-model" });
  assert.equal(cfg.provider, "custom");
  assert.equal(cfg.customBaseUrl, "https://example.com");
  assert.equal(cfg.model, "test-model");
});
