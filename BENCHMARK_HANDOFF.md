# Benchmark Handoff: dsh-tokenslash End-to-End Token Savings

## Status: COMPLETE

Real benchmark executed 2026-09-29 with live Jev triage calls and real tool schemas extracted from active DSH Desktop session.

---

## What Was Measured

### Benchmark Harness

- **Script:** `benchmark.mjs` (single-turn, all 3 modes)
- **Script:** `multi-turn-benchmark.mjs` (4-turn session, normal + extreme)
- **Tool schemas:** Extracted from real live DSH session (50 tools, 50,602 chars / 12,651 tokens)
- **System prompt:** Extracted from real live DSH session (9 sections, 21,540 chars / 5,385 tokens)
- **Triage endpoint:** Live 9Router proxy (`http://127.0.0.1:20128/v1/systemone`) running `openrouter/typesafe/jev-1.13`
- **Code path:** Same `createPromptPruneHook` and `detectRequiredGroupsViaJev` as live plugin — no mocks

### Scenario

**Task:** "Audit the lib/ directory of this repo for security issues, error handling gaps, dead code, and async safety problems. Report specific issues with file and line references."

**4-turn sequence:**
1. Initial audit task
2. "Proceed to read lib/index.js and lib/jev-client.js to check error handling."
3. "continue" (resume keyword — tests mask inheritance)
4. "Summarize the audit findings in a clear table report."

---

## Results (All Measured)

### Single-Turn (benchmark.mjs — 2026-09-29T01:57:11.896Z)

| Mode                   | Tools kept | Tools pruned | Sections pruned | Total tokens | Tokens saved | Reduction | Hook ms |
|---|---|---|---|---|---|---|---|
| Baseline (pruning off) | 50/50      | 0            | 0/9             | 18,036       | 0            | 0.0%       | 0ms     |
| Normal mode            | 12/50      | 38           | 8/9             | 3,813        | 14,223       | 78.9%      | 1,013ms |
| Extreme mode           | 7/50       | 43           | 7/9             | 3,055        | 14,981       | 83.1%      | 544ms   |

### Multi-Turn — Normal Mode (4 turns)

| Turn | Prompt                            | Tools Kept | Sections Kept | Baseline tokens | With TokenSlash | Saved    | Reduction |
|---|---|---|---|---|---|---|---|
| 1 | Audit lib/ directory...           | 12         | 1             | 18,036          | 3,813           | 14,223   | 78.9%     |
| 2 | Read lib/index.js and jev-client  | 12         | 1             | 18,036          | 3,813           | 14,223   | 78.9%     |
| 3 | "continue" (inherited mask)       | 12         | 1             | 18,036          | 3,813           | 14,223   | 78.9%     |
| 4 | Summarize audit findings          | 12         | 0             | 18,036          | 3,402           | 14,634   | 81.1%     |
| **Total** |                          |            |               | **72,144**      | **14,841**      | **57,303** | **79.4%** |

### Multi-Turn — Extreme Mode (4 turns)

| Turn | Prompt                            | Tools Kept | Sections Kept | Baseline tokens | With TokenSlash | Saved    | Reduction |
|---|---|---|---|---|---|---|---|
| 1 | Audit lib/ directory...           | 7          | 2             | 18,036          | 3,055           | 14,981   | 83.1%     |
| 2 | Read lib/index.js and jev-client  | 5          | 2             | 18,036          | 2,633           | 15,402   | 85.4%     |
| 3 | "continue" (inherited mask)       | 5          | 2             | 18,036          | 2,633           | 15,402   | 85.4%     |
| 4 | Summarize audit findings          | 7          | 2             | 18,036          | 2,420           | 15,616   | 86.6%     |
| **Total** |                          |            |               | **72,144**      | **10,741**      | **61,403** | **85.1%** |

---

## Key Observed Behaviors

- **Normal mode keeps core tools:** `ask_user_question, edit, exit_plan_mode, glob, grep, present, pwsh, read, skill, todo_write, tokenslash_triage, write`
- **Extreme mode strips everything except active task tools:** For audit task keeps only `edit, glob, grep, pwsh, read, tokenslash_triage, write`
- **Resume mask inheritance works correctly:** Turn 3 ("continue") inherited Turn 2's mask unchanged
- **Sections pruned in normal mode:** All non-persona sections pruned (web-search, cordis, workflow, job, image docs)
- **Triage latency on live endpoint:** 540ms – 1,013ms per call (first call slower due to connection warmup)
- **Token estimation formula:** `Math.round(chars / 4)` — consistent with real LLM tokenizer estimates for English text

---

## Live Telemetry Snapshot

From active session (`GET /api/dsh-tokenslash/stats`):
```json
{
  "totalTokensSaved": 246669,
  "estimatedCostSavedUsd": "0.54",
  "toolsPrunedCount": 26,
  "promptsPrunedCount": 26,
  "lastPruneEvent": {
    "at": 1790646474931,
    "toolsCount": 34,
    "sectionsCount": 10,
    "tokensSaved": 9441,
    "mode": "extreme"
  }
}
```

---

## Key Code Constants (Verified from Source)

- Token estimate formula: `chars / 4` (`lib/hooks/prompt-prune.js:487`)
- Tool output compaction limit: `DEFAULT_COMPACT_LIMIT = 10000` chars (`lib/hooks/prune.js`)
- History compaction threshold: `8000` tokens (`lib/hooks/compact.js`)
- Decouple threshold: `0.85` confidence (`lib/hooks/routing.js`)
- Resume keyword list: matches `/\b(continue|resume|pick up|carry on|keep going|as before|same task)\b/i`

---

## Artifacts

| File | Contents |
|---|---|
| `benchmark.mjs` | Single-turn benchmark harness (no fabrication; real Jev calls) |
| `multi-turn-benchmark.mjs` | 4-turn multi-turn benchmark harness |
| `benchmark-results.json` | Raw output from single-turn run |
| `benchmark-multiturn-results.json` | Raw output from multi-turn run |
| `benchmark-tools.json` | 50 real tool schemas extracted from live session |
| `benchmark-system-message.json` | Real system message extracted from live session |
