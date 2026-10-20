// test/telemetry.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { TokenslashTelemetry } from "../lib/telemetry.js";

test("record increments subagent_decouple", () => {
  const t = new TokenslashTelemetry();
  t.record("subagent_decouple", 3500);
  assert.equal(t.subagentsDecoupledCount, 1);
  assert.equal(t.totalTokensSaved, 3500);
  // Cost is computed via blended rate; at ~3.5k tokens the rounded USD is 0.00
  assert.match(t.estimatedCostSavedUsd, /^\d+\.\d{2}$/);
  assert.ok(Number(t.estimatedCostSavedUsd) >= 0);
});

test("record large token save produces non-zero USD", () => {
  const t = new TokenslashTelemetry();
  t.record("subagent_decouple", 5000000);
  assert.equal(t.totalTokensSaved, 5000000);
  assert.equal(t.estimatedCostSavedUsd, "10.95");
});

test("record increments tool_prune", () => {
  const t = new TokenslashTelemetry();
  t.record("tool_prune", 850);
  assert.equal(t.toolsPrunedCount, 1);
  assert.equal(t.totalTokensSaved, 850);
});

test("record increments output_compact", () => {
  const t = new TokenslashTelemetry();
  t.record("output_compact", 1200);
  assert.equal(t.outputsCompactedCount, 1);
});

test("record generic action adds history", () => {
  const t = new TokenslashTelemetry();
  t.record("custom_action", 100, { note: "x" });
  assert.equal(t.history.length, 1);
  assert.equal(t.history[0].type, "custom_action");
  assert.equal(t.history[0].savedTokens, 100);
  assert.equal(t.history[0].note, "x");
});

test("getStats returns snapshot", () => {
  const t = new TokenslashTelemetry();
  t.record("subagent_decouple", 3500);
  const stats = t.getStats();
  assert.equal(stats.subagentsDecoupledCount, 1);
  assert.equal(stats.totalTokensSaved, 3500);
  assert.equal(t.history.length, 1);
});

test("getHistory respects limit", () => {
  const t = new TokenslashTelemetry();
  for (let i = 0; i < 5; i++) t.record("custom_action", 1);
  assert.equal(t.getHistory(2).length, 2);
  assert.equal(t.getHistory(100).length, 5);
});

test("reset clears state", () => {
  const t = new TokenslashTelemetry();
  t.record("subagent_decouple", 3500);
  t.reset();
  assert.equal(t.totalTokensSaved, 0);
  assert.equal(t.subagentsDecoupledCount, 0);
  assert.equal(t.history.length, 0);
  assert.equal(t.estimatedCostSavedUsd, "0.00");
});

test("toJSON/fromJSON roundtrip", () => {
  const t = new TokenslashTelemetry();
  t.record("subagent_decouple", 3500);
  const json = t.toJSON();
  const restored = TokenslashTelemetry.fromJSON(json);
  assert.equal(restored.totalTokensSaved, 3500);
  assert.equal(restored.subagentsDecoupledCount, 1);
  assert.equal(restored.history.length, 1);
  assert.equal(TokenslashTelemetry.fromJSON(null).history.length, 0);
});

test("history entry defaults token fields to null when absent", () => {
  const t = new TokenslashTelemetry();
  t.record("tool_prune", 100);
  assert.equal(t.history[0].originalTokens, null);
  assert.equal(t.history[0].compactedTokens, null);
  assert.equal(t.history[0].tokenizerMode, null);
});

test("history entry stores token provenance and increments mode counters", () => {
  const t = new TokenslashTelemetry();
  t.recordOutputCompact(50, {
    toolName: "read",
    originalTokens: 120,
    compactedTokens: 70,
    tokenizerMode: "bpe",
  });
  assert.equal(t.history[0].originalTokens, 120);
  assert.equal(t.history[0].compactedTokens, 70);
  assert.equal(t.history[0].tokenizerMode, "bpe");
  assert.equal(t.bpeEvents, 1);
  assert.equal(t.fallbackEvents, 0);

  const stats = t.getStats();
  assert.equal(stats.tokenizerMode, "bpe");
  assert.equal(stats.bpeEventCount, 1);
  assert.equal(stats.fallbackEventCount, 0);
});

test("getStats reports mixed tokenizerMode when both modes recorded", () => {
  const t = new TokenslashTelemetry();
  t.recordOutputCompact(50, { tokenizerMode: "bpe" });
  t.recordOutputCompact(30, { tokenizerMode: "fallback" });

  const stats = t.getStats();
  assert.equal(stats.tokenizerMode, "mixed");
  assert.equal(stats.bpeEventCount, 1);
  assert.equal(stats.fallbackEventCount, 1);
});

test("attachTokenMeter stores meter and exposes hasNativeTokenMeter", () => {
  const t = new TokenslashTelemetry();
  assert.equal(t.hasNativeTokenMeter, false);

  t.attachTokenMeter(null);
  assert.equal(t.hasNativeTokenMeter, false);

  const meter = { measure: () => 10 };
  t.attachTokenMeter(meter);
  assert.equal(t.hasNativeTokenMeter, true);
  assert.equal(t.tokenMeter, meter);
});

test("recordToolPrune estimates savedTokens via tokenMeter when undefined and text present", () => {
  const t = new TokenslashTelemetry();
  t.attachTokenMeter({ measure: (text) => (text ? text.split(/\s+/).length : 0) });
  t.recordToolPrune(undefined, { text: "one two three four" });
  assert.equal(t.totalTokensSaved, 4, "estimate 4 tokens from 4 words");
  assert.equal(t.toolsPrunedCount, 1);
});

test("recordOutputCompact keeps provided number when savedTokens is defined", () => {
  const t = new TokenslashTelemetry();
  t.attachTokenMeter({ measure: () => 999 });
  t.recordOutputCompact(123, { text: "ignored because savedTokens provided" });
  assert.equal(t.totalTokensSaved, 123);
});

test("recordPromptPrune falls back to 0 when meter missing and savedTokens undefined", () => {
  const t = new TokenslashTelemetry();
  t.recordPromptPrune(undefined, { text: "no meter attached" });
  assert.equal(t.totalTokensSaved, 0);
  assert.equal(t.promptsPrunedCount, 1);
});
