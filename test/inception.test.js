import test from "node:test";
import assert from "node:assert/strict";
import { JevClient } from "../lib/jev-client.js";
import { JEV_PROVIDERS, TOKEN_COST_PER_1K } from "../lib/shared/constants.js";
import { listProviders, getProviderConfig } from "../lib/providers.js";

test("Inception provider: registration in JEV_PROVIDERS", () => {
  const inc = JEV_PROVIDERS.inception;
  assert.ok(inc, "inception provider must exist in JEV_PROVIDERS");
  assert.equal(inc.baseUrl, "https://api.inceptionlabs.ai/v1/decisions");
  assert.equal(inc.endpoint, "/v1/decisions");
  assert.equal(inc.defaultModel, "mercury-decide");
  assert.equal(inc.needsAuth, true);
});

test("Inception provider: listProviders includes inception", () => {
  const providers = listProviders();
  const inc = providers.find((p) => p.id === "inception");
  assert.ok(inc, "listProviders must include inception");
  assert.equal(inc.defaultModel, "mercury-decide");
});

test("Inception provider: TOKEN_COST_PER_1K includes mercury-decide", () => {
  assert.equal(TOKEN_COST_PER_1K["mercury-decide"], 0.00002);
});

test("Inception provider: getProviderConfig returns correct config", () => {
  const cfg = getProviderConfig("inception", { apiKey: "test-sk-123" });
  assert.equal(cfg.id, "inception");
  assert.equal(cfg.baseUrl, "https://api.inceptionlabs.ai/v1/decisions");
  assert.equal(cfg.apiKey, "test-sk-123");
  assert.equal(cfg.model, "mercury-decide");
});

test("Inception provider: JevClient buildUrl targets /v1/decisions", () => {
  const client = new JevClient({ provider: "inception", apiKey: "test-sk" });
  assert.equal(client.buildUrl(), "https://api.inceptionlabs.ai/v1/decisions");
  assert.equal(client.buildUrl("/v1/systemone"), "https://api.inceptionlabs.ai/v1/decisions");
  assert.equal(client.buildUrl(""), "https://api.inceptionlabs.ai/v1/decisions");
});

test("Inception provider: JevClient buildUrl with custom base URL", () => {
  const client = new JevClient({
    provider: "inception",
    customBaseUrl: "https://proxy.inceptionlabs.ai/v1/decisions",
    apiKey: "test-sk",
  });
  assert.equal(client.buildUrl(), "https://proxy.inceptionlabs.ai/v1/decisions");
});

test("Inception provider: normalizeModel forces mercury-decide", () => {
  const client = new JevClient({ provider: "inception", apiKey: "test-sk" });
  assert.equal(client.normalizeModel("foo"), "mercury-decide");
  assert.equal(client.normalizeModel("jev-1.13-free"), "mercury-decide");
  assert.equal(client.normalizeModel(undefined), "mercury-decide");
});

test("Inception provider: isInception getter", () => {
  const incClient = new JevClient({ provider: "inception", apiKey: "test-sk" });
  assert.equal(incClient.isInception, true);

  const ocClient = new JevClient({ provider: "opencode" });
  assert.equal(ocClient.isInception, false);
});

test("Inception provider: triage sends correct request payload & auth headers", async (t) => {
  const originalFetch = globalThis.fetch;
  let interceptedUrl = null;
  let interceptedMethod = null;
  let interceptedHeaders = null;
  let interceptedBody = null;

  globalThis.fetch = async (url, opts) => {
    interceptedUrl = url;
    interceptedMethod = opts?.method;
    interceptedHeaders = opts?.headers;
    interceptedBody = JSON.parse(opts?.body || "{}");
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: "mercury-decide",
        answers: {
          billing: { type: "noul", noul: 0.97 },
        },
        usage: { input_tokens: 48, output_tokens: 1 },
      }),
    };
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new JevClient({ provider: "inception", apiKey: "inception-api-key-xyz" });
  const res = await client.triage(
    { billing: { type: "noul", instructions: "Is this request about billing?" } },
    { state: "User asks for a refund" }
  );

  assert.equal(interceptedUrl, "https://api.inceptionlabs.ai/v1/decisions");
  assert.equal(interceptedMethod, "POST");
  assert.equal(interceptedHeaders.authorization, "Bearer inception-api-key-xyz");
  assert.equal(interceptedHeaders["content-type"], "application/json");
  assert.equal(interceptedBody.model, "mercury-decide");
  assert.equal(interceptedBody.state, "User asks for a refund");
  assert.ok(interceptedBody.questions.billing);
  assert.equal(res.answers.billing.noul, 0.97);
});

test("Inception provider: triage parses choice response with confidence and probabilities", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: "mercury-decide",
      answers: {
        team: {
          type: "choice",
          choice: "billing",
          score: 0.95,
          confidence: 0.95,
          probabilities: { billing: 0.95, support: 0.05 },
        },
      },
      usage: { input_tokens: 64, output_tokens: 1 },
    }),
  });

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const client = new JevClient({ provider: "inception", apiKey: "key" });
  const res = await client.triage({
    team: {
      type: "choice",
      instructions: "Assign team",
      criteria: { billing: "Payments", support: "Technical" },
    },
  });

  assert.equal(res.answers.team.choice, "billing");
  assert.equal(res.answers.team.score, 0.95);
  assert.equal(res.answers.team.confidence, 0.95);
  assert.equal(res.answers.team.probabilities.billing, 0.95);
});
