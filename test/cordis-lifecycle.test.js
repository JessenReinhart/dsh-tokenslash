import test from "node:test";
import assert from "node:assert/strict";
import { Context, Service } from "@deepseek-ai/cordis";
import * as plugin from "../lib/index.js";

test("plugin contract: exports required Cordis metadata", () => {
  assert.equal(typeof plugin.name, "string", "plugin must export 'name'");
  assert.equal(plugin.name, "tokenslash");
  assert.ok(Array.isArray(plugin.inject), "plugin must export 'inject' array");
  assert.ok(plugin.inject.includes("tools"), "inject must declare 'tools'");
  assert.ok(plugin.inject.includes("webServer"), "inject must declare 'webServer'");
  assert.ok(plugin.inject.includes("settings"), "inject must declare 'settings'");
  assert.equal(typeof plugin.apply, "function", "plugin must export 'apply' function");
  assert.equal(typeof plugin.Config, "function", "plugin must export 'Config' schema");
});

test("plugin lifecycle: loads cleanly in Cordis context with mock services", async () => {
  const ctx = new Context();

  // Mock Cordis services as subclasses of Service
  class ToolsSvc extends Service {
    constructor(c) {
      super(c, "tools", true);
      this.registered = [];
    }
    register(def) {
      this.registered.push(def);
      return () => {};
    }
  }

  class WebServerSvc extends Service {
    constructor(c) {
      super(c, "webServer", true);
      this.routes = [];
    }
    register(route) {
      this.routes.push(route);
      return () => {};
    }
  }

  class SettingsSvc extends Service {
    constructor(c) {
      super(c, "settings", true);
      this.sections = [];
    }
    installSection(owner, ns, schema, entry, hooks) {
      assert.ok(owner, "owner must be passed");
      assert.equal(typeof ns, "string", "ns must be string");
      assert.equal(typeof schema, "function", "schema must be Schemastery function");
      assert.ok(entry, "entry base config must be passed");
      assert.equal(typeof hooks.setSource, "function", "hooks.setSource must be function");
      assert.equal(typeof hooks.onChange, "function", "hooks.onChange must be function");
      this.sections.push({ ns, schema, entry });
    }
    get() {
      return {};
    }
  }

  const tools = new ToolsSvc(ctx);
  const webServer = new WebServerSvc(ctx);
  const settings = new SettingsSvc(ctx);

  // Apply plugin and await runtime settlement
  const fork = ctx.plugin(plugin, {});
  await fork.runtime;

  // Verify registrations
  assert.ok(tools.registered.length > 0, "Tool tokenslash_triage must be registered");
  assert.equal(tools.registered[0].name, "tokenslash_triage");

  assert.ok(webServer.routes.length >= 7, "All 7 bridge endpoints must be registered");
  const paths = webServer.routes.map((r) => r.path);
  assert.ok(paths.some((p) => p.includes("/stats")), "/stats route registered");
  assert.ok(paths.some((p) => p.includes("/test")), "/test route registered");
  assert.ok(paths.some((p) => p.includes("/triage")), "/triage route registered");

  assert.equal(settings.sections.length, 1, "Settings section installed");
  assert.equal(settings.sections[0].ns, "tokenslash");
});

test("plugin lifecycle: wires agent/inbox/claimed and system-prompt/assemble in Cordis", async () => {
  const ctx = new Context();

  class ToolsSvc extends Service {
    constructor(c) {
      super(c, "tools", true);
    }
    register() {
      return () => {};
    }
  }

  class WebServerSvc extends Service {
    constructor(c) {
      super(c, "webServer", true);
    }
    register() {
      return () => {};
    }
  }

  class SettingsSvc extends Service {
    constructor(c) {
      super(c, "settings", true);
    }
    installSection() {}
    get() {
      return {};
    }
  }

  new ToolsSvc(ctx);
  new WebServerSvc(ctx);
  new SettingsSvc(ctx);

  const applied = plugin.apply(ctx, {
    enabled: true,
    toolPruningMode: "normal",
    modules: { promptPruning: true },
  });

  const mockAgent = { id: "test-lifecycle-agent" };

  // 1. Emit agent/inbox/claimed
  ctx.emit("agent/inbox/claimed", {
    agent: mockAgent,
    message: {
      content: [{ type: "text", text: "Please search web for cordis plugins" }],
    },
    turn: 1,
  });

  assert.equal(applied.claimedPrompts.get(mockAgent.id), "Please search web for cordis plugins");

  // 2. Dispatch system-prompt/assemble waterfall
  const assembly = {
    tools: [
      { name: "read" },
      { name: "web_search" },
      { name: "generate_image" },
    ],
    sections: [
      { name: "persona", text: "Persona" },
      { name: "free-search", text: "Free search details" },
      { name: "image", text: "Image generation guidelines" },
    ],
    variables: {},
  };

  const context = { agent: mockAgent };
  const result = await ctx.waterfall("system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));

  const toolNames = result.tools.map((t) => t.name);
  assert.ok(toolNames.includes("read"), "Core tool read preserved");
  assert.ok(toolNames.includes("web_search"), "web_search preserved for search prompt");
  assert.ok(!toolNames.includes("generate_image"), "generate_image pruned");

  const sectionNames = result.sections.map((s) => s.name);
  assert.ok(sectionNames.includes("persona"));
  assert.ok(sectionNames.includes("free-search"));
  assert.ok(!sectionNames.includes("image"), "Image section pruned");

  // 3. Telemetry updated
  assert.equal(applied.telemetry.toolsPrunedCount, 1);
  assert.equal(applied.telemetry.promptsPrunedCount, 1);

  // 4. Dispose cleans up cleanly
  applied.dispose();
});
