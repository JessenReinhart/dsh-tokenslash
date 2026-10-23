// test/hooks/observation-mask.test.js
import assert from "node:assert/strict";
import { test, describe } from "node:test";
import { createObservationMaskHook } from "../../lib/hooks/observation-mask.js";
import { clearTriageCache } from "../../lib/triage.js";

// Helper: generate a large string of given character count
function bigString(n) {
  return "x".repeat(n);
}

// Build a simple conversation with N user-assistant-tool turn sets.
// Newest turn is at the end.
function buildConvo({ turnCount = 4, toolOutputSize = 1000, toolName = "read" } = {}) {
  const messages = [];
  for (let i = 0; i < turnCount; i++) {
    messages.push({ role: "user", content: `question ${i}` });
    messages.push({
      role: "assistant",
      content: `answer ${i}`,
      tool_calls: [{ id: `call_${i}`, function: { name: toolName } }],
    });
    messages.push({
      role: "tool",
      tool_call_id: `call_${i}`,
      name: toolName,
      content: bigString(toolOutputSize),
    });
  }
  return messages;
}

const defaultConfig = () => ({
  modules: { observationMasking: true },
  observationMaskRetainTurns: 2,
  observationMaskMinChars: 800,
});

describe("observation-mask hook", () => {
  test("returns non-array input unchanged", async () => {
    const hook = createObservationMaskHook({}, defaultConfig, null);
    const result = await hook("not an array");
    assert.equal(result, "not an array");
  });

  test("returns short conversations (<=2 messages) unchanged", async () => {
    const hook = createObservationMaskHook({}, defaultConfig, null);
    const msgs = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const result = await hook(msgs);
    assert.deepEqual(result, msgs);
  });

  test("recent turns (< retainTurns) are never masked even if huge", async () => {
    const hook = createObservationMaskHook({}, defaultConfig, null);
    // 3 turns: turn indices from newest = 0,1,2 — retain 2 newest (index 0,1)
    const msgs = buildConvo({ turnCount: 3, toolOutputSize: 5000 });
    const result = await hook(msgs);

    // The last 2 turns (6 messages) should be identical
    for (let i = msgs.length - 6; i < msgs.length; i++) {
      assert.equal(result[i].content, msgs[i].content, `message index ${i} should be preserved`);
    }
  });

  test("older tool outputs larger than minChars are masked", async () => {
    const hook = createObservationMaskHook({}, defaultConfig, null);
    const msgs = buildConvo({ turnCount: 4, toolOutputSize: 2000, toolName: "pwsh" });
    const result = await hook(msgs);

    // Oldest 2 turns should have masked tool results (indices 2, 5 for 4 turns)
    // Turn structure: [user,assistant,tool] x 4
    // Turn0 = msgs[0..2], Turn1 = msgs[3..5], Turn2 = msgs[6..8], Turn3 = msgs[9..11]
    // Newest turn (index 0) = Turn3, turn index 1 = Turn2, turn index 2 = Turn1, turn index 3 = Turn0

    // Tool messages at index 2 (Turn0, oldest) and 5 (Turn1) should be masked
    assert.ok(
      typeof result[2].content === "string" && result[2].content.includes("[output masked:"),
      "oldest turn's tool output should be masked"
    );
    assert.ok(
      result[2].content.includes('tool "pwsh"'),
      "stub should contain tool name"
    );
    assert.ok(
      result[5].content.includes("[output masked:"),
      "second oldest turn's tool output should be masked"
    );
  });

  test("small outputs (< minChars) in older turns are kept", async () => {
    const hook = createObservationMaskHook({}, defaultConfig, null);
    const msgs = buildConvo({ turnCount: 4, toolOutputSize: 100 });
    const result = await hook(msgs);

    // Even old tool outputs under 800 chars should be untouched
    for (let i = 0; i < msgs.length; i++) {
      assert.equal(result[i].content, msgs[i].content, `message index ${i} should be unchanged`);
    }
  });

  test("tool_call_id and role are strictly preserved", async () => {
    const hook = createObservationMaskHook({}, defaultConfig, null);
    const msgs = buildConvo({ turnCount: 4, toolOutputSize: 2000 });
    const result = await hook(msgs);

    for (let i = 0; i < result.length; i++) {
      assert.equal(result[i].role, msgs[i].role, `role preserved at index ${i}`);
      if (msgs[i].tool_call_id) {
        assert.equal(result[i].tool_call_id, msgs[i].tool_call_id, `tool_call_id preserved at index ${i}`);
      }
    }
  });

  test("array content blocks are masked preserving structure", async () => {
    const hook = createObservationMaskHook({}, defaultConfig, null);
    const bigText = bigString(2000);
    const msgs = [
      { role: "user", content: "q0" },
      { role: "assistant", content: "a0" },
      {
        role: "tool",
        tool_call_id: "call_arr",
        name: "read",
        content: [
          { type: "text", text: bigText },
          { type: "text", text: "extra" },
        ],
      },
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "tool", tool_call_id: "call_2", name: "write", content: "small" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
      { role: "tool", tool_call_id: "call_3", name: "edit", content: "tiny" },
    ];
    const result = await hook(msgs);

    // The oldest tool (index 2) has array content and should be masked
    assert.ok(Array.isArray(result[2].content), "content should remain an array");
    assert.equal(result[2].content.length, 2, "should preserve block count");
    assert.equal(result[2].content[0].type, "text", "type field preserved");
    assert.ok(
      result[2].content[0].text.includes("[output masked:"),
      "first text block should contain the stub"
    );
    assert.equal(result[2].content[1].text, "", "subsequent text blocks should be emptied");
    // Structural fields preserved
    assert.equal(result[2].tool_call_id, "call_arr");
    assert.equal(result[2].role, "tool");
  });

  test("disabling the module returns messages unchanged", async () => {
    const config = () => ({
      modules: { observationMasking: false },
    });
    const hook = createObservationMaskHook({}, config, null);
    const msgs = buildConvo({ turnCount: 4, toolOutputSize: 5000 });
    const result = await hook(msgs);
    assert.deepEqual(result, msgs);
  });

  test("kind === 'tool_result' messages are eligible for masking", async () => {
    const hook = createObservationMaskHook({}, defaultConfig, null);
    const msgs = [
      { role: "user", content: "q0" },
      { role: "assistant", content: "a0" },
      { kind: "tool_result", tool_call_id: "call_k", content: bigString(2000), name: "glob" },
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "tool", tool_call_id: "call_k2", content: "ok", name: "edit" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
      { role: "tool", tool_call_id: "call_k3", content: "ok", name: "edit" },
    ];
    const result = await hook(msgs);
    assert.ok(
      typeof result[2].content === "string" && result[2].content.includes("[output masked:"),
      "kind=tool_result message should be masked"
    );
    assert.equal(result[2].tool_call_id, "call_k", "tool_call_id preserved on kind messages");
  });

  test("telemetry records saved tokens via recordSaved", async () => {
    let recorded = null;
    const telemetry = {
      recordSaved(type, tokens) {
        recorded = { type, tokens };
      },
    };
    const hook = createObservationMaskHook({}, defaultConfig, telemetry);
    const msgs = buildConvo({ turnCount: 4, toolOutputSize: 2000 });
    await hook(msgs);

    assert.ok(recorded !== null, "telemetry should have been called");
    assert.equal(recorded.type, "observation-mask");
    assert.ok(recorded.tokens > 0, "saved tokens should be positive");
  });

  test("telemetry falls back to recordTokenSavings", async () => {
    let recorded = null;
    const telemetry = {
      recordTokenSavings(type, tokens) {
        recorded = { type, tokens };
      },
    };
    const hook = createObservationMaskHook({}, defaultConfig, telemetry);
    const msgs = buildConvo({ turnCount: 4, toolOutputSize: 2000 });
    await hook(msgs);

    assert.ok(recorded !== null, "telemetry fallback should have been called");
    assert.equal(recorded.type, "observation-mask");
    assert.ok(recorded.tokens > 0, "saved tokens should be positive");
  });

  test("immutability: original messages are not mutated", async () => {
    const hook = createObservationMaskHook({}, defaultConfig, null);
    const msgs = buildConvo({ turnCount: 4, toolOutputSize: 2000 });
    const originalContents = msgs.map((m) => m.content);
    await hook(msgs);

    for (let i = 0; i < msgs.length; i++) {
      assert.equal(msgs[i].content, originalContents[i], `original message at index ${i} should be untouched`);
    }
  });

  test("custom retainTurns=0 masks all eligible tool outputs", async () => {
    const config = () => ({
      modules: { observationMasking: true },
      observationMaskRetainTurns: 0,
      observationMaskMinChars: 100,
    });
    const hook = createObservationMaskHook({}, config, null);
    const msgs = buildConvo({ turnCount: 3, toolOutputSize: 500 });
    const result = await hook(msgs);

    // All tool messages (indices 2, 5, 8) should be masked
    for (const idx of [2, 5, 8]) {
      assert.ok(
        typeof result[idx].content === "string" && result[idx].content.includes("[output masked:"),
        `tool at index ${idx} should be masked with retainTurns=0`
      );
    }
  });

  test("telemetry.record receives observation-mask savings (regression: recordSaved bug)", async () => {
    const telemetry = { totalTokensSaved: 0, calls: [] };
    telemetry.record = (action, tokens, meta) => {
      telemetry.totalTokensSaved += tokens;
      telemetry.calls.push({ action, tokens, meta });
    };
    const hook = createObservationMaskHook({}, defaultConfig, telemetry);
    const msgs = buildConvo({ turnCount: 4, toolOutputSize: 2000 });
    await hook(msgs);
    assert.ok(telemetry.totalTokensSaved > 0, "telemetry must record saved tokens");
    assert.ok(telemetry.calls.length > 0, "telemetry.record must be called");
    assert.equal(telemetry.calls[0].action, "observation-mask");
    assert.ok(typeof telemetry.calls[0].meta?.maskedCount === "number");
    assert.ok(telemetry.calls[0].meta.maskedCount >= 1);
  });

  test("masked stub contains lines and token estimates", async () => {
    const hook = createObservationMaskHook({}, defaultConfig, null);
    const multilineContent = "line1\nline2\nline3\n" + bigString(2000);
    const msgs = [
      { role: "user", content: "q0" },
      { role: "assistant", content: "a0" },
      { role: "tool", tool_call_id: "call_ml", name: "grep", content: multilineContent },
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "tool", tool_call_id: "call_ml2", name: "edit", content: "ok" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
      { role: "tool", tool_call_id: "call_ml3", name: "edit", content: "ok" },
    ];
    const result = await hook(msgs);
    const stub = result[2].content;
    assert.ok(stub.includes("lines"), "stub should mention lines");
    assert.ok(stub.includes("tokens"), "stub should mention tokens");
    assert.ok(stub.includes("grep"), "stub should mention tool name");
    assert.ok(stub.includes("result settled in prior turn"), "stub should have settled message");
  });

  describe("Jev-guarded selective observation masking", () => {
    test("preserves older tool output when Jev returns noul >= 0.6", async () => {
      clearTriageCache();
      let triageCalled = false;
      let capturedState = "";
      const mockJev = {
        triage: async (questions, opts) => {
          triageCalled = true;
          capturedState = opts?.state || "";
          return {
            answers: {
              relevant: { noul: 0.85 },
            },
          };
        },
      };
      const hook = createObservationMaskHook({}, mockJev, defaultConfig, null, null);
      const msgs = buildConvo({ turnCount: 4, toolOutputSize: 2000 });
      const originalContent = msgs[2].content;
      const result = await hook(msgs);

      assert.equal(triageCalled, true, "Jev triage should be called");
      assert.equal(result[2].content, originalContent, "candidate tool output must be preserved when noul >= 0.6");
      assert.ok(!String(result[2].content).includes("[output masked:"), "should not be masked");
    });

    test("masks older tool output when Jev returns noul < 0.6", async () => {
      clearTriageCache();
      let triageCalled = false;
      const mockJev = {
        triage: async () => {
          triageCalled = true;
          return {
            answers: {
              relevant: { noul: 0.25 },
            },
          };
        },
      };
      const hook = createObservationMaskHook({}, mockJev, defaultConfig, null, null);
      const msgs = buildConvo({ turnCount: 4, toolOutputSize: 2000 });
      const result = await hook(msgs);

      assert.equal(triageCalled, true, "Jev triage should be called");
      assert.ok(
        typeof result[2].content === "string" && result[2].content.includes("[output masked:"),
        "tool output should be masked when noul < 0.6"
      );
    });

    test("fails open to standard masking when Jev throws an error", async () => {
      clearTriageCache();
      const failingJev = {
        triage: async () => {
          throw new Error("Jev service unavailable");
        },
      };
      const hook = createObservationMaskHook({}, failingJev, defaultConfig, null, null);
      const msgs = buildConvo({ turnCount: 4, toolOutputSize: 2000 });
      const result = await hook(msgs);

      assert.ok(
        typeof result[2].content === "string" && result[2].content.includes("[output masked:"),
        "tool output should be masked when Jev fails"
      );
    });

    test("extracts userPrompt from promptTracker when agentId is provided", async () => {
      clearTriageCache();
      let capturedState = "";
      const mockJev = {
        triage: async (questions, opts) => {
          capturedState = opts?.state || "";
          return { answers: { relevant: { noul: 0.9 } } };
        },
      };
      const promptTracker = new Map([["agent-123", "Refactor the authentication logic in auth.js"]]);
      const hook = createObservationMaskHook({}, mockJev, defaultConfig, null, promptTracker);
      const msgs = buildConvo({ turnCount: 4, toolOutputSize: 2000 });
      await hook(msgs, "agent-123");

      assert.ok(
        capturedState.includes("Refactor the authentication logic in auth.js"),
        "state should include prompt from promptTracker"
      );
      assert.ok(capturedState.includes("read"), "state should include tool name");
    });

    test("batches multiple candidate tool results into a single Jev triage call", async () => {
      clearTriageCache();
      let triageCallCount = 0;
      let questionKeys = [];
      const mockJev = {
        triage: async (questions) => {
          triageCallCount++;
          questionKeys = Object.keys(questions);
          const answers = {};
          for (const k of questionKeys) {
            answers[k] = { noul: 0.8 };
          }
          return { answers };
        },
      };
      const hook = createObservationMaskHook({}, mockJev, defaultConfig, null, null);
      const msgs = buildConvo({ turnCount: 5, toolOutputSize: 2000 });
      const result = await hook(msgs);

      assert.equal(triageCallCount, 1, "triage should be called exactly once (single batch)");
      assert.ok(questionKeys.length >= 2, "should batch all candidate questions in one request");
      assert.ok(!String(result[2].content).includes("[output masked:"), "candidate should be preserved");
    });

    test("falls back to last user message in messages when promptTracker is absent", async () => {
      clearTriageCache();
      let capturedState = "";
      const mockJev = {
        triage: async (questions, opts) => {
          capturedState = opts?.state || "";
          return { answers: { relevant: { noul: 0.7 } } };
        },
      };
      const hook = createObservationMaskHook({}, mockJev, defaultConfig, null, null);
      const msgs = buildConvo({ turnCount: 4, toolOutputSize: 2000 });
      // In buildConvo(4), the last user message is "question 3"
      await hook(msgs);

      assert.ok(capturedState.includes("question 3"), "state should include last user message");
    });

    test("supports getter function for jevClientOrGetter", async () => {
      clearTriageCache();
      let called = false;
      const mockJev = {
        triage: async () => {
          called = true;
          return { answers: { relevant: { noul: 0.95 } } };
        },
      };
      const hook = createObservationMaskHook({}, () => mockJev, defaultConfig);
      const msgs = buildConvo({ turnCount: 4, toolOutputSize: 2000 });
      const originalContent = msgs[2].content;
      const result = await hook(msgs);

      assert.equal(called, true, "Jev getter function should be called");
      assert.equal(result[2].content, originalContent, "candidate tool output must be preserved");
    });
  });
});
