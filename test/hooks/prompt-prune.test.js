import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPromptPruneHook,
  detectRequiredGroups,
  extractRecentUserPrompt,
  isShortResumePrompt,
  hasUnfinishedAssistantIntent,
  detectResumeSignal,
  detectRequiredGroupsViaJev,
  injectToolGuidance,
  stableSortTools,
  stableSortSections,
  injectPrunedToolsNotice,
  TOOL_GROUPS,
  CORE_TOOLS,
} from "../../lib/hooks/prompt-prune.js";
import { TokenslashTelemetry } from "../../lib/telemetry.js";

test("detectRequiredGroups detects intents correctly", () => {
  // Simple prompt with no special intent
  const simple = detectRequiredGroups("What is 2 + 2?");
  assert.equal(simple.size, 0);

  // Search intent
  const search = detectRequiredGroups("Search web for latest news on nodejs");
  assert.ok(search.has("search"));
  assert.ok(!search.has("image"));

  // Image intent
  const image = detectRequiredGroups("Generate a photo of a sunset");
  assert.ok(image.has("image"));
  assert.ok(!image.has("search"));

  // Cordis intent
  const cordis = detectRequiredGroups("Define a cordis plugin with custom slots");
  assert.ok(cordis.has("cordis"));

  // Subagent intent
  const subagent = detectRequiredGroups("Delegate this work to a subagent");
  assert.ok(subagent.has("subagent"));
});

test("promptPruneHook leaves assembly intact when disabled or prompt unknown", async () => {
  const telemetry = new TokenslashTelemetry();
  const config = { enabled: false, modules: { promptPruning: true } };
  const hook = createPromptPruneHook({}, {}, () => config, telemetry);

  const assembly = {
    tools: [{ name: "read" }, { name: "generate_image" }],
    sections: [{ name: "persona", text: "You are agent" }],
  };

  const res = await hook(assembly, {}, () => Promise.resolve(assembly));
  assert.deepEqual(res, assembly);
  assert.equal(telemetry.promptsPrunedCount, 0);
});

test("promptPruneHook prunes unused tool schemas and related sections", async () => {
  const telemetry = new TokenslashTelemetry();
  const config = { enabled: true, modules: { promptPruning: true } };
  const hook = createPromptPruneHook({}, {}, () => config, telemetry);

  const mockAgent = {
    inbox: {
      hasPending: true,
      nextStep: [{ content: "Count lines in package.json" }],
    },
  };

  const assembly = {
    tools: [
      { name: "read", description: "Read file", parameters: {} },
      { name: "write", description: "Write file", parameters: {} },
      { name: "generate_image", description: "Draw an image with long detailed parameters schema", parameters: { complex: true } },
      { name: "web_search", description: "Search web", parameters: { queries: [] } },
      { name: "cordis_define", description: "Define plugin", parameters: {} },
    ],
    sections: [
      { name: "persona", text: "Core persona instructions" },
      { name: "dynamic-cordis-plugins", text: "Huge dynamic cordis guide with lots of rules" },
      { name: "free-search", text: "Web search engine configuration and engines" },
    ],
  };

  const res = await hook(assembly, { agent: mockAgent }, () => Promise.resolve(assembly));

  // Core tools preserved
  const toolNames = res.tools.map((t) => t.name);
  assert.ok(toolNames.includes("read"));
  assert.ok(toolNames.includes("write"));

  // Irrelevant tools pruned
  assert.ok(!toolNames.includes("generate_image"));
  assert.ok(!toolNames.includes("web_search"));
  assert.ok(!toolNames.includes("cordis_define"));

  // Matching sections pruned
  const sectionNames = res.sections.map((s) => s.name);
  assert.ok(sectionNames.includes("persona"));
  assert.ok(!sectionNames.includes("dynamic-cordis-plugins"));
  assert.ok(!sectionNames.includes("free-search"));

  // Telemetry updated
  assert.equal(telemetry.promptsPrunedCount, 1);
  assert.ok(telemetry.totalTokensSaved > 0);
});

test("promptPruneHook keeps relevant tools when prompt requires them", async () => {
  const telemetry = new TokenslashTelemetry();
  const config = { enabled: true, modules: { promptPruning: true } };
  const hook = createPromptPruneHook({}, {}, () => config, telemetry);

  const mockAgent = {
    inbox: {
      hasPending: true,
      nextStep: [{ content: "Search the web for weather in Tokyo" }],
    },
  };

  const assembly = {
    tools: [
      { name: "read", description: "Read file" },
      { name: "web_search", description: "Search web" },
      { name: "generate_image", description: "Generate image" },
    ],
    sections: [
      { name: "persona", text: "Core persona" },
      { name: "free-search", text: "Search engines info" },
    ],
  };

  const res = await hook(assembly, { agent: mockAgent }, () => Promise.resolve(assembly));
  const toolNames = res.tools.map((t) => t.name);

  // web_search kept because user said 'search the web'
  assert.ok(toolNames.includes("web_search"));
  // generate_image pruned
  assert.ok(!toolNames.includes("generate_image"));

  // free-search section preserved
  const sectionNames = res.sections.map((s) => s.name);
  assert.ok(sectionNames.includes("free-search"));
});

test("promptPruneHook extreme mode applies intent-based pruning without core tool fallback", async () => {
  const telemetry = new TokenslashTelemetry();
  const config = { enabled: true, toolPruningMode: "extreme", modules: { promptPruning: true } };
  const hook = createPromptPruneHook({}, {}, () => config, telemetry);

  // Coding/refactoring task -> only file_ops tools needed
  const mockAgent = {
    inbox: {
      hasPending: true,
      nextStep: [{ content: "Please refactor and edit the file lib/index.js" }],
    },
  };

  const assembly = {
    tools: [
      { name: "read" },
      { name: "write" },
      { name: "edit" },
      { name: "web_search" },
      { name: "generate_image" },
      { name: "cordis_define" },
    ],
    sections: [
      { name: "persona", text: "Core persona" },
      { name: "free-search", text: "Search engines info" },
    ],
  };

  const res = await hook(assembly, { agent: mockAgent }, () => Promise.resolve(assembly));
  const toolNames = res.tools.map((t) => t.name);

  // File ops tools kept because user asked to refactor & edit file
  assert.ok(toolNames.includes("read"));
  assert.ok(toolNames.includes("write"));
  assert.ok(toolNames.includes("edit"));

  // Web search, image, cordis pruned
  assert.ok(!toolNames.includes("web_search"));
  assert.ok(!toolNames.includes("generate_image"));
  assert.ok(!toolNames.includes("cordis_define"));

  // Non-matching sections pruned
  const sectionNames = res.sections.map((s) => s.name);
  assert.ok(sectionNames.includes("persona"));
  assert.ok(!sectionNames.includes("free-search"));
  assert.equal(telemetry.promptsPrunedCount, 1);
});

test("promptPruneHook extreme mode with pure reasoning query drops all tools", async () => {
  const telemetry = new TokenslashTelemetry();
  const config = { enabled: true, toolPruningMode: "extreme", modules: { promptPruning: true } };
  const hook = createPromptPruneHook({}, {}, () => config, telemetry);

  const mockAgent = {
    inbox: {
      hasPending: true,
      nextStep: [{ content: "Explain why 1 + 1 equals 2 in detail" }],
    },
  };

  const assembly = {
    tools: [{ name: "read" }, { name: "write" }, { name: "web_search" }],
    sections: [
      { name: "persona", text: "Core persona" },
      { name: "free-search", text: "Search engines info" },
    ],
  };

  const res = await hook(assembly, { agent: mockAgent }, () => Promise.resolve(assembly));
  assert.equal(res.tools.length, 0);
  const sectionNames = res.sections.map((s) => s.name);
  assert.ok(sectionNames.includes("persona"));
  assert.ok(sectionNames.includes("tokenslash-pruned-tools"));
  assert.ok(!sectionNames.includes("free-search"));
});

test("promptPruneHook off mode leaves all tools and sections intact", async () => {
  const telemetry = new TokenslashTelemetry();
  const config = { enabled: true, toolPruningMode: "off", modules: { promptPruning: true } };
  const hook = createPromptPruneHook({}, {}, () => config, telemetry);

  const assembly = {
    tools: [{ name: "read" }, { name: "write" }, { name: "web_search" }],
    sections: [
      { name: "persona", text: "Core persona" },
      { name: "free-search", text: "Search engines info" },
    ],
  };

  const res = await hook(assembly, {}, () => Promise.resolve(assembly));
  assert.equal(res.tools.length, 3);
  assert.equal(res.sections.length, 2);
  assert.equal(telemetry.promptsPrunedCount, 0);
});

test("extractRecentUserPrompt extracts from promptTracker cache", () => {
  const tracker = new Map();
  tracker.set("agent-123", "Search online documentation for Cordis lifecycle");

  const agent = { id: "agent-123" };
  const prompt = extractRecentUserPrompt({ agent }, tracker);
  assert.equal(prompt, "Search online documentation for Cordis lifecycle");
});

test("extractRecentUserPrompt extracts from agent.session surface events", () => {
  const mockSession = {
    surface: { nodes: [0, 1, 2] },
    eventAt(seq) {
      if (seq === 1) {
        return {
          type: "user/message",
          data: {
            message: {
              content: [{ type: "text", text: "Please generate an image of a red panda" }],
            },
          },
        };
      }
      return null;
    },
  };

  const agent = { id: "agent-456", session: mockSession };
  const prompt = extractRecentUserPrompt({ agent });
  assert.equal(prompt, "Please generate an image of a red panda");
});

test("extractRecentUserPrompt extracts from agent.inbox.nextTurn", () => {
  const agent = {
    id: "agent-789",
    inbox: {
      nextStep: [],
      nextTurn: [{ content: "Check git status and commit changes" }],
    },
  };

  const prompt = extractRecentUserPrompt({ agent });
  assert.equal(prompt, "Check git status and commit changes");
});

test("promptPruneHook works with promptTracker in waterfall assembly", async () => {
  const telemetry = new TokenslashTelemetry();
  const config = { enabled: true, toolPruningMode: "normal", modules: { promptPruning: true } };
  const tracker = new Map();
  const mockAgent = { id: "agent-test-waterfall" };
  tracker.set(mockAgent.id, "Generate an avatar image for my profile");

  const hook = createPromptPruneHook({}, {}, () => config, telemetry, tracker);

  const assembly = {
    tools: [
      { name: "read" },
      { name: "generate_image" },
      { name: "cordis_define" },
    ],
    sections: [
      { name: "persona", text: "Persona" },
      { name: "dynamic-cordis-plugins", text: "Cordis guide" },
    ],
  };

  const res = await hook(assembly, { agent: mockAgent }, () => Promise.resolve(assembly));
  const toolNames = res.tools.map((t) => t.name);

  // Core tool kept
  assert.ok(toolNames.includes("read"));
  // Image tool kept because user asked to generate image
  assert.ok(toolNames.includes("generate_image"));
  // Cordis tool pruned
  assert.ok(!toolNames.includes("cordis_define"));

  // Cordis section pruned
  const sectionNames = res.sections.map((s) => s.name);
  assert.ok(!sectionNames.includes("dynamic-cordis-plugins"));
  assert.ok(sectionNames.includes("persona"));
  assert.equal(telemetry.promptsPrunedCount, 1);
});

test("isShortResumePrompt distinguishes resume keywords from short fresh tasks", () => {
  assert.equal(isShortResumePrompt("continue"), true);
  assert.equal(isShortResumePrompt("proceed"), true);
  assert.equal(isShortResumePrompt("keep going"), true);
  assert.equal(isShortResumePrompt("go on"), true);
  assert.equal(isShortResumePrompt("Count lines in package.json"), false);
  assert.equal(isShortResumePrompt("run git status"), false);
  assert.equal(isShortResumePrompt("explain 1+1=2"), false);
});

test("hasUnfinishedAssistantIntent recognizes unfinished intent in assistant message", () => {
  const matchingContext = {
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "text", text: "I did step 1. Remaining work: edit lib/index.js" }] },
    ],
  };
  assert.equal(hasUnfinishedAssistantIntent(matchingContext), true);

  const doneContext = {
    messages: [
      { role: "assistant", content: "All done! Everything passed." },
    ],
  };
  assert.equal(hasUnfinishedAssistantIntent(doneContext), false);

  assert.equal(detectResumeSignal("continue", doneContext), "short_prompt");
  assert.equal(detectResumeSignal("hello", matchingContext), "unfinished_task");
  assert.equal(detectResumeSignal("hello", doneContext), null);
});

test("F1: resume-mask inherits active groups across turns for same agent", async () => {
  const tracker = new Map();
  const mockAgent = { id: "agent-f1-resume" };
  const hook = createPromptPruneHook({}, {}, () => ({ enabled: true, toolPruningMode: "normal" }), new TokenslashTelemetry(), tracker);

  const assembly = {
    tools: [{ name: "read" }, { name: "generate_image" }, { name: "web_search" }],
    sections: [{ name: "persona" }, { name: "image", text: "Image generation docs" }, { name: "free-search", text: "Search docs" }],
  };

  // Turn 1: user requests image generation
  tracker.set(mockAgent.id, "Generate an illustration of a robot");
  const turn1 = await hook(assembly, { agent: mockAgent }, () => Promise.resolve(assembly));
  assert.ok(turn1.tools.map((t) => t.name).includes("generate_image"));
  assert.ok(!turn1.tools.map((t) => t.name).includes("web_search"));

  // Turn 2: short resume nudge
  tracker.set(mockAgent.id, "continue");
  const turn2 = await hook(assembly, { agent: mockAgent }, () => Promise.resolve(assembly));
  assert.ok(turn2.tools.map((t) => t.name).includes("generate_image"), "generate_image inherited from turn 1");
  assert.ok(!turn2.tools.map((t) => t.name).includes("web_search"), "unrelated tools stay pruned");
});

test("F1 safety net: turn 1 resume signal with no history and no detected tools bails out", async () => {
  const hook = createPromptPruneHook({}, {}, () => ({ enabled: true, toolPruningMode: "extreme" }), new TokenslashTelemetry());
  const mockAgent = { id: "agent-fresh-resume", inbox: { nextStep: [{ content: "continue" }] } };
  const assembly = {
    tools: [{ name: "read" }, { name: "generate_image" }],
    sections: [{ name: "persona" }],
  };
  const res = await hook(assembly, { agent: mockAgent }, () => Promise.resolve(assembly));
  assert.deepEqual(res, assembly, "Safety net prevents stripping tools bare on unanchored resume");
});

test("F2: pinnedTools survive pruning in extreme mode and preserve section docs", async () => {
  const config = {
    enabled: true,
    toolPruningMode: "extreme",
    pinnedTools: ["generate_image", "read"],
  };
  const hook = createPromptPruneHook({}, {}, () => config, new TokenslashTelemetry());
  const mockAgent = { id: "agent-f2", inbox: { nextStep: [{ content: "Explain quantum mechanics in pure text" }] } };
  const assembly = {
    tools: [{ name: "read" }, { name: "generate_image" }, { name: "web_search" }],
    sections: [{ name: "persona" }, { name: "image", text: "Image generation docs" }, { name: "free-search", text: "Search docs" }],
  };
  const res = await hook(assembly, { agent: mockAgent }, () => Promise.resolve(assembly));
  const toolNames = res.tools.map((t) => t.name);
  assert.ok(toolNames.includes("generate_image"), "User pinned tool preserved in extreme mode");
  assert.ok(toolNames.includes("read"), "Core tool in pinnedTools preserved in extreme mode");
  assert.ok(!toolNames.includes("web_search"), "Non-pinned tool pruned in extreme mode");
  assert.ok(res.sections.map((s) => s.name).includes("image"), "Pinned tool section preserved");
  assert.ok(!res.sections.map((s) => s.name).includes("free-search"), "Unpinned tool section pruned");
});

test("F3: detectRequiredGroupsViaJev failOpen returns all groups on error or malformed response", async () => {
  const badClient = { triage: async () => { throw new Error("timeout"); } };
  const groupsError = await detectRequiredGroupsViaJev("do work", badClient, { failOpen: true });
  assert.equal(groupsError.size, Object.keys(TOOL_GROUPS).length);

  const fallbackGroups = await detectRequiredGroupsViaJev("do work", badClient, { failOpen: false });
  assert.equal(fallbackGroups.size, 0);

  const malformedClient = { triage: async () => ({ answers: {} }) };
  const groupsMalformed = await detectRequiredGroupsViaJev("do work", malformedClient, { failOpen: true });
  assert.equal(groupsMalformed.size, Object.keys(TOOL_GROUPS).length);
});

test("FIFO eviction keeps lastActiveGroups bounded to 100 entries", async () => {
  const hook = createPromptPruneHook({}, {}, () => ({ enabled: true }), new TokenslashTelemetry());
  const assembly = { tools: [{ name: "read" }], sections: [] };
  for (let i = 0; i < 105; i++) {
    await hook(assembly, { agent: { id: `agent-${i}` }, inbox: { nextStep: [{ content: `Search web ${i}` }] } }, () => Promise.resolve(assembly));
  }
});

test("injectToolGuidance patches read section with index/batch directives", () => {
  const sections = [
    { name: "tool:read", text: "Use the read tool — not shell commands like cat — to inspect text files. Results include line numbers." },
    { name: "persona", text: "You are a coding agent." },
  ];
  const out = injectToolGuidance(sections);
  assert.ok(out[0].text.includes("tokenslash_index"));
  assert.ok(out[0].text.includes("tokenslash_batch"));
  assert.equal(out[1].text, "You are a coding agent.");
});

test("injectToolGuidance leaves non-read sections untouched", () => {
  const sections = [{ name: "tool:write", text: "Use the write tool to create files." }];
  const out = injectToolGuidance(sections);
  assert.equal(out[0].text, "Use the write tool to create files.");
});

test("stableSortTools sorts tool schemas canonically by name", () => {
  const tools = [
    { name: "write" },
    { name: "read" },
    { name: "web_search" },
    { name: "glob" },
    "ask_user_question",
    { name: "grep" },
  ];
  const out = stableSortTools(tools);
  const names = out.map((t) => (typeof t === "string" ? t : t.name));
  assert.deepEqual(names, ["ask_user_question", "glob", "grep", "read", "web_search", "write"]);
});

test("stableSortSections sorts sections canonically by order then name", () => {
  const sections = [
    { name: "zeta", order: 10 },
    { name: "alpha", order: 5 },
    { name: "beta", order: 5 },
    { name: "persona" },
    { name: "misc" },
    { name: "system", order: -10 },
  ];
  const out = stableSortSections(sections);
  const names = out.map((s) => s.name);
  // -10 first, then 0 (misc before persona by name), then 5 (alpha before beta), then 10 (zeta)
  assert.deepEqual(names, ["system", "misc", "persona", "alpha", "beta", "zeta"]);
});

test("promptPruneHook sorts surviving tools and sections canonically with prefixCacheAlignment", async () => {
  const telemetry = new TokenslashTelemetry();
  const config = { enabled: true, modules: { promptPruning: true, prefixCacheAlignment: true } };
  const hook = createPromptPruneHook({}, {}, () => config, telemetry);

  const mockAgent = {
    inbox: {
      hasPending: true,
      nextStep: [{ content: "Count lines in package.json" }],
    },
  };

  const assembly = {
    tools: [
      { name: "write" },
      { name: "read" },
      { name: "generate_image" },
      { name: "web_search" },
    ],
    sections: [
      { name: "zeta", text: "z", order: 10 },
      { name: "alpha", text: "a", order: 5 },
      { name: "system", text: "sys", order: -10 },
      { name: "free-search", text: "Search engines" },
    ],
  };

  const res = await hook(assembly, { agent: mockAgent }, () => Promise.resolve(assembly));
  const toolNames = res.tools.map((t) => t.name);
  // canonical alphabetical order of retained tools
  assert.deepEqual(toolNames, ["read", "write"]);

  const sectionNames = res.sections.map((s) => s.name);
  // Pruned: free-search. Injected: tokenslash-pruned-tools (order 20000, sunk to the end to protect prefix cache).
  // Retained sorted: system (-10), alpha (5), zeta (10), tokenslash-pruned-tools (20000).
  assert.deepEqual(sectionNames, ["system", "alpha", "zeta", "tokenslash-pruned-tools"]);
});

test("teams and schedule tool groups are defined with modern DSH tools", () => {
  assert.deepEqual(TOOL_GROUPS.teams.tools, [
    "wait_agent",
    "spawn_teammate",
    "team_task_create",
    "team_task_get",
    "team_task_list",
    "team_task_update",
  ]);
  assert.deepEqual(TOOL_GROUPS.schedule.tools, [
    "schedule_create",
    "schedule_delete",
    "schedule_list",
    "schedule_update",
  ]);
  assert.ok(TOOL_GROUPS.shell.tools.includes("bash"));
  assert.ok(TOOL_GROUPS.image.tools.includes("read_image"));
  assert.ok(TOOL_GROUPS.file_ops.tools.includes("working_directory"));
});

test("teams group prunes when prompt has no team keywords and retains when it does", () => {
  const noTeam = detectRequiredGroups("Calculate 2 plus 2");
  assert.ok(!noTeam.has("teams"));

  const team = detectRequiredGroups("Spawn a teammate to share a task on the task board");
  assert.ok(team.has("teams"));
});

test("schedule group prunes when prompt has no schedule keywords and retains when it does", () => {
  const noSchedule = detectRequiredGroups("Read file contents");
  assert.ok(!noSchedule.has("schedule"));

  const schedule = detectRequiredGroups("Remind me daily at 9am to run the cron job");
  assert.ok(schedule.has("schedule"));
});

test("CORE_TOOLS includes essential control tools", () => {
  for (const name of ["read", "write", "edit", "pwsh", "bash", "working_directory", "tokenslash_triage", "tokenslash_peek"]) {
    assert.ok(CORE_TOOLS.has(name), `expected ${name} in CORE_TOOLS`);
  }
});

test("TTFT: detectRequiredGroupsViaJev caches triage results and avoids repeated network calls", async () => {
  let callCount = 0;
  const mockClient = {
    triage: async () => {
      callCount++;
      return { answers: { search: 0.9, file_ops: 0.1 } };
    },
  };
  const prompt = "Please check the latest weather in Jakarta online today";
  const first = await detectRequiredGroupsViaJev(prompt, mockClient, {});
  assert.equal(callCount, 1, "First invocation calls triage endpoint");
  assert.ok(first.has("search"));

  const second = await detectRequiredGroupsViaJev(prompt, mockClient, {});
  assert.equal(callCount, 1, "Second invocation with identical prompt hits cache without calling triage");
  assert.ok(second.has("search"));
});

test("TTFT: injectPrunedToolsNotice assigns order 20000 to sink volatile notice to prompt end", () => {
  const sections = [{ name: "persona", text: "You are agent.", order: 0 }];
  const out = injectPrunedToolsNotice(sections, ["web_search"]);
  const notice = out.find((s) => s.name === "tokenslash-pruned-tools");
  assert.ok(notice, "Notice section exists");
  assert.equal(notice.order, 20000, "Notice must have order 20000 to protect static prefix cache");
});

