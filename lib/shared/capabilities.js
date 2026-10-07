// Runtime capability adapters for DSH/Cordis versions.
// Do not branch on host versions: desktop builds can backport APIs independently.
//
// Verified host contracts (2026-10-07, read from the installed sources):
//
// OLD host — @deepseek-ai/dsh-settings@0.1.5-rc.2
//   (DSH Desktop\resources\app\node_modules\@deepseek-ai\dsh-settings\lib\index.js):
//   - installSection(owner, ns, schema, entry, hooks)                 :334-350
//       hooks = { setSource(fn), onChange(), validate? }. setSource is called
//       immediately with () => scope.get() (resolved value: schema defaults <-
//       entry base <- user layer) and with () => entry on provider detach;
//       onChange fires immediately and on every committed change (:339-349).
//       `owner` is only read for the unload check owner.fiber.state (:341, :612-615).
//   - replace(ns, section, expectedRevision?)                         :424-426
//   - update(ns, patch, expectedRevision?)                            :410-412
//   - describe(options?) -> [{ ns, schema, value, revision, ... }]    :358-388
//   - write(ns, input, mode, expectedRevision)                        :450-479
//       3rd positional arg is the MODE string. Never call write directly:
//       the RC gives the 3rd position a different meaning.
//   - event "settings/document-updated" (ns, revision)                :534-554
//       dispatched with a string-first arg list (no thisArg), so cordis applies
//       no context filter and every ctx.on listener receives (ns, revision).
//   - No configure / schema / set. Exported helper installSettingsSection
//     defers through ctx.inject(["settings"], ...)                    :620-624.
//
// RC host — @deepseek-ai/dsh-settings@0.2.0-rc.2 (class SettingsForms, service
//   name "settings"; DeepSeek Harness\resources\app.asar
//   dsh/node_modules/@deepseek-ai/dsh-settings/lib/index.js):
//   - configure(presentation, owner = this.ctx.fiber)                 :370-381
//       PRESENTATION registration only, never persistence. `presentation` is the
//       automatic-page policy; the only field the service reads is `auto`
//       (describe() :426: presentations.get(entry.fiber)?.auto ?? true).
//       Returns an idempotent disposer the caller must attach to its effects;
//       throws "Settings presentation is already configured for this plugin
//       instance" on double-register per fiber (:372).
//   - describe(options?) -> [{ autoGenerate, ns: entry.options.id, schema,
//       revision, applies, value, base, user, secrets? }]             :413-464
//       `value` projects ONLY schema-meta-volatile fields (volatileForm :122-131),
//       read live from entry.fiber.config. Emits "settings/document-updated"
//       (ns, revision) on the owner (root) context (:435, :461) — again
//       string-first, so every ctx.on listener receives it.
//   - update(ns, patch, expectedRevision?)                            :470-473
//   - replace(ns, section, expectedRevision?)                         :479-482
//   - mutate(ns, ops, expectedRevision?)                              :488-500
//   - write(ns, change, expected, paths = [])                         :501-537
//       3rd positional arg is the EXPECTED REVISION. Throws
//       `No configurable plugin entry "<ns>"` and
//       `Plugin entry "<ns>" has no volatile fields` — persistence through the
//       settings service requires volatile-marked Config fields.
//   - schema(entry) -> entry.fiber?.runtime?.Config when it has toJSON :538-541
//       Host-side READER of the plugin's exported Config; there is no imperative
//       plugin-side schema-registration call in the RC surface — exporting
//       `Config` from the plugin runtime IS the schema registration.
//   - No installSection / register / get(ns) / watch / set.
//
// Cordis 4.0.2 (old) / 4.0.4 (RC) — structurally identical for everything used here:
//   - ctx.get(name, strict?) -> service | undefined, never throws
//       ("Read a service from the store without the inject requirement",
//       old :755-765 / RC :763-765). The sanctioned probe.
//   - Reading ctx.<service> that was not declared through inject THROWS
//       (`cannot get property "<prop>" without inject`).
//   - ctx.on(name, listener) -> disposer; the listener is owned by the calling
//       fiber and auto-removed on unload; throws CordisError('INACTIVE_EFFECT')
//       when the fiber is already disposed (:371-380).
//   - ctx.effect(fn) runs fn now and schedules its returned cleanup on fiber
//       teardown (mixin "fiber" -> ["runtime", "effect"], :742).
//   - ctx.fiber.config is the fiber's live resolved config, refreshed on reload
//       (:1016, :1354); the RC host itself reads entry.fiber.config for live values.
//   - ctx.inject([names], cb) defers cb until the services are provided.

/** Event both settings hosts announce namespace changes with: (ns, revision). */
export const SETTINGS_UPDATED_EVENT = "settings/document-updated";

/** Error code thrown by persistSettings when no verified write API exists. */
export const PERSISTENCE_UNAVAILABLE = "SETTINGS_PERSISTENCE_UNAVAILABLE";

/**
 * RC automatic-page policy passed to settings.configure(). `auto: true` matches
 * the host default (describe(): `presentations.get(entry.fiber)?.auto ?? true`),
 * so registering is behaviour-neutral today; it puts this instance into the
 * presentation map and yields the disposer needed for lifecycle cleanup.
 * `auto` is the only policy field any verified host reads.
 */
const RC_PRESENTATION = Object.freeze({ auto: true });

export function hasFunction(value, key) {
  return typeof value?.[key] === "function";
}

/**
 * Safe service probe: prefer ctx.get (verified never to throw, bypasses the
 * inject requirement), fall back to a guarded property read because cordis
 * throws on non-injected service reads.
 */
export function getService(ctx, name) {
  if (typeof ctx?.get === "function") {
    try {
      return ctx.get(name);
    } catch {
      return undefined;
    }
  }
  try {
    return ctx?.[name];
  } catch {
    return undefined;
  }
}

export function registerTool(ctx, tool) {
  const tools = getService(ctx, "tools");
  if (!hasFunction(tools, "register")) return false;
  const dispose = tools.register(tool);
  if (typeof dispose === "function" && hasFunction(ctx, "effect")) {
    try {
      ctx.effect(() => dispose);
    } catch {
      // Registration may happen during teardown; the host owns that failure.
    }
  }
  return true;
}

/**
 * Bind the plugin's settings section against whichever host shape is present.
 *
 * Old host: settings.installSection(ctx, ns, schema, initial, hooks) — the
 * service itself wires setSource/onChange and their lifecycle.
 * RC host: settings.configure() for the presentation policy + fiber.config as
 * the persisted-value source + "settings/document-updated" for propagation,
 * with cleanup attached through ctx.effect.
 *
 * @returns true when a binding (or a deferred inject binding) was installed.
 */
export function bindSettingsSection(ctx, namespace, schema, initial, options, onDeferred = null) {
  // The old host calls hooks.setSource/hooks.onChange unconditionally
  // (dsh-settings :339, :343, :345), so both must exist even for partial options.
  const hooks = { setSource() {}, onChange() {}, ...(options || {}) };
  const settings = getService(ctx, "settings");
  if (settings) {
    return bindAgainstSettings(ctx, settings, namespace, schema, initial, hooks, onDeferred);
  }
  if (hasFunction(ctx, "inject")) {
    try {
      // Same deferral the old host's exported installSettingsSection helper uses
      // (dsh-settings :620-624): wait for the service, then bind. The OUTER ctx
      // stays the owner so unload checks and configure() fiber keying refer to
      // this plugin instance.
      ctx.inject(["settings"], (settingsCtx) => {
        const service = getService(settingsCtx, "settings");
        bindAgainstSettings(ctx, service, namespace, schema, initial, hooks, onDeferred);
      });
      return true;
    } catch (err) {
      warn(ctx, `settings inject deferral failed: ${err?.message}`);
      onDeferred?.(settings);
      return false;
    }
  }
  onDeferred?.(settings);
  return false;
}

function bindAgainstSettings(ctx, settings, namespace, schema, initial, hooks, onDeferred) {
  if (hasFunction(settings, "installSection")) {
    settings.installSection(ctx, namespace, schema, initial, hooks);
    return true;
  }
  if (hasFunction(settings, "configure")) {
    return bindRcSection(ctx, settings, namespace, initial, hooks);
  }
  onDeferred?.(settings);
  return false;
}

function bindRcSection(ctx, settings, namespace, initial, hooks) {
  const disposers = [];
  // Presentation registration. Schema registration on the RC is the plugin's
  // exported Config runtime member, which the host reads through
  // settings.schema(entry) -> entry.fiber.runtime.Config; there is no
  // plugin-side schema call to make.
  try {
    // Pass the fiber explicitly so the policy is keyed by THIS plugin instance's
    // fiber (describe() looks up presentations.get(entry.fiber)) no matter which
    // context the service was reached through. Passing nothing lets the host
    // default (this.ctx.fiber of the accessor) apply.
    const dispose = ctx?.fiber
      ? settings.configure(RC_PRESENTATION, ctx.fiber)
      : settings.configure(RC_PRESENTATION);
    if (typeof dispose === "function") disposers.push(dispose);
  } catch (err) {
    // configure() throws on double-register per fiber. The policy is
    // presentation-only (`auto` defaults to true), so warn and keep the
    // functional wiring below.
    warn(ctx, `settings.configure failed: ${err?.message}`);
  }
  // Persisted-settings loading: ctx.fiber.config is this entry's live resolved
  // config (the RC host itself reads entry.fiber.config for live values),
  // falling back to the composition entry value.
  const source = () => {
    const cfg = ctx?.fiber?.config;
    return cfg && typeof cfg === "object" ? unwrapConfig(cfg) : initial;
  };
  hooks.setSource(source);
  hooks.onChange();
  // Change propagation: both hosts announce (ns, revision) on
  // "settings/document-updated" with no cordis context filtering, so a plain
  // ctx.on listener receives it. Keep the returned disposer for hosts without
  // Cordis effect ownership; real Cordis also removes the listener with the fiber.
  const off = onEvent(ctx, SETTINGS_UPDATED_EVENT, (ns) => {
    if (ns !== namespace) return;
    hooks.setSource(source);
    hooks.onChange();
  });
  if (typeof off === "function") disposers.push(off);
  // Lifecycle cleanup: configure()'s disposer is caller-owned per the RC
  // docstring ("register it with the calling plugin's effects").
  if (hasFunction(ctx, "effect")) {
    try {
      ctx.effect(() => () => disposeAll(disposers));
    } catch {
      // fiber already disposed — nothing can be scheduled; disposers leak only
      // in the stub-context case, real cordis tears the listener down itself.
    }
  }
  return true;
}

function unwrapConfig(value) {
  if (value && typeof value.get === "function") return unwrapConfig(value.get());
  if (Array.isArray(value)) {
    let changed = false;
    const result = value.map((item) => {
      const unwrapped = unwrapConfig(item);
      changed ||= unwrapped !== item;
      return unwrapped;
    });
    return changed ? result : value;
  }
  if (!value || typeof value !== "object") return value;
  let changed = false;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    const unwrapped = unwrapConfig(item);
    changed ||= unwrapped !== item;
    result[key] = unwrapped;
  }
  return changed ? result : value;
}

function disposeAll(disposers) {
  while (disposers.length > 0) {
    const dispose = disposers.pop();
    try {
      dispose();
    } catch {
      // cleanup must never throw
    }
  }
}

function warn(ctx, message) {
  try {
    ctx?.logger?.warn?.(`[tokenslash] ${message}`);
  } catch {
    // no usable logger
  }
}

export function onEvent(ctx, event, listener) {
  if (!hasFunction(ctx, "on")) return null;
  try {
    return ctx.on(event, listener);
  } catch (err) {
    warn(ctx, `event ${event} unavailable: ${err?.message}`);
    return null;
  }
}

/** Whether any verified persistence verb exists on a settings service. */
export function canPersist(settings) {
  return (
    hasFunction(settings, "replace") ||
    hasFunction(settings, "update") ||
    hasFunction(settings, "set")
  );
}

/**
 * Persist one namespace value through the verified write ladder.
 *
 * replace(ns, section, expectedRevision?) and update(ns, patch,
 * expectedRevision?) have identical positional semantics on both verified hosts
 * (old :424/:410, RC :479/:470) — expectedRevision is optional on both.
 * `set(ns, value)` is kept as a guarded last-rung fallback for unverified
 * legacy hosts; it exists in neither verified build.
 *
 * Deliberately NOT used here:
 * - settings.configure(...) — RC presentation registration, not persistence.
 * - settings.write(...) — 3rd positional arg means `mode` on the old host and
 *   `expectedRevision` on the RC; calling it positionally is unsafe by design.
 *
 * @throws {Error} with code SETTINGS_PERSISTENCE_UNAVAILABLE when the host
 *   exposes no persistence verb — callers must reject, never report success.
 */
export function persistSettings(settings, namespace, value) {
  if (hasFunction(settings, "replace")) return settings.replace(namespace, value);
  if (hasFunction(settings, "update")) return settings.update(namespace, value);
  if (hasFunction(settings, "set")) return settings.set(namespace, value);
  const err = new Error(
    `settings persistence unavailable: host settings service exposes none of replace/update/set; namespace "${namespace}" was NOT written`
  );
  err.code = PERSISTENCE_UNAVAILABLE;
  throw err;
}

export function capabilitySnapshot(ctx) {
  const tools = getService(ctx, "tools");
  const settings = getService(ctx, "settings");
  const webServer = getService(ctx, "webServer");
  return Object.freeze({
    toolsRegister: hasFunction(tools, "register"),
    toolsGet: hasFunction(tools, "get"),
    settingsInstallSection: hasFunction(settings, "installSection"),
    settingsConfigure: hasFunction(settings, "configure"),
    settingsDescribe: hasFunction(settings, "describe"),
    settingsSchema: hasFunction(settings, "schema"),
    settingsReplace: hasFunction(settings, "replace"),
    settingsUpdate: hasFunction(settings, "update"),
    settingsPersistence: canPersist(settings),
    webServerRegister: hasFunction(webServer, "register"),
    events: hasFunction(ctx, "on"),
    inject: hasFunction(ctx, "inject"),
    probe: hasFunction(ctx, "get"),
    effect: hasFunction(ctx, "effect"),
    // Probed through getService: a direct ctx.subagents read THROWS on a real
    // cordis ctx because "subagents" is not in this plugin's inject list.
    subagents: Boolean(getService(ctx, "subagents")),
  });
}
