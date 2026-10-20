# Compatibility

## Target matrix

`dsh-tokenslash` targets the installed DSH lifecycle contracts:

| Component | Older host | Current RC |
|---|---:|---:|
| Cordis | `@deepseek-ai/cordis@4.0.2` | `@deepseek-ai/cordis@4.0.5` |
| DSH runtime | `@deepseek-ai/dsh@0.1.5-rc.2` | `@deepseek-ai/dsh@0.2.1-rc.2` |
| Settings service | `@deepseek-ai/dsh-settings@0.1.5-rc.2` | `@deepseek-ai/dsh-settings@0.2.1-rc.2` |

The lifecycle tests run against Cordis 4.0.5 by default. Set
`TOKENSLASH_TEST_CORDIS` to an installed Cordis 4.0.2 package directory to run
the same suite against the older host.

## Native DSH 0.2.x Service Gating

On DSH 0.2.x, `detectNativeServices(ctx)` inspects host services at plugin `apply` and gracefully yields redundant hooks:

- **Context Compaction**: Yields when native `ctx.compaction` (`@deepseek-ai/dsh-compaction-basic`) is active, preserving tool-call/result pairing invariants.
- **Tool Result Pruner**: Yields when `@deepseek-ai/dsh-compaction-tool-result-pruner` (`ctx.toolResultPruner`) is active, avoiding duplicate truncation.
- **Goal Guard**: Yields when `@deepseek-ai/dsh-tool-goal` or `@deepseek-ai/dsh-goal-round-driver` (`ctx.goalRoundDriver`) is present.
- **Subagent Model Selection**: Yields when native `@deepseek-ai/dsh-tool-subagent` handles provider/model overrides natively, avoiding destructive monkey-patching of `ctx.subagents`.

On older DSH (0.1.5-rc.2), all native services evaluate to `false` and the plugin's original fallbacks remain fully active.

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
