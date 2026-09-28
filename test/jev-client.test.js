// test/jev-client.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { JevClient } from "../lib/jev-client.js";

const ORIGINAL_FETCH = globalThis.fetch;

function mockFetch(payload, { status = 200, ok = true } = {}) {
  globalThis.fetch = async () => ({
    ok,
    status,
    json: async () => payload,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload ?? "")),
    headers: { get: () => "application/json" },
  });
}

function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH;
}

test("triage returns parsed questions", async () => {
  mockFetch({ route: "yes, route to subagent", compact: "no" });
  try {
    const client = new JevClient({ provider: "opencode" });
    const result = await client.triage({ route: "Should this run in a subagent?" });
    assert.equal(result.route, "yes, route to subagent");
  } finally {
    restoreFetch();
  }
});

test("triage retries on network error", async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts++;
    if (attempts < 3) throw new Error("temp failure");
    return { ok: true, status: 200, json: async () => ({ ok: "good" }) };
  };
  try {
    const client = new JevClient({ provider: "opencode" }, { retries: 2 });
    const result = await client.triage({});
    assert.equal(result.ok, "good");
    assert.equal(attempts, 3);
  } finally {
    restoreFetch();
  }
});

test("testConnection success", async () => {
  mockFetch({ models: [] });
  try {
    const client = new JevClient({ provider: "opencode" });
    const result = await client.testConnection();
    assert.equal(result.ok, true);
    assert.equal(result.provider, "opencode");
  } finally {
    restoreFetch();
  }
});

test("testConnection failure", async () => {
  globalThis.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  try {
    const client = new JevClient({ provider: "opencode" });
    const result = await client.testConnection();
    assert.equal(result.ok, false);
    assert.equal(result.error, "ECONNREFUSED");
  } finally {
    restoreFetch();
  }
});

test("buildUrl correctly resolves endpoint for systemone bases and empty path", () => {
  const c1 = new JevClient({ provider: "opencode" });
  assert.equal(c1.buildUrl(), "https://opencode.ai/zen/v1/systemone");
  assert.equal(c1.buildUrl("/v1/systemone"), "https://opencode.ai/zen/v1/systemone");

  const c2 = new JevClient({ customBaseUrl: "http://127.0.0.1:20128/v1/systemone", provider: "9router" });
  assert.equal(c2.buildUrl(), "http://127.0.0.1:20128/v1/systemone");

  const c3 = new JevClient({ provider: "openrouter" });
  assert.equal(c3.buildUrl(), "https://openrouter.ai/api/v1/v1/systemone");

  const c4 = new JevClient({ customBaseUrl: "https://example.com/api/triage", provider: "custom" });
  assert.equal(c4.buildUrl(), "https://example.com/api/triage");
});

test("triage sends state and model in payload", async () => {
  let capturedBody;
  let capturedUrl;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ route: "ok" }),
      text: async () => JSON.stringify({ route: "ok" }),
      headers: { get: () => "application/json" },
    };
  };
  try {
    const client = new JevClient({ provider: "opencode" });
    const res = await client.triage({ route: "test" });
    assert.equal(capturedUrl, "https://opencode.ai/zen/v1/systemone");
    assert.equal(capturedBody.state, "triage");
    assert.equal(capturedBody.model, "jev-1.13-free");
    assert.deepEqual(capturedBody.questions, { route: "test" });
    assert.equal(res.route, "ok");
  } finally {
    restoreFetch();
  }
});

test("testConnection sends ping payload with state", async () => {
  let capturedBody;
  let capturedUrl;
  globalThis.fetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => JSON.stringify({ ok: true }),
      headers: { get: () => "application/json" },
    };
  };
  try {
    const client = new JevClient({ provider: "opencode" });
    const res = await client.testConnection();
    assert.equal(capturedUrl, "https://opencode.ai/zen/v1/systemone");
    assert.equal(capturedBody.state, "ping");
    assert.deepEqual(capturedBody.questions, {
      ping: { type: "noul", instructions: "ping" },
    });
    assert.equal(res.ok, true);
  } finally {
    restoreFetch();
  }
});

test("getModels delegates to providers", async () => {
  mockFetch([{ id: "m1" }, { id: "m2" }]);
  try {
    const client = new JevClient({ provider: "opencode" });
    const result = await client.getModels();
    assert.deepEqual(result, ["m1", "m2"]);
  } finally {
    restoreFetch();
  }
});
