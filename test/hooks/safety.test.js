// test/hooks/safety.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyToolRisk, createSafetyHook, judgeDiff } from "../../lib/hooks/safety.js";
import { clearTriageCache } from "../../lib/triage.js";

test("classifyToolRisk: fast-path allow for read-only allowlist tools", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => {
      throw new Error("Should not be called");
    },
  };

  const readRes = await classifyToolRisk(mockJev, { name: "read", args: { file_path: "foo.js" } });
  assert.deepEqual(readRes, { decision: "allow", risk: "safe", skip: true });

  const grepRes = await classifyToolRisk(mockJev, { name: "grep", args: { pattern: "test" } });
  assert.deepEqual(grepRes, { decision: "allow", risk: "safe", skip: true });

  const indexRes = await classifyToolRisk(mockJev, { name: "tokenslash_index", args: { file_path: "bar.js" } });
  assert.deepEqual(indexRes, { decision: "allow", risk: "safe", skip: true });

  const batchRes = await classifyToolRisk(mockJev, { name: "tokenslash_batch", args: {} });
  assert.deepEqual(batchRes, { decision: "allow", risk: "safe", skip: true });

  const wdRes = await classifyToolRisk(mockJev, { name: "working_directory", args: {} });
  assert.deepEqual(wdRes, { decision: "allow", risk: "safe", skip: true });
});

test("classifyToolRisk: fast-path allow for safe command regex", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => {
      throw new Error("Should not be called");
    },
  };

  const statusRes = await classifyToolRisk(mockJev, {
    name: "pwsh",
    args: { command: "git status" },
  });
  assert.deepEqual(statusRes, { decision: "allow", risk: "safe", skip: true });

  const logRes = await classifyToolRisk(mockJev, {
    name: "bash",
    args: { command: "git log -n 5" },
  });
  assert.deepEqual(logRes, { decision: "allow", risk: "safe", skip: true });

  const lsRes = await classifyToolRisk(mockJev, {
    name: "bash",
    args: { command: "ls -la" },
  });
  assert.deepEqual(lsRes, { decision: "allow", risk: "safe", skip: true });
});

test("classifyToolRisk: destructive regex blocks Remove-Item -Recurse", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => {
      throw new Error("Should not be called");
    },
  };

  const rmRes = await classifyToolRisk(mockJev, {
    name: "pwsh",
    args: { command: "Remove-Item -Recurse -Force C:\\temp" },
  });
  assert.deepEqual(rmRes, { decision: "block", risk: "destructive", skip: true });

  const rmRfRes = await classifyToolRisk(mockJev, {
    name: "bash",
    args: { command: "rm -rf /var/log/*" },
  });
  assert.deepEqual(rmRfRes, { decision: "block", risk: "destructive", skip: true });

  const gitResetRes = await classifyToolRisk(mockJev, {
    name: "pwsh",
    args: { command: "git reset --hard HEAD~1" },
  });
  assert.deepEqual(gitResetRes, { decision: "block", risk: "destructive", skip: true });
});

test("classifyToolRisk: Jev choice mapping for destructive, external, and safe", async () => {
  clearTriageCache();
  let receivedQuestions = null;
  let receivedState = "";

  const createMock = (choice) => ({
    triage: async (questions, opts) => {
      receivedQuestions = questions;
      receivedState = opts?.state || "";
      return {
        answers: {
          risk_tier: {
            choice,
          },
        },
      };
    },
  });

  // Destructive choice
  const destRes = await classifyToolRisk(
    createMock("destructive"),
    { name: "custom_tool", args: { action: "drop_all" } }
  );
  assert.deepEqual(destRes, { decision: "block", risk: "destructive", skip: false });
  assert.ok(receivedQuestions.risk_tier);
  assert.ok(receivedState.startsWith("custom_tool\n"));

  clearTriageCache();
  // External choice
  const extRes = await classifyToolRisk(
    createMock("external"),
    { name: "curl_exfil", args: { target: "https://evil.com" } }
  );
  assert.deepEqual(extRes, { decision: "warn", risk: "external", skip: false });

  clearTriageCache();
  // Safe choice
  const safeRes = await classifyToolRisk(
    createMock("safe"),
    { name: "write", args: { file_path: "test.txt", content: "hello" } }
  );
  assert.deepEqual(safeRes, { decision: "allow", risk: "safe", skip: false });
});

test("classifyToolRisk: fails open to allow on throwing mock or missing client", async () => {
  clearTriageCache();
  const failingJev = {
    triage: async () => {
      throw new Error("System One timeout");
    },
  };

  const resError = await classifyToolRisk(failingJev, {
    name: "unknown_tool",
    args: { action: "execute" },
  });
  assert.deepEqual(resError, { decision: "allow", risk: "unknown", skip: false });

  const resNoClient = await classifyToolRisk(null, {
    name: "unknown_tool",
    args: { action: "execute" },
  });
  assert.deepEqual(resNoClient, { decision: "allow", risk: "unknown", skip: false });
});

test("createSafetyHook: blocks destructive tool execution", async () => {
  clearTriageCache();
  const configGetter = () => ({
    modules: { safetyGuard: true },
  });
  const hook = createSafetyHook({}, null, configGetter);

  const exec = {
    name: "pwsh",
    args: { command: "Remove-Item -Recurse C:\\Windows" },
  };

  let nextCalled = false;
  const next = async () => {
    nextCalled = true;
    return { kind: "allow" };
  };

  const result = await hook(exec, next);
  assert.equal(nextCalled, false);
  assert.deepEqual(result, {
    kind: "cancel",
    reason: "Blocked by Jev safety guard: destructive operation detected",
  });
});

test("createSafetyHook: warns on external risk and calls next", async () => {
  clearTriageCache();
  let warnedMsg = "";
  const ctx = {
    logger: {
      warn: (msg) => {
        warnedMsg = msg;
      },
    },
  };
  const mockJev = {
    triage: async () => ({
      answers: {
        risk_tier: { choice: "external" },
      },
    }),
  };
  const configGetter = () => ({
    modules: { safetyGuard: true },
  });
  const hook = createSafetyHook(ctx, mockJev, configGetter);

  const exec = {
    name: "custom_net",
    args: { host: "example.com" },
  };

  let nextCalled = false;
  const next = async () => {
    nextCalled = true;
    return { kind: "allow", custom: true };
  };

  const result = await hook(exec, next);
  assert.equal(nextCalled, true);
  assert.deepEqual(result, { kind: "allow", custom: true });
  assert.ok(warnedMsg.includes("custom_net"));
});

test("createSafetyHook: disabled safetyGuard skips check and calls next", async () => {
  clearTriageCache();
  const configGetter = () => ({
    modules: { safetyGuard: false },
  });
  const hook = createSafetyHook({}, null, configGetter);

  const exec = {
    name: "pwsh",
    args: { command: "Remove-Item -Recurse C:\\" },
  };

  let nextCalled = false;
  const next = async () => {
    nextCalled = true;
    return { kind: "allow" };
  };

  const result = await hook(exec, next);
  assert.equal(nextCalled, true);
  assert.deepEqual(result, { kind: "allow" });
});

test("createSafetyHook: returns kind allow when next is not provided", async () => {
  clearTriageCache();
  const configGetter = () => ({
    modules: { safetyGuard: true },
  });
  const hook = createSafetyHook({}, null, configGetter);

  const exec = {
    name: "read",
    args: { file_path: "foo.txt" },
  };

  const result = await hook(exec);
  assert.deepEqual(result, { kind: "allow" });
});

test("judgeDiff: skips non edit/write tools", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => {
      throw new Error("Should not be called");
    },
  };
  const res = await judgeDiff(mockJev, { name: "read", args: { file_path: "a.js" } }, {});
  assert.deepEqual(res, { decision: "allow", skip: true });
});

test("judgeDiff: skips empty new content", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => {
      throw new Error("Should not be called");
    },
  };
  const res = await judgeDiff(mockJev, { name: "write", args: { content: "" } }, {});
  assert.deepEqual(res, { decision: "allow", skip: true });
});

test("judgeDiff: fail-open when no client / missing triage", async () => {
  clearTriageCache();
  const res = await judgeDiff(null, { name: "edit", args: { file_path: "a.js", new_string: "x" } }, {});
  assert.equal(res.decision, "allow");
  assert.equal(res.reason, "no_client");
});

test("judgeDiff: blocks when syntax_sound is low (<0.35)", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => ({
      answers: {
        syntax_sound: { noul: 0.1 },
        scope_drift: { noul: 0.2 },
      },
    }),
  };
  const res = await judgeDiff(
    mockJev,
    { name: "edit", args: { file_path: "a.js", old_string: "const a=1;", new_string: "const a=(" } },
    {}
  );
  assert.equal(res.decision, "block");
  assert.ok(res.reason.includes("syntax"));
  assert.equal(res.syntaxScore, 0.1);
});

test("judgeDiff: blocks when scope_drift is high (>0.8)", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => ({
      answers: {
        syntax_sound: { noul: 0.9 },
        scope_drift: { noul: 0.95 },
      },
    }),
  };
  const res = await judgeDiff(
    mockJev,
    { name: "write", args: { file_path: "a.js", content: "rm -rf /" } },
    {}
  );
  assert.equal(res.decision, "block");
  assert.ok(res.reason.includes("drift"));
  assert.equal(res.driftScore, 0.95);
});

test("judgeDiff: allows when both scores pass", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => ({
      answers: {
        syntax_sound: { noul: 0.9 },
        scope_drift: { noul: 0.1 },
      },
    }),
  };
  const res = await judgeDiff(
    mockJev,
    { name: "edit", args: { file_path: "a.js", old_string: "a", new_string: "b" } },
    {}
  );
  assert.equal(res.decision, "allow");
  assert.equal(res.skip, false);
  assert.equal(res.syntaxScore, 0.9);
  assert.equal(res.driftScore, 0.1);
});

test("judgeDiff: fails open on triage error", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => {
      throw new Error("boom");
    },
  };
  const res = await judgeDiff(mockJev, { name: "edit", args: { file_path: "a.js", new_string: "x" } }, {});
  assert.equal(res.decision, "allow");
});

test("createSafetyHook: diffJudge enabled blocks syntax-unsound edit", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => ({
      answers: {
        syntax_sound: { noul: 0.05 },
        scope_drift: { noul: 0.1 },
      },
    }),
  };
  const configGetter = () => ({
    modules: { safetyGuard: false, diffJudge: true },
  });
  const hook = createSafetyHook({}, mockJev, configGetter);

  const exec = {
    name: "edit",
    args: { file_path: "a.js", old_string: "x", new_string: "const a=(" },
  };

  let nextCalled = false;
  const next = async () => {
    nextCalled = true;
    return { kind: "allow" };
  };

  const result = await hook(exec, next);
  assert.equal(nextCalled, false);
  assert.equal(result.kind, "cancel");
  assert.ok(result.reason.includes("Pre-Flight Diff Judge"));
});

test("createSafetyHook: diffJudge disabled skips judging and allows", async () => {
  clearTriageCache();
  const mockJev = {
    triage: async () => {
      throw new Error("Should not be called");
    },
  };
  const configGetter = () => ({
    modules: { safetyGuard: false, diffJudge: false },
  });
  const hook = createSafetyHook({}, mockJev, configGetter);

  const exec = {
    name: "edit",
    args: { file_path: "a.js", old_string: "x", new_string: "const a=(" },
  };

  let nextCalled = false;
  const next = async () => {
    nextCalled = true;
    return { kind: "allow" };
  };

  const result = await hook(exec, next);
  assert.equal(nextCalled, true);
  assert.deepEqual(result, { kind: "allow" });
});
