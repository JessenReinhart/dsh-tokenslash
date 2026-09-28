// test/hooks/goal-guard.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { createGoalGuardHook } from "../../lib/hooks/goal-guard.js";

test("goalGuardHook returns null when budget under 80%", async () => {
  let noticeCalled = false;
  const ctx = { app: { notice: () => { noticeCalled = true; } } };
  const guard = createGoalGuardHook(ctx, {});
  const res = await guard({ name: "my-goal", maxRounds: 10, rounds: 5 });
  assert.equal(res, null);
  assert.equal(noticeCalled, false);
});

test("goalGuardHook alerts when budget reaches 80%", async () => {
  let noticed = "";
  const ctx = {
    notice: (msg) => { noticed = msg; },
  };
  const guard = createGoalGuardHook(ctx, {});
  const res = await guard({ name: "deep-search", maxRounds: 10, rounds: 8 });
  assert.ok(res.includes('Goal "deep-search" is at 80%'));
  assert.equal(noticed, res);
});

test("goalGuardHook handles missing fields", async () => {
  const guard = createGoalGuardHook({}, {});
  const res = await guard(null);
  assert.equal(res, null);
});
