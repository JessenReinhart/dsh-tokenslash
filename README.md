# dsh-tokenslash

TokenSlash optimization suite for DeepSeek Harness (DSH). Routes subagents to cheaper model tiers, prunes noisy tool output, compacts context, and guards goal budgets via TypeSafe Jev triage decisions.

## Features

- **System prompt & tool schema pruning** — `system-prompt/assemble` waterfall strips unused tool schemas and related verbose prompt sections based on intent, saving 3K-8K input tokens per turn.
- **Subagent routing** — `tokenslash_triage` decisions fork work to cheap/medium/smart tiers, saves tokens per decouple.
- **Tool output pruning** — post-execute hook strips oversized JSON payloads over 10KB to compact summaries.
- **Output compacting** — prompt-assemble hook summarizes history when context exceeds ~8K tokens.
- **Goal guard** — warns at 80% of max goal rounds, emits notice via `ctx.app.notice`/`ctx.notice`.
- **Provider fan-out** — OpenCode Zen, 9Router, OpenRouter, TypeSafe Jev, Custom endpoint with cached model discovery.
- **Telemetry** — tokens saved, USD estimate, per-module counts, rolling history, JSON persistence via `toJSON`/`fromJSON`.
- **Settings UI** — host settings section + web client (`lib/client.js`, ModelPicker/SettingsCard components).

## Installation

Requires Node.js `>=20`, ESM (`"type": "module"`).

### Via DSH Plugin Manager (Recommended)

```bash
dsh plugin add github:JessenReinhart/dsh-tokenslash
```

### Via npm (GitHub)

```bash
npm install github:JessenReinhart/dsh-tokenslash
```

### Manual (Clone)

Clone directly into DSH profile `packages` directory:

```bash
git clone https://github.com/JessenReinhart/dsh-tokenslash.git ~/.dsh/profiles/desktop/packages/dsh-tokenslash
```

Plugin mounts via `cordis.patch.yml` (`id: tokenslash`). Host entry `lib/index.js` exports `apply`/`inject`; browser entry `lib/client.js` re-exports web slots.

## Configuration

| Key | Type | Default | Purpose |
|---|---|---|---|
| `enabled` | boolean | `true` | Master switch |
| `provider` | string | `opencode` | Active Jev provider id |
| `customBaseUrl` | string | `http://127.0.0.1:20128/v1/systemone` | Base URL when `provider=custom` |
| `apiKey` | string | `""` | Bearer token for auth providers |
| `model` | string | `jev-1.13-free` | Default triage model |
| `decoupleThreshold` | number (0-1) | `0.85` | Confidence cutoff for subagent fork |
| `modelTiers.cheap` | string (CSV) | `gemini-2.5-flash, deepseek-chat, gpt-4o-mini` | Cheap tier list |
| `modelTiers.medium` | string (CSV) | `gemini-2.5-pro, claude-3-5-haiku` | Medium tier list |
| `modelTiers.smart` | string (CSV) | `deepseek-reasoner, claude-3-7-sonnet, gpt-4o` | Smart tier list |
| `toolPruningMode` | string | `"normal"` | Pruning mode: `"normal"` (intent-based, keep core tools), `"extreme"` (prune all tools), `"off"` (no tool pruning) |
| `modules.subagentRouting` | boolean | `true` | Enable routing hook + auto-route handler |
| `modules.toolPruning` | boolean | `true` | Enable tool output prune hook |
| `modules.promptPruning` | boolean | `true` | Enable system prompt & tool schema pruning before model request |
| `modules.outputCompacting` | boolean | `true` | Enable compact hook |
| `modules.goalGuard` | boolean | `true` | Enable goal budget warnings |

Helpers:

- `parseConfig(raw)` — schema-validated config with defaults.
- `parseModelTiers(tiers)` — CSV/array → `{ cheap, medium, smart }` arrays.
- `getConfigForProvider(provider, overrides)` — resolves baseUrl/model per provider.
- `getProviderConfig(provider, config)` / `listProviders()` / `fetchModels(provider, opts)` — cached (5 min TTL) model discovery; `clearModelsCache()` busts cache.

## API Endpoints

Base prefix: `/api/dsh-tokenslash`

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/config` | — | Current config JSON |
| POST | `/config` | SaveSchema (provider, customBaseUrl, apiKey, model, decoupleThreshold, modelTiers, modules, enabled) | `{ ok, config }` |
| POST | `/triage` | `{ questions, model? }` | Jev triage JSON |
| POST | `/describe` | `{ task, context?, model? }` | Triage describe result |
| POST | `/test` | `{ provider?, customBaseUrl?, apiKey?, model?, timeoutMs? }` | `{ ok, provider, model }` or error |
| GET | `/models` | — | `{ models, current, provider }` |
| GET | `/stats` | — | Telemetry stats |
| GET | `/history?limit=N` | limit ≤ 500 | `{ history }` |

Host tool: `tokenslash_triage` — input `{ questions: object, model?: string }`, calls `jevClient.triage`.

## Architecture

```
lib/index.js          apply()/inject() — bridge routes, settings section, tool, agent hooks
lib/config.js         ConfigSchema, parseConfig, parseModelTiers, getConfigForProvider
lib/providers.js      getProviderConfig, listProviders, fetchModels (TTL cache)
lib/jev-client.js     JevClient — buildUrl/buildHeaders/request(+retry/timeout), triage, testConnection, getModels
lib/telemetry.js      TokenslashTelemetry — record/getStats/getHistory/reset/toJSON/fromJSON
lib/routes/bridge.js  createBridgeRoutes — config/triage/describe/test/models/stats/history
lib/hooks/routing.js  pre-execute: triage route/prune questions, veto on "no"/"false"
lib/hooks/prune.js    post-execute: compact payloads >10KB via triage
lib/hooks/compact.js  prompt-assemble: summarize when tokens >8K
lib/hooks/goal-guard.js goal hook: notice at ≥80% round budget
lib/client.js         browser entry, re-exports client/slots apply/inject + CSS
lib/types.d.ts        Config, TriageResult/TriageDecision, TelemetryStats/Entry, ProviderConfig, ModelTiers
```

Retry/timeout defaults: `JevClient` 15s timeout, 2 retries; `testConnection` 8s/1 retry; `fetchModels` 10s.

## Development

```bash
node --test test/config.test.js test/providers.test.js test/jev-client.test.js test/telemetry.test.js
node --test test/hooks/
```

`fetch` mocked globally per test; no network calls. Types: import from `./lib/types.d.ts`.

## License

MIT
