// test/inception.test.js — Inception Labs Mercury Decide provider integration tests
import assert from "node:assert/strict";
import { test } from "node:test";
import { JevClient } from "../lib/jev-client.js";
import { getProviderConfig, listProviders } from "../lib/providers.js";
import { JEV_PROVIDERS, TOKEN_COST_PER_1K } from "../lib/shared/constants.js";

const ORIGINAL_FETCH = globalThis.fetch;

function restoreFetch() {
  globalThis.fetch = ORIGINAL_FETCH;
}

// 1. Provider registration
test("1. Provider registration: JEV_PROVIDERS.inception exists with correct fields", () => {
  const inception = JEV_PROVIDERS.inception;
  assert.ok(inception, "inception provider must exist in JEV_PROVIDERS");
  assert.equal(inception.baseUrl, "https://api.inceptionlabs.ai/v1/decisions");
  assert.equal(inception.endpoint, "/v1/decisions");
  assert.equal(inception.defaultModel, "mercury-decide");
  assert.equal(inception.needsAuth, true);
});

// 2. listProviders includes inception
test("2. listProviders includes inception: verify entry with id 'inception'", () => {
  const providers = listProviders();
  const inception = providers.find((p) => p.id === "inception");
  assert.ok(inception, "listProviders() must return an entry with id: 'inception'");
  assert.equal(inception.id, "inception");
  assert.equal(inception.name, "Inception Labs (Mercury Decide)");
  assert.equal(inception.defaultModel, "mercury-decide");
});

// 3. JevClient buildUrl for inception
test("3. JevClient buildUrl for inception: returns decisions endpoint instead of /v1/systemone", () => {
  const client = new JevClient({ provider: "inception", apiKey: "test-key" });
  assert.equal(client.buildUrl(), "https://api.inceptionlabs.ai/v1/decisions");
  assert.equal(client.buildUrl("/v1/systemone"), "https://api.inceptionlabs.ai/v1/decisions");
  assert.equal(client.buildUrl(""), "https://api.inceptionlabs.ai/v1/decisions");
});

// 4. JevClient buildUrl for inception with custom baseUrl
test("4. JevClient buildUrl for inception with custom baseUrl: returns custom URL", () => {
  const client = new JevClient({
    provider: "inception",
    customBaseUrl: "https://custom.inceptionlabs.ai/v1/decisions",
    apiKey: "key",
  });
  assert.equal(client.buildUrl(), "https://custom.inceptionlabs.ai/v1/decisions");
});

// 5. normalizeModel always returns mercury-decide for inception
test("5. normalizeModel always returns mercury-decide for inception", () => {
  const client = new JevClient({ provider: "inception", apiKey: "test-key" });
  assert.equal(client.normalizeModel("jev-1.13-free"), "mercury-decide");
  assert.equal(client.normalizeModel("foo"), "mercury-decide");
  assert.equal(client.normalizeModel(undefined), "mercury-decide");
  assert.equal(client.normalizeModel("mercury-decide"), "mercury-decide");
});

// 6. isInception getter
test("6. isInception getter: returns true for inception, false for opencode", () => {
  const inceptionClient = new JevClient({ provider: "inception", apiKey: "key" });
  assert.equal(inceptionClient.isInception, true);

  const opencodeClient = new JevClient({ provider: "opencode" });
  assert.equal(opencodeClient.isInception, false);
});

// 7. triage sends correct payload (mock fetch)
test("7. triage sends correct payload: URL, method, headers, and body", async (t) => {
  let capturedUrl;
  let capturedOptions;

  globalThis.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedOptions = opts;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        model: "mercury-decide",
        answers: { q1: { type: "noul", noul: 0.97 } },
        usage: { input_tokens: 48, output_tokens: 1 },
      }),
      text: async () => "",
      headers: { get: () => "application/json" },
    };
  };
  t.after(restoreFetch);

  const client = new JevClient({ provider: "inception", apiKey: "test-key" });
  const result = await client.triage(
    { q1: { type: "noul", instructions: "Is this about billing?" } },
    { state: "test context" },
  );

  assert.equal(capturedUrl, "https://api.inceptionlabs.ai/v1/decisions");
  assert.equal(capturedOptions.method, "POST");

  const headers = JSON.parse(JSON.stringify(capturedOptions.headers));
  assert.equal(headers.authorization, "Bearer test-key");
  assert.equal(headers["content-type"], "application/json");

  const body = JSON.parse(capturedOptions.body);
  assert.deepEqual(body, {
    model: "mercury-decide",
    state: "test context",
    questions: {
      q1: { type: "noul", instructions: "Is this about billing?" },
    },
  });

  assert.equal(result.model, "mercury-decide");
  assert.equal(result.answers.q1.noul, 0.97);
});

// 8. triage parses noul response
test("8. triage parses noul response: answers.billing.noul === 0.97", async (t) => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: "mercury-decide",
      answers: { billing: { type: "noul", noul: 0.97 } },
      usage: { input_tokens: 48, output_tokens: 1 },
    }),
    text: async () => "",
    headers: { get: () => "application/json" },
  });
  t.after(restoreFetch);

  const client = new JevClient({ provider: "inception", apiKey: "test-key" });
  const res = await client.triage(
    { billing: { type: "noul", instructions: "Is this about billing?" } },
    { state: "test context" },
  );

  assert.equal(res.answers.billing.noul, 0.97);
  assert.equal(res.answers.billing.type, "noul");
});

// 9. triage parses choice response
test("9. triage parses choice response: choice and score validation", async (t) => {
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
    text: async () => "",
    headers: { get: () => "application/json" },
  });
  t.after(restoreFetch);

  const client = new JevClient({ provider: "inception", apiKey: "test-key" });
  const res = await client.triage(
    {
      team: {
        type: "choice",
        instructions: "Assign team",
        criteria: { billing: "Payments", support: "Technical" },
      },
    },
    { state: "User asks for refund" },
  );

  assert.equal(res.answers.team.choice, "billing");
  assert.equal(res.answers.team.score, 0.95);
  assert.equal(res.answers.team.confidence, 0.95);
  assert.deepEqual(res.answers.team.probabilities, { billing: 0.95, support: 0.05 });
});

// 10. TOKEN_COST_PER_1K includes mercury-decide
test("10. TOKEN_COST_PER_1K includes mercury-decide at 0.00002", () => {
  assert.equal(TOKEN_COST_PER_1K["mercury-decide"], 0.00002);
});

// 11. getProviderConfig returns correct inception config
test("11. getProviderConfig returns correct inception config", () => {
  const cfg = getProviderConfig("inception", { apiKey: "sk-test" });
  assert.equal(cfg.baseUrl, "https://api.inceptionlabs.ai/v1/decisions");
  assert.equal(cfg.apiKey, "sk-test");
  assert.equal(cfg.model, "mercury-decide");
  assert.equal(cfg.provider, "inception");
  assert.equal(cfg.id, "inception");
  assert.equal(cfg.needsAuth, true);
  assert.equal(cfg.endpoint, "/v1/decisions");
});

test("12. buildUrl replaces legacy /v1/systemone with /v1/decisions for inception provider", () => {
  // If the user previously had a /v1/systemone customBaseUrl, inception must still target /v1/decisions
  const client = new JevClient({
    provider: "inception",
    customBaseUrl: "http://127.0.0.1:20128/v1/systemone",
    apiKey: "test-sk",
  });
  assert.equal(client.buildUrl(), "http://127.0.0.1:20128/v1/decisions");
  assert.equal(client.buildUrl("/v1/systemone"), "http://127.0.0.1:20128/v1/decisions");
});

