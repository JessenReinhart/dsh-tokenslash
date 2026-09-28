// test/hooks/routing.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRoutingHook,
  interceptSubagentRequest,
  attachSubagentRouting,
  classifyTaskTier,
  pickTierModel,
  extractTaskText,
} from "../../lib/hooks/routing.js";

test("routingHook continues when modules disabled", async () => {
  const hook = createRoutingHook({}, { modules: { subagentRouting: false, toolPruning: false } }, {});
  const res = await hook({ name: "grep" }, { pattern: "foo" });
  assert.deepEqual(res, { continue: true });
});

test("routingHook vetoes on no/false decision", async () => {
  const mockJev = {
    triage: async () => ({ route: "no, should not route" }),
  };
  const hook = createRoutingHook({}, { modules: { subagentRouting: true } }, mockJev);
  const res = await hook({ name: "grep" }, { pattern: "foo" });
  assert.equal(res.continue, false);
  assert.equal(res.reason, "routing veto");
});

test("routingHook continues on positive decision", async () => {
  const mockJev = {
    triage: async () => ({ route: "yes, proceed" }),
  };
  const hook = createRoutingHook({}, { modules: { subagentRouting: true } }, mockJev);
  const res = await hook({ name: "grep" }, { pattern: "foo" });
  assert.equal(res.continue, true);
});

test("routingHook fails open on error", async () => {
  const mockJev = {
    triage: async () => {
      throw new Error("Jev down");
    },
  };
  const hook = createRoutingHook({}, { modules: { subagentRouting: true } }, mockJev);
  const res = await hook({ name: "grep" }, { pattern: "foo" });
  assert.equal(res.continue, true);
});

test("extractTaskText extracts from string or block array", () => {
  const text1 = extractTaskText({ label: "task label", prompt: [{ type: "text", text: "prompt text" }] });
  assert.equal(text1, "task label\nprompt text");

  const text2 = extractTaskText({ label: "label only", prompt: "raw string" });
  assert.equal(text2, "label only\nraw string");
});

test("classifyTaskTier and pickTierModel behave correctly", () => {
  assert.equal(classifyTaskTier("simple echo task"), "cheap");
  assert.equal(classifyTaskTier("deep analysis and complex reasoning"), "smart");

  const config = {
    model: "default-model",
    modelTiers: {
      cheap: "cheap-model-1, cheap-model-2",
      smart: "smart-model-1",
    },
  };
  assert.equal(pickTierModel("cheap", config), "cheap-model-1");
  assert.equal(pickTierModel("smart", config), "smart-model-1");
  assert.equal(pickTierModel("unknown", config), "default-model");
});

test("interceptSubagentRequest routes when model is unspecified", async () => {
  const mockJev = {
    triage: async () => ({ tier: "cheap" }),
  };
  const config = {
    modelTiers: { cheap: "gemini-2.5-flash" },
  };
  const request = {
    label: "fast search",
    prompt: [{ type: "text", text: "quick lookup" }],
    parent: { options: { model: "claude-3-7-sonnet" } },
  };

  await interceptSubagentRequest(request, "spawn", config, mockJev, null, null);
  assert.equal(request.agentOptions?.model, "gemini-2.5-flash");
});

test("interceptSubagentRequest routes when model equals parent default model", async () => {
  const mockJev = {
    triage: async () => ({ tier: "smart" }),
  };
  const config = {
    modelTiers: { smart: "deepseek-reasoner" },
  };
  const request = {
    label: "complex problem",
    prompt: [{ type: "text", text: "deep logical proof" }],
    parent: { options: { model: "deepseek-chat" } },
    agentOptions: { model: "deepseek-chat" },
  };

  await interceptSubagentRequest(request, "fork", config, mockJev, null, null);
  assert.equal(request.agentOptions?.model, "deepseek-reasoner");
});

test("interceptSubagentRequest preserves custom explicit model", async () => {
  const mockJev = {
    triage: async () => ({ tier: "cheap" }),
  };
  const config = {
    modelTiers: { cheap: "gemini-2.5-flash" },
  };
  const request = {
    label: "custom request",
    prompt: [{ type: "text", text: "quick run" }],
    parent: { options: { model: "parent-model" } },
    agentOptions: { model: "user-chosen-model" },
  };

  await interceptSubagentRequest(request, "spawn", config, mockJev, null, null);
  assert.equal(request.agentOptions?.model, "user-chosen-model");
});

test("attachSubagentRouting monkey-patches startContinuable and start", async () => {
  let continuableRan = false;
  let startRan = false;

  const mockSubagents = {
    async startContinuable(spec) {
      continuableRan = true;
      return { childId: "child-1", messageId: "msg-1" };
    },
    async start(name, req) {
      startRan = true;
      return { id: "run-1" };
    },
  };

  let registeredDisposer = null;
  const mockSubCtx = {
    subagents: mockSubagents,
    effect(fn) {
      registeredDisposer = fn();
    },
  };

  const mockCtx = {
    inject(deps, callback) {
      assert.deepEqual(deps, ["subagents"]);
      callback(mockSubCtx);
    },
  };

  const mockJev = {
    triage: async () => ({ tier: "cheap" }),
  };
  const config = {
    enabled: true,
    modules: { subagentRouting: true },
    modelTiers: { cheap: "cheap-model" },
  };

  attachSubagentRouting(mockCtx, config, mockJev, null);

  // Test startContinuable interception
  const spec = {
    provider: "spawn",
    request: {
      label: "task",
      prompt: [{ type: "text", text: "do work" }],
      parent: { options: { model: "parent-model" } },
    },
  };
  const resContinuable = await mockSubagents.startContinuable(spec);
  assert.equal(continuableRan, true);
  assert.equal(spec.request.agentOptions?.model, "cheap-model");
  assert.equal(resContinuable.childId, "child-1");

  // Test start interception
  const startReq = {
    label: "task 2",
    prompt: [{ type: "text", text: "do more work" }],
    parent: { options: { model: "parent-model" } },
  };
  const resStart = await mockSubagents.start("spawn", startReq);
  assert.equal(startRan, true);
  assert.equal(startReq.agentOptions?.model, "cheap-model");
  assert.equal(resStart.id, "run-1");

  // Disposer restores original functions
  assert.equal(typeof registeredDisposer, "function");
  registeredDisposer();
});
