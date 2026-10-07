// test/shared/capabilities.test.js
// Contract tests for lib/shared/capabilities.js and the bridge save persistence
// gate. Stubs mirror the VERIFIED host surfaces:
//  - old  @deepseek-ai/dsh-settings@0.1.5-rc.2: installSection(owner, ns, schema,
//    entry, hooks) with unconditional hooks.setSource/onChange, replace/update,
//    write(ns, input, mode, expectedRevision).
//  - RC   @deepseek-ai/dsh-settings@0.2.0-rc.2 (SettingsForms): configure(
//    presentation, owner = calling fiber) -> idempotent disposer, throws on
//    double-register per fiber; describe/update/replace/mutate;
//    write(ns, change, expected, paths); schema(entry) reads
//    entry.fiber.runtime.Config. No installSection anywhere in the RC service.
//  - both hosts announce "settings/document-updated" (ns, revision) with no
//    cordis context filtering.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SETTINGS_UPDATED_EVENT,
  PERSISTENCE_UNAVAILABLE,
  hasFunction,
  getService,
  registerTool,
  bindSettingsSection,
  onEvent,
  canPersist,
  persistSettings,
  capabilitySnapshot,
} from "../../lib/shared/capabilities.js";
import { registerBridgeRoutes } from "../../lib/routes/bridge.js";
import { BRIDGE_PREFIX } from "../../lib/shared/constants.js";

const NS = "tokenslash";

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function makeCtx({ services = {}, fiber, hasGet = true, onThrows = false, withInject = true } = {}) {
  const listeners = new Map();
  const cleanups = [];
  const warnings = [];
  const errors = [];
  const ctx = {
    fiber: fiber === undefined ? { state: 2, config: {} } : fiber,
    logger: {
      warn: (m) => warnings.push(String(m)),
      error: (m) => errors.push(String(m)),
      info: () => {},
    },
    on(name, fn) {
      if (onThrows) throw new Error("CordisError('INACTIVE_EFFECT')");
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(fn);
      return () => set.delete(fn);
    },
    effect(fn) {
      const cleanup = fn();
      if (typeof cleanup === "function") cleanups.push(cleanup);
      return () => {};
    },
  };
  if (withInject) {
    ctx.inject = (names, cb) => {
      ctx.__inject = { names, cb };
    };
  }
  if (hasGet) {
    ctx.get = (name) => services[name];
  } else {
    for (const [key, value] of Object.entries(services)) ctx[key] = value;
  }
  ctx.__emit = (name, ...args) => {
    for (const fn of [...(listeners.get(name) ?? [])]) fn(...args);
  };
  ctx.__listenerCount = (name) => listeners.get(name)?.size ?? 0;
  ctx.__cleanups = cleanups;
  ctx.__warnings = warnings;
  ctx.__errors = errors;
  return ctx;
}

/** Mirrors old dsh-settings SettingsProvider behaviour at :334-350. */
function makeOldSettings(initialResolved) {
  let resolved = initialResolved;
  const calls = [];
  const svc = {
    calls,
    installed: null,
    installSection(owner, ns, schema, entry, hooks) {
      calls.push({ method: "installSection", owner, ns, schema, entry, hooks });
      svc.installed = { owner, ns, schema, entry, hooks };
      hooks.setSource(() => resolved); // :339
      hooks.onChange(); // :345
    },
    async replace(ns, section, expectedRevision) {
      calls.push({ method: "replace", ns, section, expectedRevision });
      return { ns, revision: 1 };
    },
    async update(ns, patch, expectedRevision) {
      calls.push({ method: "update", ns, patch, expectedRevision });
    },
    describe() {
      calls.push({ method: "describe" });
      return [];
    },
    get() {
      return resolved;
    },
    write() {
      calls.push({ method: "write" });
      throw new Error("write(ns, input, mode, expectedRevision) must never be called by the plugin");
    },
    // test drivers mirroring scope.watch -> onChange (:346-349) and detach (:340-344)
    simulateCommit(next) {
      resolved = next;
      svc.installed.hooks.onChange();
    },
    simulateDetach() {
      const entry = svc.installed.entry;
      svc.installed.hooks.setSource(() => entry);
      svc.installed.hooks.onChange();
    },
  };
  return svc;
}

/** Mirrors RC SettingsForms surface exactly (shape and error semantics). */
function makeRcSettings() {
  const presentations = new Map();
  const calls = [];
  return {
    calls,
    presentations,
    configure(presentation, owner) {
      const fiber = owner === undefined ? "host-default-fiber" : owner;
      if (presentations.has(fiber)) {
        throw new Error("Settings presentation is already configured for this plugin instance");
      }
      const policy = { ...presentation };
      presentations.set(fiber, policy);
      calls.push({ method: "configure", presentation, fiber });
      return () => {
        if (presentations.get(fiber) !== policy) return; // idempotent, RC :376-380
        presentations.delete(fiber);
        calls.push({ method: "configure-dispose", fiber });
      };
    },
    describe(options) {
      calls.push({ method: "describe", options });
      return [];
    },
    async update(ns, patch, expectedRevision) {
      calls.push({ method: "update", ns, patch, expectedRevision });
    },
    async replace(ns, section, expectedRevision) {
      calls.push({ method: "replace", ns, section, expectedRevision });
    },
    async mutate(ns, ops, expectedRevision) {
      calls.push({ method: "mutate", ns, ops, expectedRevision });
    },
    async write(ns, change, expected, paths) {
      calls.push({ method: "write", ns, change, expected, paths });
    },
    schema(entry) {
      const schema = entry?.fiber?.runtime?.Config;
      return schema !== undefined && "toJSON" in schema ? schema : undefined;
    },
  };
}

function makeHooks() {
  const state = { sources: [], changes: 0, source: null };
  return {
    state,
    options: {
      setSource: (s) => {
        state.sources.push(s);
        state.source = s;
      },
      onChange: () => {
        state.changes += 1;
      },
    },
  };
}

// ---------------------------------------------------------------------------
// getService / hasFunction / registerTool / onEvent
// ---------------------------------------------------------------------------

test("getService prefers ctx.get and never throws", () => {
  const settings = { installSection() {} };
  assert.equal(getService(makeCtx({ services: { settings } }), "settings"), settings);
  // ctx.get present but throwing -> undefined
  assert.equal(getService({ get: () => { throw new Error("boom"); } }, "settings"), undefined);
  // no ctx.get, property read throws like cordis `without inject` -> undefined
  const throwing = {};
  Object.defineProperty(throwing, "settings", {
    get() {
      throw new Error('cannot get property "settings" without inject');
    },
  });
  assert.equal(getService(throwing, "settings"), undefined);
  // no ctx.get, plain property -> returned
  assert.equal(getService({ settings }, "settings"), settings);
  assert.equal(getService(undefined, "settings"), undefined);
  assert.equal(getService(null, "tools"), undefined);
});

test("hasFunction probes shapes safely", () => {
  assert.equal(hasFunction({ f: () => {} }, "f"), true);
  assert.equal(hasFunction({ f: 1 }, "f"), false);
  assert.equal(hasFunction(undefined, "f"), false);
});

test("registerTool registers through probed tools service", () => {
  const registered = [];
  const tools = { register: (t) => registered.push(t) };
  const tool = { name: "t" };
  assert.equal(registerTool(makeCtx({ services: { tools } }), tool), true);
  assert.deepEqual(registered, [tool]);
  assert.equal(registerTool(makeCtx({ services: {} }), tool), false);
  assert.equal(registerTool({}, tool), false);
});

test("onEvent returns disposer, null without ctx.on, null + warn when on throws", () => {
  const ctx = makeCtx();
  const dispose = onEvent(ctx, "x", () => {});
  assert.equal(typeof dispose, "function");
  assert.equal(ctx.__listenerCount("x"), 1);
  dispose();
  assert.equal(ctx.__listenerCount("x"), 0);

  assert.equal(onEvent({}, "x", () => {}), null);

  const throwingCtx = makeCtx({ onThrows: true });
  assert.equal(onEvent(throwingCtx, "x", () => {}), null);
  assert.ok(throwingCtx.__warnings.some((w) => w.includes("event x unavailable")));
});

// ---------------------------------------------------------------------------
// bindSettingsSection — old installSection path
// ---------------------------------------------------------------------------

test("old host: installSection gets (owner ctx, ns, schema, entry, hooks) and wires source + change", () => {
  const resolvedV1 = { provider: "opencode", model: "m1" };
  const settings = makeOldSettings(resolvedV1);
  const ctx = makeCtx({ services: { settings } });
  const schema = { toJSON: () => ({}) };
  const initial = { provider: "opencode" };
  const hooks = makeHooks();

  assert.equal(bindSettingsSection(ctx, NS, schema, initial, hooks.options), true);

  const call = settings.calls.find((c) => c.method === "installSection");
  assert.ok(call, "installSection must be used on the old host");
  assert.equal(call.owner, ctx, "owner must be the plugin ctx (unload check reads owner.fiber.state)");
  assert.equal(call.ns, NS);
  assert.equal(call.schema, schema);
  assert.equal(call.entry, initial, "entry is the composition base/fallback layer");
  assert.equal(typeof call.hooks.setSource, "function");
  assert.equal(typeof call.hooks.onChange, "function");

  // immediate wiring, mirroring :339/:345
  assert.equal(hooks.state.sources.length, 1);
  assert.equal(typeof hooks.state.source, "function");
  assert.equal(hooks.state.source(), resolvedV1);
  assert.equal(hooks.state.changes, 1);

  // committed change propagates through the host watcher (:346-349)
  const resolvedV2 = { provider: "opencode", model: "m2" };
  settings.simulateCommit(resolvedV2);
  assert.equal(hooks.state.changes, 2);
  assert.equal(hooks.state.source(), resolvedV2);

  // provider detach resets the source to the entry (:340-344)
  settings.simulateDetach();
  assert.equal(hooks.state.sources.length, 2);
  assert.equal(hooks.state.source(), initial);
  assert.equal(hooks.state.changes, 3);

  assert.ok(!settings.calls.some((c) => c.method === "write"), "write must never be called");
});

test("old host: partial/omitted options still yield callable hooks (host calls them unconditionally)", () => {
  const settings = makeOldSettings({});
  const ctx = makeCtx({ services: { settings } });
  // no options at all — the old host would TypeError on hooks.setSource without normalization
  assert.equal(bindSettingsSection(ctx, NS, {}, {}), true);
  const call = settings.calls.find((c) => c.method === "installSection");
  assert.equal(typeof call.hooks.setSource, "function");
  assert.equal(typeof call.hooks.onChange, "function");

  // partial options keep the caller's functions
  const settings2 = makeOldSettings({});
  const ctx2 = makeCtx({ services: { settings: settings2 } });
  const hooks = makeHooks();
  bindSettingsSection(ctx2, NS, {}, {}, { onChange: hooks.options.onChange });
  const call2 = settings2.calls.find((c) => c.method === "installSection");
  assert.equal(call2.hooks.onChange, hooks.options.onChange);
  assert.equal(typeof call2.hooks.setSource, "function");
});

test("old host: installSection failure propagates (no silent success)", () => {
  const settings = {
    installSection() {
      throw new Error('settings namespace "tokenslash" is already registered');
    },
  };
  const ctx = makeCtx({ services: { settings } });
  assert.throws(
    () => bindSettingsSection(ctx, NS, {}, {}, { setSource() {}, onChange() {} }),
    /already registered/
  );
});

// ---------------------------------------------------------------------------
// bindSettingsSection — RC configure path
// ---------------------------------------------------------------------------

test("RC host: configure registers { auto: true } keyed by the plugin fiber, source reads fiber.config", () => {
  const settings = makeRcSettings();
  const fiber = { state: 2, config: { provider: "opencode", model: "m1" } };
  const ctx = makeCtx({ services: { settings }, fiber });
  const initial = { provider: "opencode" };
  const hooks = makeHooks();

  assert.equal(bindSettingsSection(ctx, NS, { toJSON: () => ({}) }, initial, hooks.options), true);

  const conf = settings.calls.find((c) => c.method === "configure");
  assert.ok(conf, "RC path must register presentation through configure()");
  assert.deepEqual(conf.presentation, { auto: true });
  assert.equal(conf.fiber, fiber, "policy must be keyed by this plugin instance's fiber (describe() looks up presentations.get(entry.fiber))");
  assert.equal(settings.presentations.get(fiber).auto, true);

  // persisted-settings loading: immediate setSource + onChange like the old host
  assert.equal(hooks.state.sources.length, 1);
  assert.deepEqual(hooks.state.source(), fiber.config);
  assert.equal(hooks.state.changes, 1);

  // propagation listener registered under the verified event name
  assert.equal(ctx.__listenerCount(SETTINGS_UPDATED_EVENT), 1);
});

test("RC host: settings/document-updated propagates only for the own namespace", () => {
  const settings = makeRcSettings();
  const fiber = { state: 2, config: { model: "m1" } };
  const ctx = makeCtx({ services: { settings }, fiber });
  const hooks = makeHooks();
  bindSettingsSection(ctx, NS, {}, { model: "base" }, hooks.options);
  assert.equal(hooks.state.changes, 1);

  ctx.__emit(SETTINGS_UPDATED_EVENT, "other-plugin", 3);
  assert.equal(hooks.state.changes, 1, "foreign namespaces must not trigger onChange");

  fiber.config = { model: "m2" }; // host reload/patch updates the live fiber config
  ctx.__emit(SETTINGS_UPDATED_EVENT, NS, 1);
  assert.equal(hooks.state.changes, 2);
  assert.equal(hooks.state.sources.length, 2, "source must be re-pointed on change");
  assert.equal(hooks.state.source().model, "m2");
});

test("RC host: source falls back to the composition entry when fiber.config is unavailable", () => {
  const settings = makeRcSettings();
  const ctx = makeCtx({ services: { settings }, fiber: { state: 2 } });
  const initial = { provider: "fallback" };
  const hooks = makeHooks();
  bindSettingsSection(ctx, NS, {}, initial, hooks.options);
  assert.equal(hooks.state.source(), initial);
});

test("RC host: disposal runs the configure disposer and removes the listener; disposer is idempotent", () => {
  const settings = makeRcSettings();
  const fiber = { state: 2, config: {} };
  const ctx = makeCtx({ services: { settings }, fiber });
  bindSettingsSection(ctx, NS, {}, {}, makeHooks().options);
  assert.equal(settings.presentations.size, 1);
  assert.equal(ctx.__cleanups.length, 1, "cleanup must be attached through ctx.effect");

  ctx.__cleanups[0]();
  assert.equal(settings.presentations.size, 0, "presentation policy must be unregistered");
  assert.equal(ctx.__listenerCount(SETTINGS_UPDATED_EVENT), 0, "listener must be removed");
  assert.equal(settings.calls.filter((c) => c.method === "configure-dispose").length, 1);

  ctx.__cleanups[0](); // second run must be a silent no-op
  assert.equal(settings.calls.filter((c) => c.method === "configure-dispose").length, 1);
});

test("RC host: double configure on one fiber warns but keeps the functional wiring", () => {
  const settings = makeRcSettings();
  const fiber = { state: 2, config: {} };
  const ctx = makeCtx({ services: { settings }, fiber });
  bindSettingsSection(ctx, NS, {}, {}, makeHooks().options);

  const hooks2 = makeHooks();
  assert.equal(bindSettingsSection(ctx, NS, {}, {}, hooks2.options), true);
  assert.ok(
    ctx.__warnings.some((w) => w.includes("Settings presentation is already configured")),
    "double-register throw must be surfaced as a warning"
  );
  assert.equal(hooks2.state.changes, 1, "setSource/onChange wiring must still happen");
  assert.equal(settings.presentations.size, 1, "first policy stays registered");
});

test("RC host: ctx.on failure degrades to a warning, binding still wires source + change", () => {
  const settings = makeRcSettings();
  const fiber = { state: 2, config: { model: "m" } };
  const ctx = makeCtx({ services: { settings }, fiber, onThrows: true });
  const hooks = makeHooks();
  assert.equal(bindSettingsSection(ctx, NS, {}, {}, hooks.options), true);
  assert.ok(ctx.__warnings.some((w) => w.includes(SETTINGS_UPDATED_EVENT)));
  assert.equal(hooks.state.sources.length, 1);
  assert.equal(hooks.state.changes, 1);
  assert.deepEqual(hooks.state.source(), fiber.config);
});

test("RC host: binding works without ctx.effect (cleanup simply not schedulable)", () => {
  const settings = makeRcSettings();
  const ctx = makeCtx({ services: { settings } });
  delete ctx.effect;
  const hooks = makeHooks();
  assert.equal(bindSettingsSection(ctx, NS, {}, {}, hooks.options), true);
  assert.equal(hooks.state.changes, 1);
  assert.equal(settings.presentations.size, 1);
  // manual disposal still possible through the event disposer path is absent,
  // but configure policy remains registered — real cordis always has effect.
});

// ---------------------------------------------------------------------------
// bindSettingsSection — missing capabilities / deferral
// ---------------------------------------------------------------------------

test("missing settings and missing inject: returns false and defers with undefined", () => {
  const ctx = makeCtx({ services: {}, withInject: false });
  let deferred = "not-called";
  assert.equal(
    bindSettingsSection(ctx, NS, {}, {}, { setSource() {}, onChange() {} }, (s) => { deferred = s; }),
    false
  );
  assert.equal(deferred, undefined);
});

test("settings without installSection/configure: returns false and defers with the service", () => {
  const settings = { describe: () => [] }; // e.g. a future/unknown shape
  const ctx = makeCtx({ services: { settings } });
  let deferred = null;
  assert.equal(
    bindSettingsSection(ctx, NS, {}, {}, { setSource() {}, onChange() {} }, (s) => { deferred = s; }),
    false
  );
  assert.equal(deferred, settings);
});

test("deferred inject path binds later with the OUTER ctx as owner (old helper shape :620-624)", () => {
  const settings = makeOldSettings({ model: "m1" });
  const ctx = makeCtx({ services: {} }); // settings not provided yet
  const hooks = makeHooks();
  assert.equal(bindSettingsSection(ctx, NS, {}, { model: "base" }, hooks.options), true);
  assert.ok(ctx.__inject, "must defer through ctx.inject(['settings'], cb)");
  assert.deepEqual(ctx.__inject.names, ["settings"]);

  const settingsCtx = { get: (name) => (name === "settings" ? settings : undefined), settings };
  ctx.__inject.cb(settingsCtx);

  const call = settings.calls.find((c) => c.method === "installSection");
  assert.ok(call, "deferred callback must complete the binding");
  assert.equal(call.owner, ctx, "owner must remain the outer plugin ctx, not the inject ctx");
  assert.equal(hooks.state.changes, 1);
});

test("deferred inject path also completes the RC configure binding with the outer fiber", () => {
  const settings = makeRcSettings();
  const fiber = { state: 2, config: { model: "m1" } };
  const ctx = makeCtx({ services: {}, fiber });
  const hooks = makeHooks();
  assert.equal(bindSettingsSection(ctx, NS, {}, {}, hooks.options), true);
  const settingsCtx = { get: (name) => (name === "settings" ? settings : undefined) };
  ctx.__inject.cb(settingsCtx);
  const conf = settings.calls.find((c) => c.method === "configure");
  assert.ok(conf);
  assert.equal(conf.fiber, fiber);
  assert.deepEqual(hooks.state.source(), fiber.config);
});

test("deferred inject path defers with the service when it has no known shape", () => {
  const ctx = makeCtx({ services: {} });
  let deferred = "not-called";
  bindSettingsSection(ctx, NS, {}, {}, { setSource() {}, onChange() {} }, (s) => { deferred = s; });
  ctx.__inject.cb({ get: () => ({ describe: () => [] }), settings: { describe: () => [] } });
  assert.equal(typeof deferred, "object");
});

test("inject throwing is caught: returns false, warns, defers", () => {
  const ctx = makeCtx({ services: {} });
  ctx.inject = () => {
    throw new Error("INACTIVE_EFFECT");
  };
  let deferred = "not-called";
  assert.equal(
    bindSettingsSection(ctx, NS, {}, {}, { setSource() {}, onChange() {} }, (s) => { deferred = s; }),
    false
  );
  assert.equal(deferred, undefined);
  assert.ok(ctx.__warnings.some((w) => w.includes("inject deferral failed")));
});

// ---------------------------------------------------------------------------
// persistSettings / canPersist
// ---------------------------------------------------------------------------

test("persistSettings prefers replace (identical arity on both verified hosts)", async () => {
  const settings = makeOldSettings({});
  const value = { model: "m" };
  await persistSettings(settings, NS, value);
  const call = settings.calls.find((c) => c.method === "replace");
  assert.ok(call);
  assert.equal(call.ns, NS);
  assert.equal(call.section, value);
  assert.equal(call.expectedRevision, undefined, "expectedRevision is optional on both hosts");
  assert.ok(!settings.calls.some((c) => c.method === "write"), "write must never be called");
});

test("persistSettings ladder falls back update -> set", async () => {
  const updates = [];
  await persistSettings({ update: async (ns, v) => updates.push([ns, v]) }, NS, { a: 1 });
  assert.deepEqual(updates, [[NS, { a: 1 }]]);

  const sets = [];
  await persistSettings({ set: async (ns, v) => sets.push([ns, v]) }, NS, { a: 2 });
  assert.deepEqual(sets, [[NS, { a: 2 }]]);
});

test("persistSettings never uses configure (RC configure is presentation, not persistence)", () => {
  let configureCalled = 0;
  const settings = { configure: () => { configureCalled += 1; return () => {}; } };
  assert.throws(
    () => persistSettings(settings, NS, { a: 1 }),
    (err) => err.code === PERSISTENCE_UNAVAILABLE && err.message.includes(NS)
  );
  assert.equal(configureCalled, 0);
  assert.equal(canPersist(settings), false);
});

test("persistSettings never uses write (3rd positional arg differs between hosts)", () => {
  let writeCalled = 0;
  const settings = { write: () => { writeCalled += 1; } };
  assert.throws(() => persistSettings(settings, NS, {}), (err) => err.code === PERSISTENCE_UNAVAILABLE);
  assert.equal(writeCalled, 0);
});

test("persistSettings throws SETTINGS_PERSISTENCE_UNAVAILABLE for empty/undefined services", () => {
  for (const settings of [{}, undefined, null, { describe: () => [] }]) {
    assert.throws(
      () => persistSettings(settings, NS, {}),
      (err) => err.code === PERSISTENCE_UNAVAILABLE && /NOT written/.test(err.message),
      `expected throw for ${JSON.stringify(settings)}`
    );
    assert.equal(canPersist(settings), false);
  }
  assert.equal(canPersist({ replace: () => {} }), true);
  assert.equal(canPersist({ update: () => {} }), true);
  assert.equal(canPersist({ set: () => {} }), true);
});

test("persistSettings propagates host write failures (e.g. RC volatile-fields refusal)", async () => {
  const settings = {
    replace: async () => {
      throw new Error(`Plugin entry "${NS}" has no volatile fields`);
    },
  };
  await assert.rejects(
    () => persistSettings(settings, NS, {}),
    /has no volatile fields/
  );
});

test("persistSettings awaits RC-shaped replace with exact positional arguments", async () => {
  const settings = makeRcSettings();
  await persistSettings(settings, NS, { model: "m" });
  const call = settings.calls.find((c) => c.method === "replace");
  assert.ok(call);
  assert.equal(call.ns, NS);
  assert.deepEqual(call.section, { model: "m" });
  assert.equal(call.expectedRevision, undefined);
  assert.ok(!settings.calls.some((c) => c.method === "write"));
  assert.ok(!settings.calls.some((c) => c.method === "configure"));
});

// ---------------------------------------------------------------------------
// capabilitySnapshot
// ---------------------------------------------------------------------------

test("capabilitySnapshot distinguishes old and RC settings shapes and is frozen", () => {
  const oldSnap = capabilitySnapshot(makeCtx({ services: { settings: makeOldSettings({}), tools: { register() {} }, webServer: { register() {} } } }));
  assert.equal(oldSnap.settingsInstallSection, true);
  assert.equal(oldSnap.settingsConfigure, false);
  assert.equal(oldSnap.settingsReplace, true);
  assert.equal(oldSnap.settingsUpdate, true);
  assert.equal(oldSnap.settingsPersistence, true);
  assert.equal(oldSnap.toolsRegister, true);
  assert.equal(oldSnap.webServerRegister, true);
  assert.equal(oldSnap.events, true);
  assert.equal(oldSnap.inject, true);
  assert.equal(oldSnap.probe, true);
  assert.equal(oldSnap.effect, true);
  assert.ok(Object.isFrozen(oldSnap));

  const rcSnap = capabilitySnapshot(makeCtx({ services: { settings: makeRcSettings() } }));
  assert.equal(rcSnap.settingsInstallSection, false);
  assert.equal(rcSnap.settingsConfigure, true);
  assert.equal(rcSnap.settingsDescribe, true);
  assert.equal(rcSnap.settingsSchema, true);
  assert.equal(rcSnap.settingsPersistence, true);
});

test("capabilitySnapshot survives hostile ctx reads (subagents without inject throws on cordis)", () => {
  const hostile = {
    get: (name) => {
      if (name === "settings") throw new Error("service fiber inactive");
      return undefined;
    },
    logger: { warn: () => {} },
  };
  Object.defineProperty(hostile, "subagents", {
    get() {
      throw new Error('cannot get property "subagents" without inject');
    },
  });
  const snap = capabilitySnapshot(hostile);
  assert.equal(snap.subagents, false);
  assert.equal(snap.settingsReplace, false);
  assert.equal(snap.settingsPersistence, false);
});

// ---------------------------------------------------------------------------
// bridge save route: persist BEFORE mutate, reject unavailable persistence
// ---------------------------------------------------------------------------

function makeBridge({ settings, initialConfig }) {
  const routes = [];
  const errors = [];
  const ctx = {
    logger: {
      error: (m) => errors.push(String(m)),
      warn: () => {},
      info: () => {},
    },
    webServer: {
      register: (route) => {
        routes.push(route);
        return () => {};
      },
    },
    get: (name) => (name === "settings" ? settings : undefined),
  };
  const telemetry = { getLastModelPick: () => ({}), getStats: () => ({}), getHistory: () => [] };
  const config = initialConfig ?? { provider: "opencode", model: "old-model" };
  const clients = [];
  registerBridgeRoutes(ctx, config, telemetry, () => ({}), (c) => clients.push(c));
  const save = routes.find((r) => r.path === `${BRIDGE_PREFIX}/save`);
  assert.ok(save, "save route must be registered");
  return { ctx, routes, save, config, clients, errors };
}

function makeReq(body) {
  const payload = Buffer.from(typeof body === "string" ? body : JSON.stringify(body ?? {}));
  return {
    method: "POST",
    url: `${BRIDGE_PREFIX}/save`,
    async *[Symbol.asyncIterator]() {
      yield payload;
    },
  };
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: null,
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(body) {
      this.body = body;
    },
    get json() {
      return JSON.parse(this.body);
    },
  };
}

test("bridge save persists BEFORE mutating in-memory config and swapping the client", async () => {
  const order = [];
  let configRef = null;
  let snapshotAtPersist = null;
  const settings = {
    async replace(ns, value) {
      order.push("persist");
      snapshotAtPersist = { ...configRef };
      assert.equal(ns, NS);
      return { ns, revision: 1 };
    },
  };
  const bridge = makeBridge({ settings, initialConfig: { provider: "opencode", model: "old-model" } });
  configRef = bridge.config;

  const res = makeRes();
  await bridge.save.handler(makeReq({ model: "new-model" }), res);

  assert.deepEqual(order, ["persist"]);
  assert.equal(snapshotAtPersist.model, "old-model", "in-memory config must be untouched while persisting");
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.persisted, true);
  assert.equal(bridge.config.model, "new-model", "config mutates only after the write succeeded");
  assert.equal(bridge.clients.length, 1, "client swapped only after the write succeeded");
});

test("bridge save rejects with 503 when the host exposes no persistence verb (no silent success)", async () => {
  const bridge = makeBridge({ settings: {}, initialConfig: { provider: "opencode", model: "old-model" } });
  const res = makeRes();
  await bridge.save.handler(makeReq({ model: "new-model" }), res);
  assert.equal(res.statusCode, 503);
  assert.match(res.json.error, /persistence unavailable/);
  assert.equal(res.json.details.persisted, false);
  assert.equal(bridge.config.model, "old-model", "config must not mutate when persistence is unavailable");
  assert.equal(bridge.clients.length, 0, "client must not be swapped");
  assert.ok(bridge.errors.some((e) => e.includes("NOT persisted")));
});

test("bridge save surfaces host write failures as 500 without applying config", async () => {
  const settings = {
    replace: async () => {
      throw new Error(`Plugin entry "${NS}" has no volatile fields`);
    },
  };
  const bridge = makeBridge({ settings, initialConfig: { provider: "opencode", model: "old-model" } });
  const res = makeRes();
  await bridge.save.handler(makeReq({ model: "new-model" }), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.json.error, /no volatile fields/);
  assert.equal(res.json.details.persisted, false);
  assert.equal(bridge.config.model, "old-model");
  assert.equal(bridge.clients.length, 0);
});

test("bridge save uses the RC-shaped service through replace and never touches write/configure", async () => {
  const settings = makeRcSettings();
  const bridge = makeBridge({ settings });
  const res = makeRes();
  await bridge.save.handler(makeReq({ model: "m2" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.persisted, true);
  const replace = settings.calls.find((c) => c.method === "replace");
  assert.ok(replace);
  assert.equal(replace.ns, NS);
  assert.equal(replace.section.model, "m2");
  assert.ok(!settings.calls.some((c) => c.method === "write"), "write must never be called");
  assert.ok(!settings.calls.some((c) => c.method === "configure"), "save must not touch presentation configure");
});

test("bridge save falls back to update, then set", async () => {
  const updateCalls = [];
  const b1 = makeBridge({ settings: { update: async (ns, v) => updateCalls.push([ns, v.model]) } });
  const r1 = makeRes();
  await b1.save.handler(makeReq({ model: "u1" }), r1);
  assert.equal(r1.statusCode, 200);
  assert.deepEqual(updateCalls, [[NS, "u1"]]);

  const setCalls = [];
  const b2 = makeBridge({ settings: { set: async (ns, v) => setCalls.push([ns, v.model]) } });
  const r2 = makeRes();
  await b2.save.handler(makeReq({ model: "s1" }), r2);
  assert.equal(r2.statusCode, 200);
  assert.deepEqual(setCalls, [[NS, "s1"]]);
});

test("bridge save validates first: malformed JSON yields 400 without persistence attempts", async () => {
  let replaceCalled = 0;
  const bridge = makeBridge({
    settings: { replace: async () => { replaceCalled += 1; } },
    initialConfig: { provider: "opencode", model: "old-model" },
  });
  const res = makeRes();
  await bridge.save.handler(makeReq("{not-json"), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json.details.persisted, false);
  assert.equal(replaceCalled, 0);
  assert.equal(bridge.config.model, "old-model");
  assert.equal(bridge.clients.length, 0);
});

test("bridge save splits comma-string pinnedTools before validation and persistence", async () => {
  let persistedSection = null;
  const bridge = makeBridge({
    settings: { replace: async (ns, section) => { persistedSection = section; } },
  });
  const res = makeRes();
  await bridge.save.handler(makeReq({ pinnedTools: "a, b ,, c" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(persistedSection.pinnedTools, ["a", "b", "c"]);
});

test("bridge save rejects non-POST with 405", async () => {
  const bridge = makeBridge({ settings: { replace: async () => {} } });
  const res = makeRes();
  await bridge.save.handler({ method: "GET", url: `${BRIDGE_PREFIX}/save` }, res);
  assert.equal(res.statusCode, 405);
});
