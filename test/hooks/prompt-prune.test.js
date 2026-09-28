import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPromptPruneHook,
  detectRequiredGroups,
  extractRecentUserPrompt,
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

test("promptPruneHook extreme mode prunes ALL tools", async () => {
  const telemetry = new TokenslashTelemetry();
  const config = { enabled: true, toolPruningMode: "extreme", modules: { promptPruning: true } };
  const hook = createPromptPruneHook({}, {}, () => config, telemetry);

  const assembly = {
    tools: [{ name: "read" }, { name: "write" }, { name: "web_search" }],
    sections: [
      { name: "persona", text: "Core persona" },
      { name: "free-search", text: "Search engines info" },
    ],
  };

  const res = await hook(assembly, {}, () => Promise.resolve(assembly));
  assert.equal(res.tools.length, 0);
  assert.equal(res.sections.length, 1);
  assert.equal(res.sections[0].name, "persona");
  assert.equal(telemetry.promptsPrunedCount, 1);
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
