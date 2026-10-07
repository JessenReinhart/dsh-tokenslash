# Compatibility

## Target matrix

`dsh-tokenslash` targets the installed DSH lifecycle contracts:

| Component | Older host | Current RC |
|---|---:|---:|
| Cordis | `@deepseek-ai/cordis@4.0.2` | `@deepseek-ai/cordis@4.0.4` |
| DSH runtime | `@deepseek-ai/dsh@0.1.5-rc.2` | `@deepseek-ai/dsh@0.2.0-rc.2` |
| Settings service | `@deepseek-ai/dsh-settings@0.1.5-rc.2` | `@deepseek-ai/dsh-settings@0.2.0-rc.2` |

The lifecycle tests run against Cordis 4.0.4 by default. Set
`TOKENSLASH_TEST_CORDIS` to an installed Cordis 4.0.2 package directory to run
the same suite against the older host.

## Lifecycle contract

Cordis 4 may invoke a constructible `apply` with `new` and discard its returned
object. `lib/index.js` therefore keeps the direct `apply()` return for callers,
but registers one idempotent cleanup effect on the plugin context. This cleans
bridge routes, tool registrations, event listeners, and settings presentation
when the namespace plugin fiber unloads.

The settings adapter detects host capabilities rather than host versions:

- 4.0.2-era settings uses `installSection(ctx, namespace, schema, initial, hooks)`.
- 4.0.4-era RC settings uses `configure(presentation, owner)` for presentation,
  `fiber.config` for the live value, and `settings/document-updated` for changes.
- RC settings disposers are owned by `ctx.effect`; duplicate cleanup is safe.

## Limitations

- Compatibility is verified only against the installed 4.0.2 and 4.0.4 Cordis
  sources and the settings contracts listed above.
- The plugin does not expose its direct service object through the Cordis
  namespace. Direct callers can retain the object returned by `apply()`.
- Other DSH or settings builds may require additional capability detection.
