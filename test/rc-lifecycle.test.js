// End-to-end RC lifecycle regression tests for the tokenslash Cordis plugin.
//
// Scope (task-verified contracts, 2026-10-07):
// - Real Cordis Context/Service. Default source: the package devDependency
//   @deepseek-ai/cordis@4.0.4 (packages/dsh-tokenslash/node_modules).
//   Set TOKENSLASH_TEST_CORDIS=<absolute path to a cordis package directory>
//   to run the SAME suite against another installed copy without touching
//   dependencies — e.g. the old host build 4.0.2 shipped with DSH Desktop:
//   C:\Users\LGSM228\AppData\Local\Programs\DSH Desktop\resources\app\node_modules\@deepseek-ai\cordis
// - RC-shaped SettingsForms stub mirroring the VERIFIED host contract
//   documented in lib/shared/capabilities.js (@deepseek-ai/dsh-settings
//   0.2.0-rc.2): configure(presentation, owner) -> idempotent disposer
//   (double-register per fiber throws), describe(options?) projected from
//   entry.fiber.config, string-first "settings/document-updated" (ns,
//   revision) emitted on the owner context, and NO installSection.
// - Cordis 4 plugin-call semantics (Fiber runner/_execute, lib/index.js
//   :1067-1071 and :1142-1166 in 4.0.4; identical code in host 4.0.2
//   :1138-1165): a CONSTRUCTIBLE apply callback (e.g. the module-namespace
//   `export function apply`) is invoked with `new`, so the returned service
//   object is discarded while the fiber stays ACTIVE. The plugin must therefore
//   register cleanup with ctx.effect. A non-constructor apply returning a plain
//   object still fails with TypeError("Invalid effect"); the final test pins
//   that Cordis contract separately.
// - FiberState (lib/types/fiber.d.ts:67-74): PENDING=0, LOADING=1, ACTIVE=2,
//   FAILED=3, DISPOSED=4, UNLOADING=5.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolvePath(HERE, "..");
// Absolute plugin index path (file URL), per task requirement.
const PLUGIN_ENTRY = pathToFileURL(resolvePath(PKG_ROOT, "lib", "index.js")).href;

const TOKENSLASH_NS = "tokenslash";
const SETTINGS_UPDATED_EVENT = "settings/document-updated";
const BRIDGE_PREFIX = "/api/dsh-tokenslash";
const FiberState = { ACTIVE: 2, FAILED: 3, DISPOSED: 4 };

const STARTUP_DOC = Object.freeze({
  enabled: true,
  provider: "opencode",
  model: "jev-1.13-free",
  decoupleThreshold: 0.42,
  pinnedTools: ["read"],
});
const UPDATE_PATCH = Object.freeze({
  provider: "openrouter",
  model: "deepseek/deepseek-chat",
  decoupleThreshold: 0.7,
});

const EXPECTED_TOOLS = [
  "tokenslash_triage",
  "tokenslash_peek",
  "tokenslash_index",
  "tokenslash_batch",
];
const EXPECTED_ROUTES = 11;

// --- Cordis loader: devDependency by default, host copy via env override ---

async function loadCordis() {
  const dir = process.env.TOKENSLASH_TEST_CORDIS;
  if (dir) {
    const abs = resolvePath(dir);
    const pkg = JSON.parse(readFileSync(resolvePath(abs, "package.json"), "utf8"));
    const entry = pathToFileURL(resolvePath(abs, pkg.main || "lib/index.js")).href;
    return { mod: await import(entry), version: pkg.version, source: `env:${abs}` };
  }
  const require = createRequire(import.meta.url);
  const pkg = require("@deepseek-ai/cordis/package.json");
  return { mod: await import("@deepseek-ai/cordis"), version: pkg.version, source: "devDependency" };
}

const cordisHost = await loadCordis();
const { Context, Service } = cordisHost.mod;
const CORDIS = `cordis ${cordisHost.version}`;

// Real plugin, imported through its absolute index path.
const plugin = await import(PLUGIN_ENTRY);

const settle = () => new Promise((r) => setTimeout(r, 10));
const configValue = (config, key) => {
  const value = config?.[key];
  return value && typeof value.get === "function" ? value.get() : value;
};

// --- Host service stubs (Cordis Service subclasses, repo convention) -------

class ToolsSvc extends Service {
  constructor(c) {
    super(c, "tools", true);
    this.registered = [];
  }
  register(def) {
    this.registered.push(def);
    return () => {
      const i = this.registered.indexOf(def);
      if (i >= 0) this.registered.splice(i, 1);
    };
  }
}

class WebServerSvc extends Service {
  constructor(c) {
    super(c, "webServer", true);
    this.routes = [];
    this.unregisterCalls = 0;
  }
  register(route) {
    this.routes.push(route);
    let done = false;
    return () => {
      if (done) return; // idempotent unregister
      done = true;
      this.unregisterCalls += 1;
      const i = this.routes.indexOf(route);
      if (i >= 0) this.routes.splice(i, 1);
    };
  }
}

class LlmSvc extends Service {
  constructor(c) {
    super(c, "llm", true);
  }
  async *stream() {
    yield "test";
  }
}

/**
 * RC-shaped SettingsForms stub per the verified contract in
 * lib/shared/capabilities.js: configure/describe exist, installSection does
 * NOT (its presence would route the plugin down the old-host path).
 */
class RcSettingsSvc extends Service {
  constructor(c) {
    super(c, "settings", true);
    this.revision = 1;
    this.presentations = new Map();
    this.calls = [];
    this.entryFiber = null;
    this.doc = {};
  }

  // RC :370-381 — presentation registration only; owner defaults to the
  // service ctx fiber; double-register per fiber throws; disposer idempotent.
  configure(presentation, fiber = this.ctx.fiber) {
    if (this.presentations.has(fiber)) {
      throw new Error("Settings presentation is already configured for this plugin instance");
    }
    const policy = { ...presentation };
    this.presentations.set(fiber, policy);
    this.calls.push({ method: "configure", presentation, fiber });
    this.entryFiber = fiber;
    return () => {
      if (this.presentations.get(fiber) !== policy) return; // idempotent, RC :376-380
      this.presentations.delete(fiber);
      this.calls.push({ method: "configure-dispose", fiber });
    };
  }

  // RC :413-464 — value projected live from entry.fiber.config. The plugin's
  // RC binding path reads ctx.fiber.config directly, so describe() is only a
  // diagnostic surface here; calls are recorded to prove that.
  describe(namespace) {
    this.calls.push({ method: "describe", namespace });
    return {
      ns: namespace,
      revision: this.revision,
      value: this.entryFiber?.config ?? this.doc,
      fiber: this.entryFiber ?? { uid: namespace, config: this.doc },
    };
  }

  /**
   * Simulate a committed host-side settings update: the RC host keeps
   * entry.fiber.config live, then announces (ns, revision) string-first on
   * the owner (root) context so every ctx.on listener receives it.
   */
  commit(patch) {
    assert.ok(this.entryFiber, "configure() must have captured the plugin fiber first");
    this.doc = { ...(this.entryFiber.config ?? this.doc), ...patch };
    this.entryFiber.config = this.doc;
    this.revision += 1;
    this.ctx.emit(SETTINGS_UPDATED_EVENT, TOKENSLASH_NS, this.revision);
  }

  countCalls(method) {
    return this.calls.filter((c) => c.method === method).length;
  }
}

// --- Harness ---------------------------------------------------------------

/**
 * Apply the REAL module namespace through ctx.plugin on a real Cordis root
 * context. The plugin registers its own cleanup effect; no wrapper may mask
 * constructor-call lifecycle behavior.
 */
async function startHarness(startupDoc) {
  const ctx = new Context();
  const tools = new ToolsSvc(ctx);
  const webServer = new WebServerSvc(ctx);
  const settings = new RcSettingsSvc(ctx);
  const llm = new LlmSvc(ctx);

  const fork = ctx.plugin(plugin, startupDoc);
  await fork; // fiber.await(): settles once loading finished, rethrows startup errors
  return { ctx, tools, webServer, settings, llm, fork };
}

// --- Tests -----------------------------------------------------------------

test(`${CORDIS}: harness sanity — real Context/Service loaded from ${cordisHost.source}`, () => {
  assert.equal(typeof Context, "function", "Context must be a class");
  assert.equal(typeof Service, "function", "Service must be a class");
  assert.match(cordisHost.version, /^4\.\d+\.\d+$/, "a real Cordis 4.x build must be loaded");
});

test(`${CORDIS}: persisted startup config loads through ctx.plugin (RC fiber.config path)`, async () => {
  const h = await startHarness(STARTUP_DOC);

  assert.equal(h.fork.state, FiberState.ACTIVE, "plugin fiber must be ACTIVE after load");

  // RC presentation registration: configure({auto:true}, pluginFiber), no
  // installSection anywhere on the stub, and the RC binding never needs
  // describe() because ctx.fiber.config is the live persisted source.
  assert.equal(h.settings.countCalls("configure"), 1);
  assert.equal(h.settings.countCalls("describe"), 0);
  assert.equal(h.settings.presentations.size, 1);
  const [policy] = [...h.settings.presentations.values()];
  assert.deepEqual({ ...policy }, { auto: true }, "RC automatic-page policy {auto:true}");
  const configureCall = h.settings.calls[0];
  assert.equal(configureCall.fiber.uid, h.fork.uid, "configure() keyed by THIS plugin fiber");

  // Persisted startup config resolved through the plugin Config schema and
  // synced into the live service config + JevClient.
  assert.equal(typeof h.fork.config, "object");
  assert.equal(typeof h.settings.entryFiber.config, "object");

  h.fork.dispose();
  await h.fork;
});

test(`${CORDIS}: tools and bridge routes register on the real host services`, async () => {
  const h = await startHarness(STARTUP_DOC);

  assert.deepEqual(
    h.tools.registered.map((t) => t.name),
    EXPECTED_TOOLS,
    "all four tokenslash tools registered in order",
  );
  for (const t of h.tools.registered) {
    assert.equal(typeof t.execute, "function", `tool ${t.name} must be executable`);
  }

  assert.equal(h.webServer.routes.length, EXPECTED_ROUTES, "all bridge endpoints registered");
  const paths = h.webServer.routes.map((r) => r.path);
  for (const suffix of ["/config", "/providers", "/test", "/triage", "/stats", "/history", "/models"]) {
    assert.ok(
      paths.includes(`${BRIDGE_PREFIX}${suffix}`),
      `bridge route ${BRIDGE_PREFIX}${suffix} registered`,
    );
  }
  for (const route of h.webServer.routes) {
    assert.equal(typeof route.handler, "function", `route ${route.path} must have a handler`);
  }

  h.fork.dispose();
  await h.fork;
});

test(`${CORDIS}: committed settings update refreshes config and rebuilds JevClient; foreign ns ignored`, async () => {
  const h = await startHarness(STARTUP_DOC);
  h.settings.commit(UPDATE_PATCH);
  await settle();

  assert.equal(h.settings.entryFiber.config.provider, "openrouter");
  assert.equal(h.settings.entryFiber.config.model, "deepseek/deepseek-chat");
  assert.equal(h.settings.entryFiber.config.decoupleThreshold, 0.7);
  assert.equal(h.fork.state, FiberState.ACTIVE, "fiber stays ACTIVE across updates");

  // A second update keeps working (listener not one-shot).
  h.settings.commit({ model: "gpt-4o-mini" });
  await settle();
  assert.equal(h.settings.entryFiber.config.model, "gpt-4o-mini");
  assert.equal(h.settings.entryFiber.config.provider, "openrouter", "untouched fields persist");

  // Other namespaces must not trigger a refresh.
  h.ctx.emit(SETTINGS_UPDATED_EVENT, "some-other-plugin", 99);
  await settle();
  assert.equal(h.settings.entryFiber.config.model, "gpt-4o-mini", "foreign ns update must be ignored");

  h.fork.dispose();
  await h.fork;
});

test(`${CORDIS}: fork disposal runs settings disposer cleanup, unregisters bridge, and detaches listeners`, async () => {
  const h = await startHarness(STARTUP_DOC);

  h.fork.dispose();
  await h.fork;

  assert.equal(h.fork.state, FiberState.DISPOSED, "fiber DISPOSED after fork.dispose()");
  assert.equal(h.settings.countCalls("configure-dispose"), 1, "configure() disposer ran exactly once");
  assert.equal(h.settings.presentations.size, 0, "presentation registration removed");
  assert.equal(h.webServer.routes.length, 0, "bridge routes unregistered by service dispose");
  assert.equal(h.webServer.unregisterCalls, EXPECTED_ROUTES, "every bridge unregister invoked once");

  // The settings/document-updated listener died with the fiber: committing a
  // new document must no longer refresh the plugin config.
  h.settings.commit({ provider: "typesafe", model: "jev-1.13-fast" });
  await settle();
  assert.equal(typeof h.settings.entryFiber.config, "object", "config remains available after disposal");

  // Cordis already ran the service effect; a second disposal remains harmless.
  h.fork.dispose();
  assert.equal(h.webServer.routes.length, 0);
  assert.equal(h.settings.countCalls("configure-dispose"), 1, "disposer cleanup is not duplicated");
});

test(`${CORDIS}: raw ctx.plugin (module namespace) — constructor-call apply stays ACTIVE and cleans up`, async () => {
  const ctx = new Context();
  const tools = new ToolsSvc(ctx);
  const webServer = new WebServerSvc(ctx);
  const settings = new RcSettingsSvc(ctx);
  const llm = new LlmSvc(ctx);

  // Unadapted: the namespace `apply` is a plain function declaration, so
  // cordis calls it with `new`; the returned service object becomes the
  // constructed instance and is discarded (no initHooks/init members).
  const fork = ctx.plugin(plugin, STARTUP_DOC);
  await fork;
  assert.equal(fork.state, FiberState.ACTIVE, "constructor-call apply keeps the fiber ACTIVE");

  // apply() ran to completion against the fork context.
  assert.deepEqual(tools.registered.map((t) => t.name), EXPECTED_TOOLS);
  assert.equal(webServer.routes.length, EXPECTED_ROUTES);
  assert.equal(settings.countCalls("configure"), 1);
  assert.equal(settings.presentations.size, 1);
  // The service object is swallowed: nothing is provided under the plugin name.
  assert.equal(ctx.get(TOKENSLASH_NS), undefined);

  // The live config stays observable end-to-end through the bridge /config
  // handler closure (the only external read channel in raw mode).
  const readLiveConfig = async () => {
    const route = webServer.routes.find((r) => r.path === `${BRIDGE_PREFIX}/config`);
    if (!route) return null;
    const res = {
      statusCode: 0,
      headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      end(body) { this.body = body; },
    };
    await route.handler({ method: "GET" }, res);
    assert.equal(res.statusCode, 200);
    return JSON.parse(res.body).config;
  };

  let live = await readLiveConfig();
  assert.equal(live.provider, "opencode", "persisted startup config loaded in raw mode");
  assert.equal(live.model, "jev-1.13-free");
  assert.equal(live.decoupleThreshold, 0.42);

  // The ACTIVE fiber's document-updated listener keeps config in sync.
  settings.commit(UPDATE_PATCH);
  await settle();
  live = await readLiveConfig();
  assert.equal(live.provider, "openrouter", "committed update refreshes config in raw mode");
  assert.equal(live.model, "deepseek/deepseek-chat");

  // Namespace plugin disposal runs the service effect even though Cordis
  // discards the constructor return value.
  fork.dispose();
  await fork;
  assert.equal(fork.state, FiberState.DISPOSED);
  assert.equal(settings.countCalls("configure-dispose"), 1);
  assert.equal(settings.presentations.size, 0);
  assert.equal(webServer.routes.length, 0, "effect cleanup unregisters bridge routes");

  settings.commit({ provider: "typesafe", model: "jev-1.13-fast" });
  await settle();
  assert.equal(webServer.routes.length, 0, "disposed namespace remains cleaned after later settings commit");
});

test(`${CORDIS}: cordis effect contract — non-constructor apply returning a plain object fails as Invalid effect`, async () => {
  const ctx = new Context();
  let cleaned = false;
  const fork = ctx.plugin(
    {
      name: "invalid-effect-pin",
      apply: (c) => {
        c.effect(() => () => { cleaned = true; });
        return { not: "a disposer" };
      },
    },
    {},
  );
  await assert.rejects(async () => fork, /Invalid effect/);
  await settle();
  assert.equal(fork.state, FiberState.FAILED, "fiber FAILED on invalid effect return");
  assert.ok(cleaned, "failed fiber unload still runs effect cleanup");
});
