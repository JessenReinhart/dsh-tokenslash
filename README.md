# dsh-tokenslash ⚡

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/jessenreinhart/dsh-tokenslash)

> **Cut up to 85% of prompt overhead in DeepSeek Harness.**  
> Automatically prune unused tools, strip bloated system prompts, and route subagents to budget-friendly models — without breaking agent workflows.

---

## Why TokenSlash?

Every time you hit Enter in DeepSeek Harness (DSH), the system prompt includes **every single registered tool schema** and plugin guideline — even ones you never touch (image generators, web crawlers, workflow planners).

In a typical desktop setup, that's **50+ tools and ~18,000 tokens of static overhead on *every single turn***.
Over a 10-turn coding session, you burn **180,000+ tokens** just telling the LLM what tools exist.

**TokenSlash fixes this.** It uses an ultra-fast, lightweight triage model (TypeSafe Jev) to detect what your prompt actually needs, strips the 35–43 tools you don't need, and keeps only what's required.

### Highlights
- 📉 **Up to 85% Prompt Overhead Reduction:** Drops ~18,000 token turn baselines down to ~3,000 tokens.
- 🛡️ **Zero Workflow Breakage:** Core file and command tools (`read`, `write`, `edit`, `pwsh`, `grep`, `glob`) are preserved in Normal mode.
- 🧠 **Context-Aware Continuity:** "continue", "resume", or follow-up prompts automatically inherit your active tool set.
- ⚡ **Sub-Second Triage:** Jev triage takes ~500ms over local proxy, with built-in fail-open safety (if triage fails, nothing is dropped).
- 💰 **Subagent Model Tiering:** Automatically routes lightweight subagent tasks to cheaper models (`gemini-2.5-flash`, `deepseek-chat`).
- 🦴 **`tokenslash_index`:** Structural skeleton tool (imports, classes, functions, line ranges `[start-end]`) across JS/TS, Python, Rust, Go, Java, HTML, Markdown, Lua, YAML, and TOML. Supports symbol filtering via `filter: "auth*"` or `/regex/` — 70–90% smaller than full `read`.
- 📦 **`tokenslash_batch`:** Run up to 15 tool calls in a single turn. Supports concurrent `parallel` (default) or ordered `series` mode for dependent operations.
- 👁️ **PTC Mode Aware `tokenslash_peek`:** Detects DSH Programmatic Tool Calling (`ptc`) mode and returns concise signatures instead of verbose JSON schemas.
- 📊 **Native TokenMeter Integration:** Attaches to native DSH 0.2.x `ctx.tokenMeter` for BPE-precise token savings telemetry.
- ✂️ **Tighter Output Compaction:** Default tool-output compaction limit lowered from 10,000 → 4,000 chars (configurable via `outputCompactLimit`).
- 🧹 **Deterministic Output Distillation:** Strips ANSI color escapes, `\r` progress-bar overwrites, npm/yarn/pnpm noise, and collapses repetitive test/warning lines *before* they hit the model — pure regex, zero LLM calls, sub-millisecond.
- 🗂️ **Observation Masking:** Turns old tool outputs (>2 turns ago, >800 chars) into compact stubs so settled context stops draining tokens every turn, while preserving `tool_call_id` + role structure.
- 🧠 **Jev-Guarded Selective Masking:** Before masking older tool output, TokenSlash asks Jev whether it's still actively referenced by the current task. Outputs scored relevant (`noul >= 0.6`) are kept, killing re-read thrashing in long coding sessions — and all candidates are evaluated in a **single batch request**.
- 🎯 **Zero-Rescan `glob`/`grep` Ranking:** Overlong path or match lists are scored by keyword relevance and collapsed to a top-N summary (`topK = 10` for `glob`, `topK = 25` for `grep`) instead of dumping hundreds of raw lines.
- 🔍 **`tokenslash_diagnose`:** Classifies test failures as flaky vs assertion vs compilation vs environment and appends a retry hint to failing `pwsh`/`bash` output; it's a core tool that survives pruning.
- 📚 **Speculative Read Injection:** If your prompt references `lib/foo.js`, TokenSlash hints the companion `lib/foo.test.js` so the agent reads both in one batched turn instead of rescanning later.
- 🔁 **Canonical Prefix-Cache Alignment:** Sorts surviving tool schemas and prompt sections deterministically every turn, keeping the provider's prompt prefix byte-identical for maximum cache hits and lower latency.
- 📏 **Scalable Triage State:** `triageBatch` auto-grows its contextual state budget with question count (`max(800, questions × 350)`, capped at 4000) so mid-batch candidates aren't elided before reaching Jev.

---

## Real Benchmark Results

Tested on live DSH Desktop v2.0.10 with 50 registered tools and 9 system prompt sections extracted directly from an active runtime session. Triage executed against live `openrouter/typesafe/jev-1.13` via 9Router.

### 4-Turn Coding & Audit Session

| Turn | Prompt | Baseline (Without TokenSlash) | With TokenSlash (Normal) | With TokenSlash (Extreme) | Tokens Saved | Reduction |
|---|---|---|---|---|---|---|
| **1** | *"Audit lib/ directory for issues..."* | 18,036 tokens | 3,813 tokens | 3,055 tokens | **14,223** | **78.9%** |
| **2** | *"Read lib/index.js & jev-client.js"* | 18,036 tokens | 3,813 tokens | 2,633 tokens | **15,402** | **85.4%** |
| **3** | *"continue"* *(inherited tool mask)* | 18,036 tokens | 3,813 tokens | 2,633 tokens | **15,402** | **85.4%** |
| **4** | *"Summarize audit findings"* | 18,036 tokens | 3,402 tokens | 2,420 tokens | **15,616** | **86.6%** |
| **Total** | **4 turns cumulative** | **72,144 tokens** | **14,841 tokens** | **10,741 tokens** | **61,403** | **85.1%** |

*Note on measurement: Tool schemas (50,602 chars) and system prompt sections (21,540 chars) were captured verbatim from live session data. Triage calls were executed against live Jev. Token counts are computed using the standard character ratio (`chars / 4`).*

---

## How Pruning Modes Work

Choose the mode that fits your style in the settings:

- **`normal` (Recommended):** Keeps core developer tools (`read`, `write`, `edit`, `glob`, `grep`, `pwsh`, `tokenslash_triage`, `todo_write`, `present`) active at all times, stripping only irrelevant specialized tools (image generation, custom workflows, scraper modules) and prompt sections. Safe, transparent, and cuts ~79% of tokens.
- **`extreme`:** Only keeps the exact tools detected for the immediate prompt (e.g., just `read` and `edit` during code inspection). Cuts ~85% of tokens.
- **`off`:** Disables schema and prompt pruning entirely (runs 100% vanilla DSH).

---

## Installation

### Method 1: Automated Installer (Recommended)

Clone and run the installer script. It adds the dependency to your profile, pulls hoisted dependencies (like `gpt-tokenizer`), and registers the bundle in `dsh.profile.bundles`:

```bash
git clone https://github.com/JessenReinhart/dsh-tokenslash.git ~/.dsh/profiles/desktop/packages/dsh-tokenslash
node ~/.dsh/profiles/desktop/packages/dsh-tokenslash/scripts/install.mjs
```

Options:
```bash
node scripts/install.mjs --profile desktop        # target desktop (default)
node scripts/install.mjs --profile web            # target another profile
node scripts/install.mjs --dry-run                # preview changes without writing
```

### Method 2: From npm (once published)

```bash
# via the installer:
node scripts/install.mjs --from npm

# or via DSH CLI (web/acp/headless profiles):
dsh plugin --profile web add dsh-tokenslash
```

After installing, reload DSH Desktop (`Ctrl + R` / `F5`) or restart the app. TokenSlash will appear under **Settings → TokenSlash**.

---

## Quick Start & Configuration

TokenSlash works out of the box with safe defaults. Customize settings under **Settings → TokenSlash** or via API:

| Option | Default | What it does |
|---|---|---|
| `enabled` | `true` | Turn TokenSlash on or off globally |
| `toolPruningMode` | `"normal"` | Pruning aggressiveness (`"normal"`, `"extreme"`, or `"off"`) |
| `provider` | `"opencode"` | Triage provider (`opencode`, `9router`, `openrouter`, `typesafe`, `localjev`, `custom`) |
| `customBaseUrl` | `http://127.0.0.1:20128/v1/systemone` | Endpoint for 9Router or custom proxy |
| `pinnedTools` | `[]` | List of tool names you never want pruned (e.g. `["pwsh", "read"]`) |
| `failOpen` | `true` | If triage endpoint goes down, keep all tools safe instead of failing |

---

## Key Features Under the Hood

### 1. Smart System Prompt & Tool Pruning
Hooks into DSH's `system-prompt/assemble` lifecycle. Analyzes the incoming prompt, strips unused tool JSON schemas and non-essential documentation sections, and caches the result for the turn.

When tools are pruned, TokenSlash automatically injects a Pruning Notice (`tokenslash-pruned-tools`) into the system prompt listing the pruned tools. This lets the LLM know which tools were stripped and reminds it that pruned tools can be inspected or unlocked on demand via `tokenslash_peek`.

### 2. Dynamic Tool Unlocking & Inspection via `tokenslash_peek`
TokenSlash registers `tokenslash_peek` as a core built-in tool that survives all pruning passes. If the agent discovers it needs a pruned tool mid-turn, it can invoke `tokenslash_peek` without breaking workflow:
- **`action: "inspect"`**: Retrieve full schemas and descriptions of specified tools.
- **`action: "unlock"`**: Mark specified tools as unlocked for the agent's turn so they bypass pruning on subsequent assembly passes.

### 3. Multi-Turn Mask Inheritance
When you say "continue", "resume", or give a brief instruction, TokenSlash detects the continuation and retains the tool mask from the prior turn so your agent never loses its active tools midway through a task.

### 4. Subagent Model Tiering
Routes subagent delegations based on task complexity. Sends simple file lookups to fast/cheap tiers (`deepseek-chat`, `gemini-2.5-flash`) while saving smart models (`deepseek-reasoner`, `claude-3-7-sonnet`) for deep architectural reasoning.

### 5. Tool Output Pruning & Compaction
When tools return massive payloads (>10KB JSON or huge diffs), TokenSlash condenses the result to essentials so history doesn't bloat your context window.

### 6. Version-Aware DSH 0.2.x Compatibility
TokenSlash detects native DSH services at plugin initialization and gracefully yields redundant hooks on modern hosts while keeping full fallback coverage on older DSH builds:

| Hook | Native DSH 0.2.x Service | Behavior on 0.2.x | Behavior on 0.1.5 |
|---|---|---|---|
| Context Compaction | `dsh-compaction-basic` | **Yields** (avoids tool-call pairing violations) | Active |
| Tool Result Pruner | `dsh-compaction-tool-result-pruner` | **Yields** (no double-truncation) | Active |
| Goal Guard | `dsh-tool-goal` / `dsh-goal-round-driver` | **Yields** (host enforces round caps) | Active |
| Subagent Routing | `dsh-tool-subagent` model selection | **Yields** (host handles provider/model) | Active |

Detection is purely capability-based (`detectNativeServices(ctx)`). No version string parsing.

---

## LocalJev Provider Setup

TokenSlash supports `localjev` ([githubnext/localjev](https://github.com/githubnext/localjev)) as first-class local-only triage provider.

### What is LocalJev?
LocalJev is lightweight local server implementation of Jev triage protocol designed for low-latency, zero-cost on-device execution.

### How to Run
Install and start LocalJev with Bun, backed by local runtime like oMLX or upstream OpenAI-compatible model:

```bash
bun add -g localjev
localjev --upstream http://127.0.0.1:8000/v1 --port 8080
```

LocalJev default triage endpoint: `http://127.0.0.1:8080/v1/systemone` with model `diffusiongemma-26B-A4B-it-4bit`.

### Key Benefits
- **0 network latency:** Triage decisions resolve locally on loopback.
- **0 external data egress:** Prompts and tool schemas stay on device.
- **0 cost:** Local inference burns $0 USD API budget.
- **SOC2 compliant:** Fits strict enterprise data boundaries.

---

## API & Tool Surface

### Cordis Tools Registered
- **`tokenslash_triage`**: Run structured micro-decisions (`noul` probability or `choice` classification) against the Jev endpoint. See [`docs/TRIAGE.md`](docs/TRIAGE.md).
- **`tokenslash_peek`**: Dynamic inspection and unlocking tool for pruned tools.
  - Parameters:
    - `action`: `"inspect" | "unlock"` (required)
    - `tools`: `string[]` (list of tool names, required)
- **`tokenslash_index`**: Structural skeleton inspection (signatures, headers, classes, exports, line ranges) ~70-90% smaller than full file reading.
- **`tokenslash_batch`**: Dispatch up to 15 independent tool calls concurrently (`parallel`) or sequentially (`series`) in a single turn.
- **`tokenslash_diagnose`**: Classify shell command failures (flaky vs assertion vs compilation vs environment), evaluate test failure stack traces, and suggest speculative companion reads. Protected as a core tool.

### REST Endpoints
TokenSlash exposes local endpoints for stats and external triage:

- `GET /api/dsh-tokenslash/stats` — View total tokens saved, USD saved, and prune counts.
- `GET /api/dsh-tokenslash/history` — Inspect recent prune events and decisions.
- `POST /api/dsh-tokenslash/config` — Update configuration dynamically.
- `POST /api/dsh-tokenslash/triage` — Run arbitrary triage questions against the Jev engine.

Live telemetry sample:
```json
{
  "totalTokensSaved": 246669,
  "estimatedCostSavedUsd": "0.54",
  "toolsPrunedCount": 26,
  "promptsPrunedCount": 26,
  "observationMaskCount": 4,
  "outputDistillCount": 12,
  "cacheAlignmentEvents": 34,
  "avgTokensSavedPerTurn": 9487,
  "topPrunedTools": { "web_search": 14, "office": 12, "skill": 9 },
  "byModule": {
    "toolPrune": { "events": 26, "tokens": 118000 },
    "promptPrune": { "events": 26, "tokens": 74000 },
    "outputCompact": { "events": 5, "tokens": 18563 },
    "observationMask": { "events": 4, "tokens": 2800 },
    "outputDistill": { "events": 12, "tokens": 1400 },
    "subagentDecouple": { "events": 7, "tokens": 32906 },
    "cacheAlignment": { "events": 34, "tokens": 0 }
  },
  "lastPruneEvent": {
    "toolsCount": 38,
    "sectionsCount": 8,
    "tokensSaved": 14223,
    "mode": "normal"
  }
}
```
The `/stats` endpoint returns a `byModule` breakdown (events + tokens saved per feature), `topPrunedTools` (most-pruned tools), `avgTokensSavedPerTurn`, and per-feature counters so you can see exactly which optimization is saving the most.

---

## Testing

```bash
npm test
```

All 331 unit tests run via `node --test` without external dependencies or live network access.

## License

MIT © [Jessen Reinhart](https://github.com/JessenReinhart)
