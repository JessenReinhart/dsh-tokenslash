# TypeSafe Jev & `tokenslash_triage` Tool Guide

## 1. What is TypeSafe Jev?

**TypeSafe Jev** is a sub-millisecond, low-cost classification and triage engine (e.g. `jev-1.13-free`, `jev-1.13-fast`, `diffusiongemma-26B-A4B-it-4bit`).

- **Not a chat model:** Jev does not hold open-ended conversations or generate prose.
- **Purpose:** Structured micro-decisions (binary probabilities, discrete choices, tiering, routing, scoring).
- **Endpoint:** POST `/v1/systemone` with payload `{ model, state, questions }`.

---

## 2. Tool Definition: `tokenslash_triage`

The agent can invoke `tokenslash_triage` at runtime to query the configured System One endpoint:

### Parameters

| Name | Type | Required | Description |
|---|---|---|---|
| `reason` | `string` | **Yes** | Why this triage query is executed (logging/audit). |
| `questions` | `object` | **Yes** | Map of question keys to question definitions or prompts. |
| `model` | `string` | No | Override triage model (defaults to configured model). |
| `timeoutMs` | `number` | No | Per-request timeout in milliseconds (default 15,000 ms). |
| `retries` | `number` | No | Retry attempts on network failure (default 2). |

---

## 3. Question Formats & Response Payloads

Jev processes questions structured by key. Two primary question paradigms exist:

### Paradigm A: Boolean / Probability (`noul`)

Use `type: "noul"` for probability estimation, gatekeeping, or binary true/false decisions.

```json
{
  "reason": "Check if subagent fork context should be decoupled",
  "questions": {
    "can_decouple": {
      "type": "noul",
      "instructions": "Is this task self-contained without parent history?"
    },
    "needs_network": {
      "type": "noul",
      "instructions": "Does this query need live internet web fetching?"
    }
  }
}
```

**Response Format:**
```json
{
  "answers": {
    "can_decouple": {
      "noul": 0.92
    },
    "needs_network": {
      "noul": 0.08
    }
  }
}
```
*Note:* Value `noul` is a float between `0.0` and `1.0`. Check against a threshold (e.g. `>= 0.5` or `>= 0.85`).

---

### Paradigm B: Multi-Choice Classification (`choice`)

Use `type: "choice"` with explicit `criteria` to classify tasks into predefined categories.

```json
{
  "reason": "Classify task complexity tier for subagent delegation",
  "questions": {
    "tier": {
      "type": "choice",
      "instructions": "Classify subagent task complexity into one tier",
      "criteria": {
        "cheap": "Simple lookup, trivial file read, or concise summary",
        "medium": "Standard coding, single-file bug fix, or verification",
        "smart": "Complex architecture, deep reasoning, or multi-module refactor",
        "extreme": "System overhaul, security audit, or long-running benchmark"
      }
    }
  }
}
```

**Response Format:**
```json
{
  "answers": {
    "tier": {
      "choice": "smart",
      "score": 0.88,
      "reasoning": "Involves multi-module refactoring and cross-file dependencies"
    }
  }
}
```
*Note:* The result can be read via `res.answers.tier.choice` or `res.tier.choice` (fallback `res.tier`).

---

### Paradigm C: Quick Prompt String (Legacy / Shorthand)

You can pass plain string prompts as questions for quick heuristic checks:

```json
{
  "reason": "Quick heuristic check",
  "questions": {
    "should_index": "Should indexFile be run before full reading of a 2000-line file?"
  }
}
```

---

## 4. When to Use `tokenslash_triage` vs Other Tools

| Scenario | Use `tokenslash_triage`? | Alternative / Proper Approach |
|---|---|---|
| Classifying subagent model tier (cheap/medium/smart) | **Yes** | Best fit for Jev (`type: "choice"`). |
| Deciding whether to decouple history on fork | **Yes** | Best fit for Jev (`type: "noul"` probability). |
| Deciding which tool group is active for a prompt | **Yes** | Run batched `noul` questions across tool groups. |
| Reading, inspecting, or searching code files | **No** | Use `tokenslash_index`, `grep`, `read`. |
| Unlocking pruned tools | **No** | Use `tokenslash_peek(action: "unlock", tools: [...])`. |
| Executing terminal commands or shell operations | **No** | Use `pwsh`. |
| General knowledge / code writing | **No** | Use conversational agent model (DeepSeek/Claude/GPT). |

---

## 5. Typical Agent Workflow Example

```javascript
// Step 1: Agent receives a complex delegation goal
// Step 2: Agent queries triage to pick model tier
const triageResult = await tokenslash_triage({
  reason: "Determine model tier for subagent refactor job",
  questions: {
    tier: {
      type: "choice",
      instructions: "Pick model tier for task: refactor database queries across 12 files",
      criteria: {
        cheap: "Small edits or unit tests",
        medium: "Standard feature or bugfix",
        smart: "Multi-file refactor or architecture"
      }
    }
  }
});

// Step 3: Parse decision -> "smart" -> dispatch subagent with smart model
```

---

## 6. Provider Alternatives: Inception Labs (Mercury Decide)

In addition to TypeSafe Jev (`/v1/systemone`), `dsh-tokenslash` natively supports **Inception Labs Mercury Decide** (`https://docs.inceptionlabs.ai/capabilities/decisions`):

- **Model:** `mercury-decide`
- **Endpoint:** `POST https://api.inceptionlabs.ai/v1/decisions`
- **Authentication:** `Authorization: Bearer $INCEPTION_API_KEY`
- **Cost:** ~$0.02 / 1M input tokens ($0.00002 / 1K tokens), output tokens unbilled
- **Compatibility:** Mercury Decide uses the exact same question/answer schema (`noul`, `choice`, `score`, `criteria`, `state`, `answers`), making it a 100% transparent alternative to Jev.

### Configuring Inception Labs in TokenSlash:

In the TokenSlash Settings UI or via `cordis.config.yml`:

```yaml
tokenslash:
  provider: inception
  apiKey: "your-inception-api-key"
  model: mercury-decide
  customBaseUrl: "https://api.inceptionlabs.ai/v1/decisions"
```

Or switch directly in the GUI using the **Provider** preset dropdown: select `Inception Labs (Mercury Decide)`.

