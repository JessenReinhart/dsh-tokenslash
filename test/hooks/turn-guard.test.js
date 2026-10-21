// test/hooks/turn-guard.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateTurnCompletion, createTurnGuardHook } from "../../lib/hooks/turn-guard.js";
import { clearTriageCache } from "../../lib/triage.js";

test("evaluateTurnCompletion: returns correct shape and satisfied=true when satisfied", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => ({
      answers: {
        goal_satisfied: { noul: 0.85 },
        needs_followup: { noul: 0.15 },
      },
    }),
  };

  const res = await evaluateTurnCompletion(
    mockJev,
    { goalText: "Implement login", recentAssistantText: "Login done and tested.", turnCount: 3 }
  );

  assert.deepEqual(res, {
    satisfied: true,
    confidence: 0.85,
    needsFollowup: false,
    needs_followup_score: 0.15,
  });
});

test("evaluateTurnCompletion: satisfied=false when goal_satisfied is low", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => ({
      answers: {
        goal_satisfied: { noul: 0.45 },
        needs_followup: { noul: 0.2 },
      },
    }),
  };

  const res = await evaluateTurnCompletion(
    mockJev,
    { goalText: "Implement login", recentAssistantText: "Still working on it.", turnCount: 2 }
  );

  assert.equal(res.satisfied, false);
  assert.equal(res.confidence, 0.45);
  assert.equal(res.needsFollowup, false);
  assert.equal(res.needs_followup_score, 0.2);
});

test("evaluateTurnCompletion: satisfied=false and needsFollowup=true when needs_followup >= 0.4", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => ({
      answers: {
        goal_satisfied: { noul: 0.75 },
        needs_followup: { noul: 0.65 },
      },
    }),
  };

  const res = await evaluateTurnCompletion(
    mockJev,
    { goalText: "Build API", recentAssistantText: "Built part 1, do you want part 2?" }
  );

  assert.equal(res.satisfied, false);
  assert.equal(res.confidence, 0.75);
  assert.equal(res.needsFollowup, true);
  assert.equal(res.needs_followup_score, 0.65);
});

test("evaluateTurnCompletion: fails open when jevClient throws", async () => {
  clearTriageCache();
  const failingJev = {
    triage: async () => {
      throw new Error("Jev service unavailable");
    },
  };

  const res = await evaluateTurnCompletion(failingJev, {
    goalText: "Some goal",
    recentAssistantText: "Some text",
  });

  assert.deepEqual(res, {
    satisfied: true,
    confidence: 0,
    needsFollowup: false,
  });
});

test("evaluateTurnCompletion: fails open when jevClient is missing", async () => {
  clearTriageCache();
  const res = await evaluateTurnCompletion(null, {
    goalText: "Some goal",
    recentAssistantText: "Some text",
  });

  assert.deepEqual(res, {
    satisfied: true,
    confidence: 0,
    needsFollowup: false,
  });
});

test("evaluateTurnCompletion: supports client getter function", async () => {
  clearTriageCache();
  const client = {
    triage: async () => ({
      answers: {
        goal_satisfied: { noul: 0.9 },
        needs_followup: { noul: 0.05 },
      },
    }),
  };

  const res = await evaluateTurnCompletion(() => client, {
    goalText: "Test getter",
    recentAssistantText: "Finished successfully.",
  });

  assert.equal(res.satisfied, true);
  assert.equal(res.confidence, 0.9);
});

test("createTurnGuardHook: skips turn < 2", async () => {
  clearTriageCache();
  let triageCalled = false;
  const mockJev = {
    triage: async () => {
      triageCalled = true;
      return { answers: { goal_satisfied: { noul: 0.8 }, needs_followup: { noul: 0.1 } } };
    },
  };

  let recordCalled = false;
  const telemetry = {
    record: () => {
      recordCalled = true;
    },
  };

  const hook = createTurnGuardHook(
    {},
    mockJev,
    () => ({ modules: { turnGuard: true } }),
    telemetry
  );

  await hook({ turn: 1, agent: { session: { goal: { objective: "test" } } } });
  assert.equal(triageCalled, false);
  assert.equal(recordCalled, false);

  await hook({ turn: 0 });
  assert.equal(triageCalled, false);

  await hook({});
  assert.equal(triageCalled, false);
});

test("createTurnGuardHook: early-returns when module disabled", async () => {
  clearTriageCache();
  let triageCalled = false;
  const mockJev = {
    triage: async () => {
      triageCalled = true;
      return { answers: { goal_satisfied: { noul: 0.8 }, needs_followup: { noul: 0.1 } } };
    },
  };

  const hook = createTurnGuardHook(
    {},
    mockJev,
    () => ({ modules: { turnGuard: false } })
  );

  await hook({ turn: 2, agent: { session: { goal: { objective: "test" } } } });
  assert.equal(triageCalled, false);

  const hookNoModules = createTurnGuardHook({}, mockJev, () => ({}));
  await hookNoModules({ turn: 2 });
  assert.equal(triageCalled, false);
});

test("createTurnGuardHook: records telemetry when evaluation runs", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => ({
      answers: {
        goal_satisfied: { noul: 0.92 },
        needs_followup: { noul: 0.1 },
      },
    }),
  };

  let recordedEvent = null;
  const telemetry = {
    record: (name, payload) => {
      recordedEvent = { name, payload };
    },
  };

  const hook = createTurnGuardHook(
    {},
    mockJev,
    () => ({ modules: { turnGuard: true } }),
    telemetry
  );

  const agent = {
    session: {
      goal: { objective: "Complete report" },
      messages: [
        { role: "user", content: "Write report" },
        { role: "assistant", content: "Report complete and attached." },
      ],
    },
  };

  await hook({ turn: 3, agent });

  assert.ok(recordedEvent);
  assert.equal(recordedEvent.name, "turnCompletion");
  assert.equal(recordedEvent.payload.turn, 3);
  assert.equal(recordedEvent.payload.confidence, 0.92);
  assert.equal(recordedEvent.payload.satisfied, true);
});

test("createTurnGuardHook: invokes auto-steer when configured, !satisfied, and confidence > 0.6", async () => {
  clearTriageCache();
  // goal_satisfied is 0.75 (>0.6), but needs_followup is 0.8 => satisfied is false
  const mockJev = {
    triage: async () => ({
      answers: {
        goal_satisfied: { noul: 0.75 },
        needs_followup: { noul: 0.8 },
      },
    }),
  };

  let steerCalledWith = null;
  const agent = {
    goal: { objective: "Build full dashboard" },
    lastResponse: "I created the login view, but charts are not done.",
    steer: async (payload) => {
      steerCalledWith = payload;
    },
  };

  const hook = createTurnGuardHook(
    {},
    mockJev,
    () => ({ modules: { turnGuard: true }, turnGuardAutoSteer: true })
  );

  await hook({ turn: 4, agent });

  assert.ok(steerCalledWith);
  assert.equal(steerCalledWith.role, "user");
  assert.ok(steerCalledWith.content.includes("[turn-guard] The objective appears incomplete"));
});

test("createTurnGuardHook: does NOT auto-steer when turnGuardAutoSteer is false", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => ({
      answers: {
        goal_satisfied: { noul: 0.75 },
        needs_followup: { noul: 0.8 },
      },
    }),
  };

  let steerCalled = false;
  const agent = {
    goal: { objective: "Build dashboard" },
    lastResponse: "Work in progress",
    steer: async () => {
      steerCalled = true;
    },
  };

  const hook = createTurnGuardHook(
    {},
    mockJev,
    () => ({ modules: { turnGuard: true }, turnGuardAutoSteer: false })
  );

  await hook({ turn: 4, agent });
  assert.equal(steerCalled, false);
});

test("createTurnGuardHook: does NOT auto-steer when confidence <= 0.6", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => ({
      answers: {
        goal_satisfied: { noul: 0.4 },
        needs_followup: { noul: 0.8 },
      },
    }),
  };

  let steerCalled = false;
  const agent = {
    goal: { objective: "Build dashboard" },
    lastResponse: "Nothing done yet",
    steer: async () => {
      steerCalled = true;
    },
  };

  const hook = createTurnGuardHook(
    {},
    mockJev,
    () => ({ modules: { turnGuard: true }, turnGuardAutoSteer: true })
  );

  await hook({ turn: 4, agent });
  assert.equal(steerCalled, false);
});

test("createTurnGuardHook: does NOT auto-steer when satisfied is true", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => ({
      answers: {
        goal_satisfied: { noul: 0.9 },
        needs_followup: { noul: 0.1 },
      },
    }),
  };

  let steerCalled = false;
  const agent = {
    goal: { objective: "Build dashboard" },
    lastResponse: "All done completely",
    steer: async () => {
      steerCalled = true;
    },
  };

  const hook = createTurnGuardHook(
    {},
    mockJev,
    () => ({ modules: { turnGuard: true }, turnGuardAutoSteer: true })
  );

  await hook({ turn: 4, agent });
  assert.equal(steerCalled, false);
});

test("createTurnGuardHook: never throws when steer or logger fails", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => ({
      answers: {
        goal_satisfied: { noul: 0.8 },
        needs_followup: { noul: 0.9 },
      },
    }),
  };

  let warned = false;
  const ctx = {
    logger: {
      warn: () => {
        warned = true;
      },
    },
  };

  const agent = {
    goal: { objective: "Build dashboard" },
    lastResponse: "Not done",
    steer: async () => {
      throw new Error("Steering failed");
    },
  };

  const hook = createTurnGuardHook(
    ctx,
    mockJev,
    () => ({ modules: { turnGuard: true }, turnGuardAutoSteer: true })
  );

  // Must not throw
  await hook({ turn: 3, agent });
  assert.equal(warned, true);
});
