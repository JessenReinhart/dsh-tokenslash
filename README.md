<div align="center">
  <img width="1672" height="941" alt="image" alt="TokenSlash — less prompt overhead, more room for the work" width="100%" src="https://github.com/user-attachments/assets/98a7d55f-e0db-4661-bfc8-2fdc67ffce02" /><!-- TokenSlash README -->

  [![Listed on dsh-plugin.org](https://dsh-plugin.org/badges/listed.svg)](https://dsh-plugin.org/plugins/jessenreinhart/dsh-tokenslash)
  ![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-43853d?logo=node.js&logoColor=white)
  ![License: MIT](https://img.shields.io/badge/License-MIT-c8f36b?labelColor=202a24&color=c8f36b)
</div>

# TokenSlash

**Keep the context that matters. Drop the overhead that doesn't.**

TokenSlash is a Cordis plugin for **DeepSeek Harness (DSH)** that makes agent context more deliberate. It uses lightweight, structured decisions to select task-relevant tools and prompt sections, keep tool output manageable, and help agents route work without permanently losing access to capabilities.

Your agent should spend its context solving the task, not rereading the descriptions of tools it will never call.

## What it does

| Capability | What you get |
| --- | --- |
| **Task-aware prompt pruning** | Selects relevant tool schemas and prompt sections for the current task. |
| **Output and observation hygiene** | Compacts oversized tool results and can mask older observations to keep context focused. |
| **Subagent routing** | Uses structured decisions to select model tiers and decide when a fork can run with less parent context. |
| **Tool recovery** | Lets an agent inspect a pruned tool's schema or unlock that tool for the current turn. |
| **Workflow guardrails** | Optional goal, turn-completion, and tool-safety hooks. |
| **Visibility** | In-chat savings telemetry, prune statistics, history, and a settings UI. |

TokenSlash is configurable rather than one-size-fits-all. Tool pruning supports **normal**, **extreme**, and **off** modes; tools can be pinned, and individual modules can be enabled or disabled.

## Quick start

Install from GitHub using the DSH plugin manager:

    dsh plugin add github:jessenreinhart/dsh-tokenslash

Then open the DSH settings for **TokenSlash**, choose a triage provider, and configure the model and module switches for your setup.

- **Default preset:** 9Router Proxy
- **Other presets:** OpenCode Zen, TypeSafe Jev, OpenRouter, Inception Labs (Mercury Decide), LocalJev, and a custom endpoint
- **Runtime:** Node.js 20+

The provider is used for narrow, structured decisions. It is not the conversational model that writes code or answers general questions.

## Built-in agent tools

TokenSlash adds focused utilities that help an agent use its existing tools more efficiently.

| Tool | Use it for |
| --- | --- |
| **tokenslash_index** | Get a structural outline of a file: signatures, exports, symbols, and line ranges. Use it to locate the relevant part before requesting a larger read. |
| **tokenslash_batch** | Run independent tool calls in parallel, or run calls sequentially when order matters. |
| **tokenslash_peek** | Inspect the schema of a pruned tool, or unlock it so the agent can use it during the current turn. |
| **tokenslash_diagnose** | Classify errors and test failures, suggest files to inspect, or rank candidate tests by relevance. |
| **tokenslash_triage** | Ask the configured decision engine a narrow probability or multiple-choice question. |

### A note on triage

The triage engine is a **micro-decision engine**, not a chat model. Use it for decisions such as:

- Is this task suitable for a cheaper subagent model?
- Can this fork proceed without the parent's full conversation history?
- Which tool group is relevant to this prompt?
- Is this test failure likely to be flaky?

Do not use it to write code, inspect files, search the web, or answer open-ended questions. Keep those jobs with the main agent and its normal tools.

## How pruning stays reversible

1. **Read the task.** TokenSlash evaluates the current prompt with the configured decision provider.
2. **Keep the useful surface.** Relevant tool groups and prompt sections stay available; irrelevant schemas can be pruned.
3. **Recover on demand.** The agent can call **tokenslash_peek** to inspect or unlock a tool that turns out to be needed.
4. **Fail open.** The default configuration favors preserving normal tool access when triage is unavailable or fails.

That last point matters: pruning should reduce clutter, not strand an agent halfway through a task.

## Configuration

Most users can configure TokenSlash from the DSH settings UI. The main controls include:

| Setting | Purpose |
| --- | --- |
| **Provider / model** | Select a supported decision endpoint and model. |
| **Tool pruning mode** | **normal** for conservative pruning, **extreme** for more aggressive pruning, or **off** to disable tool pruning. |
| **Pinned tools** | Keep named tools available regardless of the pruning decision. |
| **Fail open** | Preserve tool access when the decision provider cannot be used. |
| **Modules** | Toggle routing, fork decoupling, prompt pruning, output compaction, observation masking, prefix-cache alignment, and guardrails. |

See [docs/TRIAGE.md](docs/TRIAGE.md) for provider and decision-format details, and [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) for the tested DSH/Cordis host contracts.

## Benchmarks and measurement

Token savings depend on the task, available tool set, DSH runtime, and decision provider. A pruning pass can add overhead when most tools are still relevant, so **there is no fixed savings percentage promised by this project**.

The repository includes the benchmark harnesses and raw result files so you can inspect the measurements and compare them with your own workload:

- [Single-turn benchmark](benchmark.mjs)
- [Multi-turn benchmark](multi-turn-benchmark.mjs)
- [Latest single-turn result](benchmark-results.json)
- [Latest multi-turn result](benchmark-multiturn-results.json)
- [Benchmark methodology and handoff notes](BENCHMARK_HANDOFF.md)

## Development

Requires Node.js 20 or later.

    npm install
    npm test

The test command runs the project's Node.js test suite.

## Project links

- [Plugin listing](https://dsh-plugin.org/plugins/jessenreinhart/dsh-tokenslash)
- [Compatibility notes](docs/COMPATIBILITY.md)
- [Triage guide](docs/TRIAGE.md)
- [Issue tracker](https://github.com/JessenReinhart/dsh-tokenslash/issues)

## License

MIT © [Jessen Reinhart](https://github.com/JessenReinhart)
