// test/shared/tokenizer.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveEncodingName,
  countTokens,
  countText,
  isBpeActive,
} from "../../lib/shared/tokenizer.js";

test("resolveEncodingName maps o200k-family models correctly", () => {
  assert.equal(resolveEncodingName("gpt-4o"), "o200k_base");
  assert.equal(resolveEncodingName("gpt-4o-mini"), "o200k_base");
  assert.equal(resolveEncodingName("o1-preview"), "o200k_base");
  assert.equal(resolveEncodingName("o1-mini"), "o200k_base");
  assert.equal(resolveEncodingName("o3-mini"), "o200k_base");
  assert.equal(resolveEncodingName("gpt-4.1"), "o200k_base");
  assert.equal(resolveEncodingName("custom-o200k-model"), "o200k_base");
});

test("resolveEncodingName maps null and unknown models to cl100k_base", () => {
  assert.equal(resolveEncodingName(null), "cl100k_base");
  assert.equal(resolveEncodingName(undefined), "cl100k_base");
  assert.equal(resolveEncodingName(""), "cl100k_base");
  assert.equal(resolveEncodingName("deepseek-chat"), "cl100k_base");
  assert.equal(resolveEncodingName("oc/jev-1.13-free"), "cl100k_base");
  assert.equal(resolveEncodingName("claude-3-5-sonnet"), "cl100k_base");
});

test("countTokens handles non-string input safely", () => {
  const obj = { key: "value", list: [1, 2, 3] };
  const tokens = countTokens(obj);
  assert.equal(typeof tokens, "number");
  assert.ok(tokens > 0);
});

test("countTokens survives circular object without throwing", () => {
  const circular = { name: "loop" };
  circular.self = circular;
  assert.doesNotThrow(() => {
    const tokens = countTokens(circular);
    assert.equal(typeof tokens, "number");
    assert.ok(tokens > 0);
  });
});

test("countTokens and countText return numeric counts for string inputs", () => {
  assert.equal(countText(""), 0);
  assert.equal(countTokens(""), 0);

  const sample = "The quick brown fox jumps over the lazy dog";
  const textCount = countText(sample);
  const tokenCount = countTokens(sample);
  assert.equal(typeof textCount, "number");
  assert.equal(typeof tokenCount, "number");
  assert.ok(textCount > 0);
  assert.equal(textCount, tokenCount);
});

test("isBpeActive returns a boolean", () => {
  assert.equal(typeof isBpeActive(), "boolean");
});
