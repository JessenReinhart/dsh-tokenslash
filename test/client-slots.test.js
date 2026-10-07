// test/client-slots.test.js
// Contract tests for lib/client/slots.js against the two host slot systems
// verified from installed app sources:
//   - old app (dsh 0.1.5-rc.2): `settings.plugin.item`, keyed slot, consumed by
//     @deepseek-ai/dsh-client-ui-settings-plugins (entries/subscribe).
//   - RC app (dsh-desktop 0.2.0-rc.2): `plugins.row.config`, keyed by
//     `<package name>#<row id>` (rowConfigKey in @deepseek-ai/dsh-client-ui-plugin-manager),
//     description falls back to the entry rendered with `view: 'summary'`.
// SlotRegistry.inject in both apps parks the factory until the slot is declared,
// so injecting a slot the host lacks is a safe no-op (verified in
// @deepseek-ai/dsh-client-ui-renderer SlotRegistry.inject in both installs).
//
// React and SettingsCard.jsx are stubbed via module.registerHooks so the client
// module loads under plain `node --test` (no jsx transform, no react installed).
import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";

const STUB_REACT = "tokenslash-test:react";
const STUB_CARD = "tokenslash-test:settings-card";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "react") {
      return { url: STUB_REACT, format: "module", shortCircuit: true };
    }
    if (specifier.endsWith("/components/SettingsCard.jsx") || specifier === "./components/SettingsCard.jsx") {
      return { url: STUB_CARD, format: "module", shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url === STUB_REACT) {
      return {
        format: "module",
        shortCircuit: true,
        source:
          "export default { createElement: (type, props, ...children) => ({ $$reactElement: true, type, props: props ?? null, children }) };",
      };
    }
    if (url === STUB_CARD) {
      return {
        format: "module",
        shortCircuit: true,
        source: "export default function SettingsCard(props) { return { $$settingsCard: true, props }; }",
      };
    }
    return next(url, context);
  },
});

const { apply, inject } = await import("../lib/client/slots.js");

// Host contract fixtures derived from the package's own metadata, mirroring
// rowConfigKey(bundle, rowId) => `${bundle}#${rowId}` in the RC plugin manager
// and the `id: tokenslash` row the bundle patch declares.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const patchYml = readFileSync(new URL("../cordis.patch.yml", import.meta.url), "utf8");
const rowId = /-?\s*id:\s*([A-Za-z0-9_-]+)/.exec(patchYml)?.[1];
const BUNDLE = pkg.name;
const ROW_KEY = `${BUNDLE}#${rowId}`;

function createHost() {
  const injected = [];
  const registrations = [];
  return {
    injected,
    registrations,
    ctx: {
      slots: {
        inject(name, factory) {
          injected.push({ name, factory });
        },
        register(options, component) {
          registrations.push({ options, component });
          return () => {};
        },
      },
    },
  };
}

function materialize(host) {
  for (const entry of host.injected) entry.factory();
  const byName = new Map(host.registrations.map((r) => [r.options.name, r]));
  return byName;
}

test("package fixtures resolve (bundle name, patch row id)", () => {
  assert.equal(BUNDLE, "dsh-tokenslash");
  assert.equal(rowId, "tokenslash");
  assert.equal(ROW_KEY, "dsh-tokenslash#tokenslash");
});

test("apply is a safe no-op when the host has no slots service", () => {
  assert.equal(apply({}), undefined);
  assert.equal(inject({}), undefined);
});

test("apply injects exactly the two host-verified slots", () => {
  const host = createHost();
  apply(host.ctx);
  assert.deepEqual(
    host.injected.map((i) => i.name),
    ["settings.plugin.item", "plugins.row.config"]
  );
});

test("settings.plugin.item (old app 0.1.5-rc.2): keyed by package name, summary vs page views", () => {
  const host = createHost();
  apply(host.ctx);
  const reg = materialize(host).get("settings.plugin.item");
  assert.ok(reg, "settings.plugin.item registration missing");
  assert.deepEqual(reg.options, { name: "settings.plugin.item", key: BUNDLE });

  const summary = reg.component({ view: "summary" });
  assert.equal(typeof summary, "string");
  assert.match(summary, /TypeSafe Jev/);

  for (const props of [undefined, null, {}, { view: "page" }]) {
    const element = reg.component(props);
    assert.equal(element.$$reactElement, true, `page view for props ${JSON.stringify(props)}`);
    assert.equal(typeof element.type, "function");
    assert.deepEqual(element.props, { page: true });
  }
});

test("plugins.row.config (RC 0.2.0-rc.2): keyed <package>#<row id>, summary fallback vs page", () => {
  const host = createHost();
  apply(host.ctx);
  const reg = materialize(host).get("plugins.row.config");
  assert.ok(reg, "plugins.row.config registration missing");
  assert.deepEqual(reg.options, { name: "plugins.row.config", key: ROW_KEY });
  assert.match(reg.options.key, /^[^#]+#[^#]+$/, "row config key must follow rowConfigKey(bundle, rowId)");

  const summary = reg.component({ view: "summary" });
  assert.equal(typeof summary, "string");
  assert.match(summary, /TypeSafe Jev/);

  const element = reg.component({});
  assert.equal(element.$$reactElement, true);
  assert.deepEqual(element.props, { page: true });
});

test("inject() is an alias of apply()", () => {
  const a = createHost();
  const b = createHost();
  apply(a.ctx);
  inject(b.ctx);
  assert.deepEqual(
    a.injected.map((i) => i.name),
    b.injected.map((i) => i.name)
  );
});
