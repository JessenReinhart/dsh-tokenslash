// test/config-wrappers.test.js
// Regression: the old dsh-settings host feeds already-resolved config back through
// hooks.setSource(scope.get()), where every volatile field is a schemastery proxy
// object with a `.get()` accessor. parseConfig must unwrap those before validation
// so hooks receive primitives. A wrapped input used to make ConfigSchema throw and
// the fallback then preserved the wrappers, breaking `.toLowerCase()` in
// prompt-prune and truthiness checks in compaction.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigSchema, parseConfig, unwrapConfig } from "../lib/config.js";

await test("parseConfig unwraps real ConfigSchema proxy output to primitives", () => {
  const resolved = ConfigSchema({
    enabled: true,
    toolPruningMode: "extreme",
    pinnedTools: ["custom_tool"],
    modules: { promptPruning: true },
  });

  // Precondition: the resolved value really is wrapped in volatile proxies.
  assert.equal(typeof resolved.enabled, "object");
  assert.equal(typeof resolved.enabled.get, "function");
  assert.equal(typeof resolved.toolPruningMode.get, "function");
  assert.equal(typeof resolved.modules.promptPruning.get, "function");

  const parsed = parseConfig(resolved);

  assert.equal(parsed.enabled, true);
  assert.equal(typeof parsed.enabled, "boolean");
  assert.equal(parsed.toolPruningMode, "extreme");
  assert.equal(typeof parsed.toolPruningMode, "string");
  assert.equal(parsed.modules.promptPruning, true);
  assert.equal(typeof parsed.modules.promptPruning, "boolean");
  assert.deepEqual(parsed.pinnedTools, ["custom_tool"]);

  // The exact hook call that broke: `.toLowerCase()` on a proxy object.
  assert.doesNotThrow(() => parsed.toolPruningMode.toLowerCase());
});

await test("parseConfig fallback still carries unwrapped values on schema error", () => {
  // A value the schema rejects; the catch branch must merge unwrapped primitives,
  // not the raw wrapper objects.
  const bad = { provider: { get: () => 12345 }, enabled: true };
  const parsed = parseConfig(bad);
  assert.equal(parsed.enabled, true);
  assert.equal(typeof parsed.enabled, "boolean");
  assert.equal(parsed.provider, 12345);
  assert.equal(typeof parsed.provider.get, "undefined");
});

await test("parseConfig handles missing/nested wrapped input", () => {
  const resolved = ConfigSchema({ modelTiers: { cheap: "a,b", smart: "c" } });
  const parsed = parseConfig(resolved);
  assert.equal(parsed.modelTiers.cheap, "a,b");
  assert.equal(typeof parsed.modelTiers.cheap, "string");
  assert.equal(parseConfig().enabled, true);
});

await test("unwrapConfig is idempotent over already-plain values", () => {
  const plain = { enabled: false, modules: { toolPruning: false } };
  assert.deepEqual(unwrapConfig(plain), plain);
  const parsed = parseConfig(plain);
  assert.equal(parsed.enabled, false);
  assert.equal(parsed.modules.toolPruning, false);
});