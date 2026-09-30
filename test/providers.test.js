// test/providers.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { getProviderConfig, listProviders, fetchModels, clearModelsCache } from "../lib/providers.js";
import { DEFAULT_CONFIG, JEV_PROVIDERS } from "../lib/shared/constants.js";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(payload, { status = 200, ok = true } = {}) {
  globalThis.fetch = async (url, opts) => ({
    ok,
    status,
    json: async () => payload,
    headers: opts?.headers || {},
  });
}

function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH;
  clearModelsCache();
}

test("getProviderConfig returns metadata", () => {
  const cfg = getProviderConfig("opencode");
  assert.equal(cfg.id, "opencode");
  assert.equal(cfg.provider, "opencode");
  assert.equal(cfg.baseUrl, JEV_PROVIDERS.opencode.baseUrl);
  assert.equal(cfg.model, JEV_PROVIDERS.opencode.defaultModel);
  assert.equal(cfg.apiKey, "");
});

test("listProviders returns entries", () => {
  const list = listProviders();
  assert.ok(Array.isArray(list));
  assert.ok(list.some((p) => p.id === "typesafe"));
  assert.ok(list.some((p) => p.id === "localjev"));
  assert.ok(list.some((p) => p.id === "custom"));
  assert.equal(list.length, Object.keys(JEV_PROVIDERS).length);
});

test("getProviderConfig returns correct config for localjev", () => {
  const cfg = getProviderConfig("localjev");
  assert.equal(cfg.id, "localjev");
  assert.equal(cfg.provider, "localjev");
  assert.equal(cfg.baseUrl, "http://127.0.0.1:8080/v1/systemone");
  assert.equal(cfg.model, "diffusiongemma-26B-A4B-it-4bit");
  assert.equal(cfg.needsAuth, false);
});

test("fetchModels caches and normalizes", async () => {
  mockFetch([{ id: "model-a" }, { id: "model-b" }]);
  try {
    const first = await fetchModels("opencode");
    const second = await fetchModels("opencode");
    assert.deepEqual(first, ["model-a", "model-b"]);
    assert.equal(second, first);
  } finally {
    restoreFetch();
  }
});

test("fetchModels fallback on error", async () => {
  mockFetch(null, { ok: false, status: 500 });
  try {
    const result = await fetchModels("opencode", { config: { model: "fallback-model" } });
    assert.deepEqual(result, ["fallback-model"]);
  } finally {
    restoreFetch();
  }
});

test("fetchModels throws when throwOnError and fetch rejects", async () => {
  globalThis.fetch = async () => {
    throw new Error("network down");
  };
  try {
    await assert.rejects(() => fetchModels("opencode", { throwOnError: true }), /network down/);
  } finally {
    restoreFetch();
  }
});
