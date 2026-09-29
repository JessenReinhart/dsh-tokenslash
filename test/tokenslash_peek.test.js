import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";
import { createPromptPruneHook, injectPrunedToolsNotice } from "../lib/hooks/prompt-prune.js";

describe("tokenslash_peek feature", () => {
  test("injectPrunedToolsNotice adds notice section when pruned tools exist", () => {
    const sections = [{ name: "persona", text: "You are agent." }];
    const res = injectPrunedToolsNotice(sections, ["web_search", "genui_html"]);
    assert.equal(res.length, 2);
    assert.equal(res[1].name, "tokenslash-pruned-tools");
    assert.match(res[1].text, /web_search, genui_html/);
    assert.match(res[1].text, /tokenslash_peek/);
  });

  test("injectPrunedToolsNotice returns original sections when no pruned tools", () => {
    const sections = [{ name: "persona", text: "You are agent." }];
    const res = injectPrunedToolsNotice(sections, []);
    assert.equal(res.length, 1);
    assert.equal(res, sections);
  });

  test("promptPruneHook retains unlocked tools from unlockRegistry", async () => {
    const unlockRegistry = new Map();
    unlockRegistry.set("agent-1", new Set(["web_search"]));

    const hook = createPromptPruneHook(
      { logger: console },
      null, // regex fallback
      () => ({ enabled: true, toolPruningMode: "normal", modules: { promptPruning: true } }),
      null,
      null,
      unlockRegistry
    );

    const assembly = {
      tools: [
        { name: "read" },
        { name: "web_search" },
        { name: "genui_html" },
      ],
      sections: [{ name: "persona", text: "You are an agent." }],
    };

    // Prompt requires only file ops, so search and ui tools would normally be pruned
    const context = {
      agent: { id: "agent-1" },
      messages: [{ role: "user", content: "Please read file index.js" }],
    };

    const res = await hook(assembly, context);
    const toolNames = res.tools.map((t) => t.name);

    assert.ok(toolNames.includes("read"), "read kept (core)");
    assert.ok(toolNames.includes("web_search"), "web_search kept because unlocked");
    assert.ok(!toolNames.includes("genui_html"), "genui_html pruned");

    // Check notice injected
    const noticeSection = res.sections.find((s) => s.name === "tokenslash-pruned-tools");
    assert.ok(noticeSection, "notice section present");
    assert.match(noticeSection.text, /genui_html/);
    assert.ok(!noticeSection.text.includes("web_search"));
  });

  test("tokenslash_peek tool inspect and unlock execution", async () => {
    const registeredTools = new Map();
    const eventHandlers = new Map();

    const mockCtx = {
      tools: {
        register: (toolDef) => {
          registeredTools.set(toolDef.name, toolDef);
        },
        get: (name) => {
          if (name === "web_search") {
            return {
              name: "web_search",
              description: "Search web for information",
              parameters: { query: { type: "string" } },
            };
          }
          return null;
        },
      },
      on: (event, handler) => {
        eventHandlers.set(event, handler);
        return () => eventHandlers.delete(event);
      },
      inject: () => {},
      settings: {
        installSection: () => {},
      },
    };

    const plugin = apply(mockCtx, { enabled: true });
    assert.ok(registeredTools.has("tokenslash_peek"), "tokenslash_peek registered");

    const peekTool = registeredTools.get("tokenslash_peek");

    // 1. inspect action
    const inspectRes = await peekTool.execute(
      { action: "inspect", tools: ["web_search", "unknown_tool"] },
      { agent: { id: "agent-42" } }
    );
    assert.equal(inspectRes.count, 2);
    assert.equal(inspectRes.tools.web_search.description, "Search web for information");
    assert.equal(inspectRes.tools.unknown_tool.notFound, true);

    // 2. unlock action
    const unlockRes = await peekTool.execute(
      { action: "unlock", tools: ["web_search", "genui_html"] },
      { agent: { id: "agent-42" } }
    );
    assert.equal(unlockRes.count, 2);
    assert.ok(plugin.unlockRegistry.get("agent-42").has("web_search"));
    assert.ok(plugin.unlockRegistry.get("agent-42").has("genui_html"));

    // 3. turn boundary resets registry
    const inboxClaimedHandler = eventHandlers.get("agent/inbox/claimed");
    assert.ok(inboxClaimedHandler, "inbox claimed handler registered");

    inboxClaimedHandler({ agent: { id: "agent-42" }, message: { content: "new user prompt" } });
    assert.equal(plugin.unlockRegistry.has("agent-42"), false, "registry deleted for agent on new turn");
  });
});
