# dsh-tokenslash ⚡

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

### Method 1: DSH Plugin Manager (Recommended)

```bash
dsh plugin add github:JessenReinhart/dsh-tokenslash
```

### Method 2: Manual Clone

Clone into your profile packages folder:
```bash
git clone https://github.com/JessenReinhart/dsh-tokenslash.git ~/.dsh/profiles/desktop/packages/dsh-tokenslash
```

Restart DSH Desktop or hit `Ctrl + R` to reload the UI. TokenSlash will appear in your plugin settings.

---

## Quick Start & Configuration

TokenSlash works out of the box with safe defaults. Customize settings under **Settings → TokenSlash** or via API:

| Option | Default | What it does |
|---|---|---|
| `enabled` | `true` | Turn TokenSlash on or off globally |
| `toolPruningMode` | `"normal"` | Pruning aggressiveness (`"normal"`, `"extreme"`, or `"off"`) |
| `provider` | `"opencode"` | Triage provider (`opencode`, `9router`, `openrouter`, `typesafe`, `custom`) |
| `customBaseUrl` | `http://127.0.0.1:20128/v1/systemone` | Endpoint for 9Router or custom proxy |
| `pinnedTools` | `[]` | List of tool names you never want pruned (e.g. `["pwsh", "read"]`) |
| `failOpen` | `true` | If triage endpoint goes down, keep all tools safe instead of failing |

---

## Key Features Under the Hood

### 1. Smart System Prompt & Tool Pruning
Hooks into DSH's `system-prompt/assemble` lifecycle. Analyzes the incoming prompt, strips unused tool JSON schemas and non-essential documentation sections, and caches the result for the turn.

### 2. Multi-Turn Mask Inheritance
When you say "continue", "resume", or give a brief instruction, TokenSlash detects the continuation and retains the tool mask from the prior turn so your agent never loses its active tools midway through a task.

### 3. Subagent Model Tiering
Routes subagent delegations based on task complexity. Sends simple file lookups to fast/cheap tiers (`deepseek-chat`, `gemini-2.5-flash`) while saving smart models (`deepseek-reasoner`, `claude-3-7-sonnet`) for deep architectural reasoning.

### 4. Tool Output Pruning & Compaction
When tools return massive payloads (>10KB JSON or huge diffs), TokenSlash condenses the result to essentials so history doesn't bloat your context window.

---

## API & Telemetry

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
  "lastPruneEvent": {
    "toolsCount": 38,
    "sectionsCount": 8,
    "tokensSaved": 14223,
    "mode": "normal"
  }
}
```

---

## Testing

```bash
npm test
```

All 67 test suites run without external dependencies or live network access.

## License

MIT © [Jessen Reinhart](https://github.com/JessenReinhart)
