# TokenSlash Benchmark-Proven Rules

Derived from a 5-run empirical benchmark comparing standard vs TokenSlash workflows on live DSH Desktop across tasks ranging from single-file inspection to multi-file trace and complex isolated development.

```
                    ┌─────────────────────────┐
                    │ File Inspection Task    │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │ Is it a single small    │
                    │ file (< ~200 lines)?    │
                    └──────┬───────────┬──────┘
                           │           │
                     YES   │           │   NO (large file OR
                           ▼           ▼       multi-file trace)
              ┌──────────────────┐   ┌───────────────────────────┐
              │ Plain `read`     │   │ 1. `tokenslash_index` 1st │
              │ (do NOT index)   │   │ 2. targeted `read` only   │
              └──────────────────┘   │    with offset + limit    │
                                     └───────────────────────────┘
```

---

## The Three Rules

### Rule 1 — The 200-Line Size Gate (Index vs Plain Read)
- **Small files (< 200 lines, single file):** Call plain `read`. Do **NOT** call `tokenslash_index`.
  - *Empirical proof:* Run 1 (`lib/config.js`, 127 lines) showed indexing + targeted reads cost **15,400 chars (11 calls, 10 turns)** vs **7,367 chars (6 calls, 3 turns)** for plain read. An index pass on a small file adds overhead without savings.
- **Large files (> 200 lines) OR any multi-file task:** Call `tokenslash_index` FIRST.
  - *Empirical proof:* Run 2 (cross-file trace across 2 files) cut context read from **20,426 chars down to 7,264 chars (−64%)** and tool calls from **22 down to 7 (−68%)**.

### Rule 2 — Batch Independent Probes
- When you need to inspect multiple files or independent ranges in one turn, use `tokenslash_batch`:
  ```json
  {
    "calls": [
      { "tool": "tokenslash_index", "args": { "file_path": "lib/a.js" } },
      { "tool": "tokenslash_index", "args": { "file_path": "lib/b.js" } }
    ]
  }
  ```
- Prevents round-trip serialization and eliminates per-turn system-prompt overhead.

### Rule 3 — Never Re-Read What You Wrote (Verify via Test/Execution)
- After using `write` or `edit`, verify behavior by running tests (`pwsh node --test`), lint, or compiler.
- **Do NOT** call `read` back on the file you just authored. The content is already in your assistant context.
- *Empirical proof:* Run 5 (complex session pruner dev) achieved **0 characters read (−100% vs 5,214 chars normal)** because the agent authored and immediately ran tests rather than re-reading its own work.

---

## Decision Flowchart

| Scenario | Primary Tool | Secondary Tool | What NOT to do |
|---|---|---|---|
| Single small file (<200 lines) | `read` (full) | — | Do NOT call `tokenslash_index` |
| Large file (>200 lines) | `tokenslash_index` | `read` with offset/limit | Do NOT read full file |
| Multi-file trace / audit | `tokenslash_index` on each file (batched) | `read` exact symbol ranges | Do NOT sequentially full-read files |
| Greenfield file creation | `write` | `pwsh node --test` to verify | Do NOT `read` back your own output |
| Multi-file edit | `tokenslash_batch` with edits | test execution | Do NOT do serial edit turns |

---

## Quick Reference

- **`tokenslash_index(file_path)`** — Skeletons only. 70–90% context reduction. Use for orientation, locating lines, function ranges.
- **`tokenslash_batch(calls)`** — Dispatch parallel independent reads, indexes, or command calls.
- **`tokenslash_peek(action: "unlock", tools: [...])`** — Restore tools pruned by normal/extreme mode without restarting session.
- **`tokenslash_triage(questions)`** — Micro-decisions only (`noul` probability or `choice`). Not a chat model.
