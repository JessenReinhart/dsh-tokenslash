# dsh-tokenslash ⚡

[![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/jessenreinhart/dsh-tokenslash)

> Cuts prompt overhead by pruning unused tools and prompt sections — measured live, BPE-exact, on the active Mercury Decide runtime.

---

## The problem

Every turn, DSH injects **every registered tool schema** and plugin guideline into the system prompt. A typical desktop setup carries **50+ tools and ~18,000 tokens of static overhead** on every single turn — over a 10-turn session, that's ~180,000 tokens just describing what tools exist.

## The fix

TokenSlash runs a fast, lightweight triage model — **Mercury Decide** (`mercury-decide` via Inception Labs) by default, or TypeSafe Jev / OpenRouter — to detect what the prompt actually needs, strips the tools and sections that aren't required, and keeps only what matters.

**Live results** (active DSH Desktop session, `openai/mercury-decide`, `bpe` tokenizer):

| Metric | Value |
| --- | --- |
| Lifetime tokens saved | **1,109,410** |
| This session saved | **736,226** (360 turns) |
| Average per turn | **3,082 tokens** |
| Best single turn | **4,784 tokens** (24 tools + 12 sections) |
| API cost avoided | **$2.43** |

---

## Install

```bash
node scripts/install.mjs
```

Restart DSH Desktop, or reload the GUI after syncing to `node_modules\dsh-tokenslash`.

## How it works

- **Prune** — removes unused tool schemas and non-essential system-prompt sections each turn, then caches the result for that turn.
- **Compact** — shortens redundant output.
- **Preserve** — core tools (`read`, `write`, `edit`, `pwsh`, `grep`, `glob`) always survive pruning; "continue"/"resume" prompts inherit the prior tool set.
- **Fail-open** — if triage errors or the provider is unreachable, nothing is dropped.

## Built-in tools

| Tool | Purpose |
| --- | --- |
| `tokenslash_index` | Structural skeleton of a file (signatures, exports, line ranges) ~70–90% smaller than a full read. |
| `tokenslash_batch` | Run independent tool calls in parallel (`parallel`) or series (`series`). |
| `tokenslash_peek` | `inspect` a pruned tool's schema, or `unlock` it for the current turn. |
| `tokenslash_diagnose` | Classify command/test failures and propose next steps. |

## Configuration

| Key | Default | Notes |
| --- | --- | --- |
| `provider` | `inception` | Triage provider. |
| `model` | `openai/mercury-decide` | Swappable with TypeSafe Jev / OpenRouter. |
| `mode` | `normal` | `normal` keeps core tools; `extreme` prunes more aggressively. |

Local REST endpoints: `GET /api/dsh-tokenslash/stats` (savings + prune counts), `GET /api/dsh-tokenslash/history`, `POST /api/dsh-tokenslash/config`, `POST /api/dsh-tokenslash/triage`.

## Testing

```bash
npm test
```

All 340 unit tests run via `node --test` with no external dependencies or live network access.

## License

MIT © [Jessen Reinhart](https://github.com/JessenReinhart)
