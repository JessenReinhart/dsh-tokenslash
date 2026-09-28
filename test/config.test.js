// test/config.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig, parseModelTiers, getConfigForProvider } from "../lib/config.js";

await test("parseConfig defaults", async () => {
  const cfg = parseConfig({});
  assert.equal(cfg.enabled, true);
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
