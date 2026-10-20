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
  t.recordObservationMask(200);
  t.recordOutputDistill(300);
  t.recordCacheAlignment();
  t.recordToolPrune(100, { prunedTools: ["web_search"] });
  t.reset();
  assert.equal(t.totalTokensSaved, 0);
  assert.equal(t.subagentsDecoupledCount, 0);
  assert.equal(t.history.length, 0);
  assert.equal(t.estimatedCostSavedUsd, "0.00");
  assert.equal(t.observationMaskCount, 0);
  assert.equal(t.observationMaskTokensSaved, 0);
  assert.equal(t.outputDistillCount, 0);
  assert.equal(t.outputDistillTokensSaved, 0);
  assert.equal(t.cacheAlignmentEvents, 0);
  assert.equal(t.sessionTurnsCount, 0);
  assert.deepEqual(t.topPrunedTools, {});
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

test("recordObservationMask records count, tokens, turns and routes aliases", () => {
  const t = new TokenslashTelemetry();
  t.recordObservationMask(450, { maskedCount: 3 });
  assert.equal(t.observationMaskCount, 1);
  assert.equal(t.observationMaskTokensSaved, 450);
  assert.equal(t.sessionTurnsCount, 1);
  assert.equal(t.totalTokensSaved, 450);

  t.record("observation_mask", 250);
  assert.equal(t.observationMaskCount, 2);
  assert.equal(t.observationMaskTokensSaved, 700);
  assert.equal(t.sessionTurnsCount, 2);

  t.record("observation-mask", 300);
  assert.equal(t.observationMaskCount, 3);
  assert.equal(t.observationMaskTokensSaved, 1000);
  assert.equal(t.sessionTurnsCount, 3);
  assert.equal(t.totalTokensSaved, 1000);
});

test("recordOutputDistill records count, tokens and routes aliases", () => {
  const t = new TokenslashTelemetry();
  t.recordOutputDistill(150);
  assert.equal(t.outputDistillCount, 1);
  assert.equal(t.outputDistillTokensSaved, 150);
  assert.equal(t.sessionTurnsCount, 0); // distill does not increment sessionTurnsCount
  assert.equal(t.totalTokensSaved, 150);

  t.record("output_distill", 100);
  assert.equal(t.outputDistillCount, 2);
  assert.equal(t.outputDistillTokensSaved, 250);

  t.record("output-distill", 250);
  assert.equal(t.outputDistillCount, 3);
  assert.equal(t.outputDistillTokensSaved, 500);
  assert.equal(t.totalTokensSaved, 500);
  assert.equal(t.sessionTurnsCount, 0);
});

test("recordCacheAlignment records events and routes aliases", () => {
  const t = new TokenslashTelemetry();
  t.recordCacheAlignment({ tag: "prefix" });
  assert.equal(t.cacheAlignmentEvents, 1);
  assert.equal(t.totalTokensSaved, 0);

  t.record("cache_alignment", 999, { note: "tokens ignored" });
  assert.equal(t.cacheAlignmentEvents, 2);
  assert.equal(t.totalTokensSaved, 0);

  t.record("cache-alignment", 500);
  assert.equal(t.cacheAlignmentEvents, 3);
  assert.equal(t.totalTokensSaved, 0);
  assert.equal(t.sessionTurnsCount, 0);
});

test("sessionTurnsCount increments only on prune or mask events", () => {
  const t = new TokenslashTelemetry();
  assert.equal(t.sessionTurnsCount, 0);

  t.recordToolPrune(100);
  assert.equal(t.sessionTurnsCount, 1);

  t.recordPromptPrune(200);
  assert.equal(t.sessionTurnsCount, 2);

  t.recordObservationMask(300);
  assert.equal(t.sessionTurnsCount, 3);

  // Other actions do not increment sessionTurnsCount
  t.recordOutputCompact(50);
  t.recordOutputDistill(50);
  t.recordCacheAlignment();
  t.recordSubagentDecouple(500);
  assert.equal(t.sessionTurnsCount, 3);
});

test("recordToolPrune populates topPrunedTools from prunedTools or tools metadata", () => {
  const t = new TokenslashTelemetry();
  t.recordToolPrune(50, { prunedTools: ["web_search", "office", "web_search"] });
  assert.equal(t.topPrunedTools["web_search"], 2);
  assert.equal(t.topPrunedTools["office"], 1);

  t.recordToolPrune(80, { tools: ["office", "grep"] });
  assert.equal(t.topPrunedTools["web_search"], 2);
  assert.equal(t.topPrunedTools["office"], 2);
  assert.equal(t.topPrunedTools["grep"], 1);
});

test("getStats limits topPrunedTools to top 10 sorted descending by frequency", () => {
  const t = new TokenslashTelemetry();
  for (let i = 1; i <= 15; i++) {
    const toolName = `tool_${i}`;
    for (let c = 0; c < i; c++) {
      t.recordToolPrune(1, { tools: [toolName] });
    }
  }

  const stats = t.getStats();
  const keys = Object.keys(stats.topPrunedTools);
  assert.equal(keys.length, 10);
  // Highest frequency should be tool_15 (15 calls), second tool_14 (14 calls), etc.
  assert.equal(keys[0], "tool_15");
  assert.equal(stats.topPrunedTools["tool_15"], 15);
  assert.equal(keys[1], "tool_14");
  assert.equal(keys[9], "tool_6");
  assert.equal(stats.topPrunedTools["tool_6"], 6);
  assert.equal("tool_1" in stats.topPrunedTools, false);
});

test("byModule breakdown object and getter/method", () => {
  const t = new TokenslashTelemetry();
  t.recordToolPrune(100);
  t.recordPromptPrune(200);
  t.recordOutputCompact(300);
  t.recordObservationMask(400);
  t.recordOutputDistill(500);
  t.recordSubagentDecouple(600);
  t.recordCacheAlignment();

  const expected = {
    toolPrune: { events: 1, tokens: 100 },
    promptPrune: { events: 1, tokens: 200 },
    outputCompact: { events: 1, tokens: 300 },
    observationMask: { events: 1, tokens: 400 },
    outputDistill: { events: 1, tokens: 500 },
    subagentDecouple: { events: 1, tokens: 600 },
    cacheAlignment: { events: 1, tokens: 0 },
  };

  assert.deepEqual(t.byModule, expected);
  assert.deepEqual(t.getByModule(), expected);

  const stats = t.getStats();
  assert.deepEqual(stats.byModule, expected);
});

test("getStats includes all new metrics and avgTokensSavedPerTurn calculation", () => {
  const t = new TokenslashTelemetry();
  // With 0 session turns, avgTokensSavedPerTurn uses max(1, 0)
  assert.equal(t.getStats().avgTokensSavedPerTurn, 0);

  t.recordToolPrune(300); // 1 turn, 300 tokens
  t.recordObservationMask(600); // 1 turn, 600 tokens (total 2 turns, 900 tokens)
  t.recordOutputDistill(100); // 0 turns, 100 tokens (total 2 turns, 1000 tokens)
  t.recordCacheAlignment();

  const stats = t.getStats();
  assert.equal(stats.observationMaskCount, 1);
  assert.equal(stats.observationMaskTokensSaved, 600);
  assert.equal(stats.outputDistillCount, 1);
  assert.equal(stats.outputDistillTokensSaved, 100);
  assert.equal(stats.cacheAlignmentEvents, 1);
  assert.equal(stats.sessionTurnsCount, 2);
  assert.equal(stats.totalTokensSaved, 1000);
  // Math.round(1000 / 2) = 500
  assert.equal(stats.avgTokensSavedPerTurn, 500);
});

test("toJSON and fromJSON roundtrip preserves all new metrics and counters", () => {
  const t = new TokenslashTelemetry();
  t.recordToolPrune(120, { tools: ["web_search", "bash"] });
  t.recordPromptPrune(180);
  t.recordOutputCompact(90);
  t.recordObservationMask(240);
  t.recordOutputDistill(60);
  t.recordCacheAlignment();
  t.recordSubagentDecouple(1000);

  const json = t.toJSON();
  assert.equal(json.observationMaskCount, 1);
  assert.equal(json.observationMaskTokensSaved, 240);
  assert.equal(json.outputDistillCount, 1);
  assert.equal(json.outputDistillTokensSaved, 60);
  assert.equal(json.cacheAlignmentEvents, 1);
  assert.equal(json.sessionTurnsCount, 3); // toolPrune (1) + promptPrune (1) + observationMask (1)
  assert.equal(json.topPrunedTools["web_search"], 1);
  assert.equal(json.topPrunedTools["bash"], 1);

  const restored = TokenslashTelemetry.fromJSON(json);
  assert.equal(restored.totalTokensSaved, t.totalTokensSaved);
  assert.equal(restored.observationMaskCount, 1);
  assert.equal(restored.observationMaskTokensSaved, 240);
  assert.equal(restored.outputDistillCount, 1);
  assert.equal(restored.outputDistillTokensSaved, 60);
  assert.equal(restored.cacheAlignmentEvents, 1);
  assert.equal(restored.sessionTurnsCount, 3);
  assert.deepEqual(restored.topPrunedTools, t.topPrunedTools);
  assert.deepEqual(restored.byModule, t.byModule);

  const restoredStats = restored.getStats();
  assert.equal(restoredStats.avgTokensSavedPerTurn, t.getStats().avgTokensSavedPerTurn);
});
