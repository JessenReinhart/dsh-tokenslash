// lib/hooks/prompt-prune.js
// Intercepts system-prompt/assemble to prune unused tools and prompt sections before LLM input

import { countTokens, countText, isBpeActive } from "../shared/tokenizer.js";

export const TOOL_GROUPS = {
  file_ops: {
    tools: ["read", "write", "edit", "tokenslash_index"],
    pattern: /\b(file|read|write|edit|modify|update|replace|create|refactor|code|script|implement|fix|patch|content|source|save|overwrite|index|outline|skeleton|structure)\b/i,
    sectionKeywords: ["file", "edit", "write", "read"],
  },
  file_search: {
    tools: ["glob", "grep"],
    pattern: /\b(find|search files|locate|glob|grep|pattern|regex|directory|where is|scan)\b/i,
    sectionKeywords: ["glob", "grep"],
  },
  shell: {
    tools: ["pwsh"],
    pattern: /\b(run|exec|command|shell|terminal|powershell|pwsh|cmd|bash|install|npm|git|build|test)\b/i,
    sectionKeywords: ["pwsh", "powershell"],
  },
  batch: {
    tools: ["tokenslash_batch"],
    pattern: /\b(batch|parallel|multiple tools|multi-tool|many files|several calls|concurrent)\b/i,
    sectionKeywords: ["batch", "parallel"],
  },
  interaction: {
    tools: ["ask_user_question", "present", "todo_write"],
    pattern: /\b(ask|question|confirm|choose|todo|task list|present|deliverable|deliver)\b/i,
    sectionKeywords: ["todo", "question", "present"],
  },
  skills: {
    tools: ["skill"],
    pattern: /\b(skill|skills|load instructions)\b/i,
    sectionKeywords: ["skill"],
  },
  search: {
    tools: ["web_search", "advanced_search", "free_search_test", "web_fetch", "platform_search"],
    pattern: /\b(search|bing|google|web|online|internet|url|http|https|fetch|platform|website|browse|news|latest|today|find out)\b/i,
    sectionKeywords: ["web search", "free search", "free-search"],
  },
  image: {
    tools: ["generate_image", "edit_image", "read_image"],
    pattern: /\b(image|picture|photo|draw|illustration|visual|png|jpg|jpeg|webp|avatar|art|sketch|render|svg)\b/i,
    sectionKeywords: ["image", "generate_image", "edit_image"],
  },
  cordis: {
    tools: [
      "cordis_define",
      "cordis_run",
      "cordis_stop",
      "cordis_undefine",
      "cordis_inspect_list",
      "cordis_inspect_query",
      "cordis_inspect_self",
    ],
    pattern: /\b(cordis|cordis plugin|dynamic plugin|inspect provider|packageid|pluginid|inspect_self|inspect_query|inspect_list|cordis_define|cordis_run)\b/i,
    sectionKeywords: ["dynamic cordis plugins", "editing-cordis-compositions"],
  },
  subagent: {
    tools: ["subagent", "subagent_fork", "interrupt_agent", "send_message", "list_agents", "list_subagent_models"],
    pattern: /\b(subagent|sub-agent|delegate|child agent|background agent|parallel task|worker)\b/i,
    sectionKeywords: ["subagent"],
  },
  workflow: {
    tools: ["workflow", "ralph"],
    pattern: /\b(workflow|ralph|fan-out|orchestrat)\b/i,
    sectionKeywords: ["workflow", "ralph"],
  },
  goal: {
    tools: ["create_goal", "update_goal", "get_goal"],
    pattern: /\b(goal|long-running|objective|continuation)\b/i,
    sectionKeywords: ["goal"],
  },
  memory: {
    tools: [
      "hindsight_search_knowledge_pages",
      "hindsight_read_knowledge_page",
      "hindsight_capture_initiative",
      "hindsight_ingest_document",
      "hindsight_list_knowledge_pages",
      "hindsight_reflect",
      "hindsight_diagnose",
      "hindsight_sync_status",
    ],
    pattern: /\b(memory|hindsight|recall|knowledge page|initiative|remember)\b/i,
    sectionKeywords: ["hindsight"],
  },
  ui: {
    tools: ["genui_html"],
    pattern: /\b(ui|gui|interface|widget|inline html|genui|interactive)\b/i,
    sectionKeywords: ["genui"],
  },
  jobs: {
    tools: ["job_output", "job_kill", "job_list"],
    pattern: /\b(job|background job|job_id|running job)\b/i,
    sectionKeywords: ["job"],
  },
};

export const CORE_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "tokenslash_index",
  "tokenslash_batch",
  "glob",
  "grep",
  "pwsh",
  "present",
  "ask_user_question",
  "todo_write",
  "tokenslash_triage",
  "tokenslash_peek",
  "skill",
]);

/**
 * Extracts recent user text from agent session, context, inbox, or messages array
 */
export function extractRecentUserPrompt(context = {}, promptTracker = null) {
  // Direct messages array (e.g. unit tests or explicit caller)
  if (Array.isArray(context)) {
    for (let i = context.length - 1; i >= 0; i--) {
      const msg = context[i];
      if (!msg) continue;
      const role = msg.role || msg.type;
      if (role !== "user" && role !== "human") continue;
      const content = msg.content;
      if (typeof content === "string" && content.trim()) return content;
      if (Array.isArray(content)) {
        const text = content.map((c) => (typeof c === "string" ? c : c?.text || "")).join(" ");
        if (text.trim()) return text;
      }
    }
    return "";
  }

  // Explicit context.messages array
  if (Array.isArray(context?.messages)) {
    const extracted = extractRecentUserPrompt(context.messages, promptTracker);
    if (extracted) return extracted;
  }

  const agent = context?.agent || (context?.id && (context?.session || context?.inbox) ? context : null);
  if (!agent) return "";

  // 1. Check promptTracker cache (populated by agent/inbox/claimed)
  if (promptTracker) {
    const tracked = promptTracker.get?.(agent) || (agent.id ? promptTracker.get?.(agent.id) : null);
    if (typeof tracked === "string" && tracked.trim()) return tracked;
    if (tracked?.prompt && typeof tracked.prompt === "string" && tracked.prompt.trim()) return tracked.prompt;
  }

  // 2. Check agent inbox pending queues
  if (agent.inbox) {
    const nextStep = Array.isArray(agent.inbox.nextStep) ? agent.inbox.nextStep : [];
    const nextTurn = Array.isArray(agent.inbox.nextTurn) ? agent.inbox.nextTurn : [];
    const pending = [...nextStep, ...nextTurn];
    if (pending.length > 0) {
      const text = pending.map((m) => (typeof m?.content === "string" ? m.content : JSON.stringify(m?.content || ""))).join(" ");
      if (text.trim()) return text;
    }
  }

  // 3. Check agent.session surface events (newest first)
  if (agent.session) {
    try {
      const surface = agent.session.surface;
      if (surface?.nodes && typeof agent.session.eventAt === "function") {
        const nodes = [...surface.nodes].reverse();
        for (const seq of nodes) {
          const event = agent.session.eventAt(seq);
          if (event?.type === "user/message") {
            const data = event.data;
            if (typeof data === "string") return data;
            if (typeof data?.message === "string") return data.message;
            if (typeof data?.message?.content === "string") return data.message.content;
            if (Array.isArray(data?.message?.content)) {
              const text = data.message.content.map((c) => (typeof c === "string" ? c : c?.text || "")).join(" ");
              if (text.trim()) return text;
            }
          }
        }
      }
    } catch {}
  }

  return "";
}

/**
 * Regex fallback: evaluates which tool groups are needed for a given user prompt
 */
export function detectRequiredGroups(promptText) {
  if (!promptText || typeof promptText !== "string" || promptText.trim().length === 0) {
    // If prompt is unknown or empty, keep all groups (fail-open)
    return new Set(Object.keys(TOOL_GROUPS));
  }

  const required = new Set();
  for (const [groupKey, def] of Object.entries(TOOL_GROUPS)) {
    if (def.pattern.test(promptText)) {
      required.add(groupKey);
    }
  }
  return required;
}

const RESUME_TRIGGERS = new Set([
  "continue",
  "continuing",
  "next",
  "go",
  "go on",
  "keep going",
  "keep it going",
  "proceed",
  "resume",
  "carry on",
]);

const UNFINISHED_INTENT_PATTERN = /\b(next step|remaining work|still (need|needs|to do)|todo:|not (yet )?done)\b/i;

/**
 * Reports whether a prompt looks like a short resume nudge with no intent of its own
 */
export function isShortResumePrompt(promptText) {
  if (!promptText || typeof promptText !== "string") return false;
  const normalized = promptText.toLowerCase().trim().replace(/[.?!,;:]+$/, "").trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  return RESUME_TRIGGERS.has(normalized);
}

/**
 * Reports whether the most recent assistant message signals unfinished work
 */
export function hasUnfinishedAssistantIntent(context) {
  const messages = context?.messages;
  if (!Array.isArray(messages)) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    const role = msg.role || msg.type;
    if (role !== "assistant") continue;
    const content = msg.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content.map((c) => (typeof c === "string" ? c : c?.text || "")).join(" ");
    }
    return UNFINISHED_INTENT_PATTERN.test(text);
  }
  return false;
}

/**
 * Detects a continuation signal in the current turn
 */
export function detectResumeSignal(userText, context) {
  if (isShortResumePrompt(userText)) return "short_prompt";
  if (hasUnfinishedAssistantIntent(context)) return "unfinished_task";
  return null;
}

/**
 * Jev-powered intent detection: asks Jev which tool groups are needed for the user prompt.
 * Falls back to regex on any error or timeout.
 */
export async function detectRequiredGroupsViaJev(promptText, jevClient, config, logger = null, telemetry = null) {
  if (!promptText || typeof promptText !== "string" || promptText.trim().length === 0) {
    return new Set(Object.keys(TOOL_GROUPS));
  }

  const allGroups = Object.keys(TOOL_GROUPS);
  const fallback = () => detectRequiredGroups(promptText);

  // Resolve client if passed as a getter function
  const client = typeof jevClient === "function" ? jevClient() : jevClient;
  if (!client || typeof client.triage !== "function") return fallback();

  try {
    const questions = {};
    for (const groupKey of allGroups) {
      const g = TOOL_GROUPS[groupKey];
      const tools = g.tools.join(", ");
      questions[groupKey] = {
        type: "noul",
        instructions: `Does this user request require tools in group '${groupKey}' (tools: ${tools})?`,
      };
    }

    const result = await client.triage(questions, {
      state: promptText.slice(0, 800),
      model: config?.model,
      timeoutMs: 4000,
      retries: 0,
    });

    const answers = result?.answers || result;
    if (!answers || typeof answers !== "object" || Object.keys(answers).length === 0) {
      if (config?.failOpen !== false) {
        logger?.warn?.(`[tokenslash] jev triage error (malformed response), failing open (keeping all tool groups)`);
        return new Set(allGroups);
      }
      return fallback();
    }

    const active = new Set();
    for (const groupKey of allGroups) {
      const ans = answers[groupKey];
      const prob = typeof ans === "object" ? ans?.noul : Number(ans);
      if (typeof prob === "number" && prob >= 0.35) {
        active.add(groupKey);
      }
    }

    telemetry?.record?.("jev_prune_triage", 0, { groups: active.size, model: config?.model });
    logger?.debug?.(`[tokenslash] jev triage resolved ${active.size} active groups`);
    return active;
  } catch (err) {
    if (config?.failOpen !== false) {
      logger?.warn?.(`[tokenslash] jev triage error (${err.message}), failing open (keeping all tool groups)`);
      return new Set(allGroups);
    }
    logger?.warn?.(`[tokenslash] jev triage error (${err.message}), falling back to regex`);
    return fallback();
  }
}

/**
 * Injects a notice section listing pruned tools and mentioning tokenslash_peek
 */
export function injectPrunedToolsNotice(sections, prunedToolNames) {
  if (!prunedToolNames || prunedToolNames.length === 0) {
    return sections;
  }
  const toolList = prunedToolNames.join(", ");
  const noticeSection = {
    name: "tokenslash-pruned-tools",
    text: `Notice: The following tools were pruned for this turn to save tokens: ${toolList}. If you need any of these tools, use tokenslash_peek to inspect or unlock them.`,
  };
  return Array.isArray(sections) ? [...sections, noticeSection] : [noticeSection];
}

/**
 * Stable-sort tool array by name for cache-friendly deterministic prompt prefixes.
 * Pruning removes tools, but DSH re-registers them in stable order; sorting also
 * protects against provider-side reordering from the raw assembly.
 */
function stableSortTools(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.slice().sort((a, b) => {
    const nameA = typeof a === "string" ? a : a?.name || "";
    const nameB = typeof b === "string" ? b : b?.name || "";
    return nameA.localeCompare(nameB);
  });
}

/**
 * Creates prompt assemble waterfall hook (system-prompt/assemble)
 */
export function createPromptPruneHook(ctx, jevClient, configGetter, telemetry, promptTracker = null, unlockRegistry = null) {
  // Per-instance cache of the last active tool-group mask, keyed by agent id. Closure-scoped
  // so separate hook instances (and tests) never share pruning state across turns.
  const lastActiveGroups = new Map();

  return async function promptPruneHook(assembly, context = {}, next) {
    const isWaterfall = typeof next === "function";
    const assembled = isWaterfall ? await next() : assembly;
    if (!assembled) return assembled;

    const config = typeof configGetter === "function" ? configGetter() : configGetter;
    const mode = (config?.toolPruningMode || config?.modules?.toolPruningMode || "normal").toLowerCase();
    const rawModel = (typeof config?.model === "string" && config.model.trim()) || config?.modelTiers?.medium || config?.modelTiers?.smart || config?.modelTiers?.cheap;
    const activeModel = typeof rawModel === "string" ? rawModel.split(",")[0].trim() || undefined : undefined;

    // Mode 'off' disables tool pruning completely
    if (!config?.enabled || mode === "off" || config?.modules?.promptPruning === false) {
      return assembled;
    }

    // User-pinned tools always survive pruning, even in extreme mode. The section guard below
    // needs the full pinned set (core + user) to detect groups pinned "beyond CORE_TOOLS".
    const rawPinned = Array.isArray(config?.pinnedTools)
      ? config.pinnedTools
      : typeof config?.pinnedTools === "string"
      ? config.pinnedTools.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    const userPinnedTools = new Set();
    for (const t of rawPinned) {
      const name = typeof t === "string" ? t.trim() : "";
      if (name) userPinnedTools.add(name);
    }
    const pinnedTools = new Set([...CORE_TOOLS, ...userPinnedTools]);

    try {
      const userText = extractRecentUserPrompt(context, promptTracker);
      // If we cannot determine recent prompt, do not aggressively prune
      if (!userText || userText.trim().length === 0) {
        return assembled;
      }

      const agentKey = context?.agent?.id || null;
      const resumeSignal = detectResumeSignal(userText, context);
      const rawPrev = agentKey ? lastActiveGroups.get(agentKey) : null;
      const previousGroups = rawPrev && rawPrev.size > 0 ? rawPrev : null;
      const detectedGroups = await detectRequiredGroupsViaJev(userText, jevClient, config, ctx?.logger, telemetry);

      // SAFETY NET: a resume signal with no usable history and no detected signal must
      // not strip the model bare. Bail out without pruning.
      if (!previousGroups && resumeSignal && detectedGroups.size === 0) return assembled;

      // A resume signal carries no intent of its own, so carry the previous turn's mask forward.
      // Also inherit whenever triage returned nothing — that is the exact "Pruned 42 tools" failure.
      const inheritMask = Boolean(previousGroups) && (resumeSignal || detectedGroups.size === 0);
      const activeGroups = inheritMask ? new Set([...previousGroups, ...detectedGroups]) : detectedGroups;

      if (inheritMask) {
        ctx?.logger?.debug?.(
          `[tokenslash] prompt-prune inherited mask (${resumeSignal || "empty_triage"}): ${activeGroups.size} groups`
        );
      }

      // Cache this turn's active mask for the next resume-follow-up
      if (agentKey) {
        lastActiveGroups.delete(agentKey);
        lastActiveGroups.set(agentKey, new Set(activeGroups));
        while (lastActiveGroups.size > 100) {
          const oldestKey = lastActiveGroups.keys().next().value;
          lastActiveGroups.delete(oldestKey);
        }
      }

      // Determine which tools and sections to prune
      const toolsToPrune = new Set();
      const sectionsToPruneKeywords = [];

      for (const [groupKey, def] of Object.entries(TOOL_GROUPS)) {
        if (!activeGroups.has(groupKey)) {
          for (const t of def.tools) toolsToPrune.add(t);
          // A user-pinned tool must keep its documentation section intact.
          if (!def.tools.some((t) => userPinnedTools.has(t))) {
            sectionsToPruneKeywords.push(...def.sectionKeywords);
          }
        }
      }

      const unlockedTools = (agentKey && unlockRegistry?.get(agentKey)) || null;

      let prunedToolsTokens = 0;
      let prunedToolsCount = 0;
      const prunedToolNames = [];
      const filteredTools = Array.isArray(assembled?.tools)
        ? assembled.tools.filter((t) => {
            const toolName = typeof t === "string" ? t : t?.name;
            // Always keep tokenslash_triage, tokenslash_peek, and user-pinned tools (which survive extreme mode)
            if (toolName === "tokenslash_triage" || toolName === "tokenslash_peek") return true;
            if (userPinnedTools.has(toolName)) return true;
            if (unlockedTools?.has(toolName)) return true;

            if (mode === "extreme") {
              // In extreme mode, ONLY keep tools belonging to explicitly detected active groups
              if (toolsToPrune.has(toolName)) {
                prunedToolsCount++;
                prunedToolsTokens += countTokens(t, activeModel);
                if (toolName) prunedToolNames.push(toolName);
                return false;
              }
              // If tool is not in any defined group and not explicitly required, prune it in extreme mode
              const isInAnyGroup = Object.values(TOOL_GROUPS).some((g) => g.tools.includes(toolName));
              if (!isInAnyGroup) {
                prunedToolsCount++;
                prunedToolsTokens += countTokens(t, activeModel);
                if (toolName) prunedToolNames.push(toolName);
                return false;
              }
              return true;
            }

            // Normal mode: always keep CORE_TOOLS
            if (CORE_TOOLS.has(toolName)) return true;
            if (toolsToPrune.has(toolName)) {
              prunedToolsCount++;
              prunedToolsTokens += countTokens(t, activeModel);
              if (toolName) prunedToolNames.push(toolName);
              return false;
            }
            return true;
          })
        : assembled?.tools;

      let prunedSectionsTokens = 0;
      let prunedSectionsCount = 0;
      const filteredSections = Array.isArray(assembled?.sections)
        ? assembled.sections.filter((s) => {
            const sectionName = (s?.name || "").toLowerCase();
            const sectionText = typeof s?.text === "string" ? s.text : "";

            if (mode === "extreme") {
              // Keep persona & instructions, drop any section related to inactive groups
              if (sectionName === "persona" || sectionName === "instructions") return true;
              const normName = sectionName.replace(/[-_]/g, " ");
              const normText = sectionText.toLowerCase().replace(/[-_]/g, " ");
              const isPruned = sectionsToPruneKeywords.some((kw) => {
                const normKw = kw.toLowerCase().replace(/[-_]/g, " ");
                return normName.includes(normKw) || normText.includes(normKw);
              });
              if (isPruned) {
                prunedSectionsCount++;
                prunedSectionsTokens += countText(sectionText, activeModel);
                return false;
              }
              return true;
            }

            // Normal mode
            const normName = sectionName.replace(/[-_]/g, " ");
            const normText = sectionText.toLowerCase().replace(/[-_]/g, " ");
            const isPruned = sectionsToPruneKeywords.some((kw) => {
              const normKw = kw.toLowerCase().replace(/[-_]/g, " ");
              return normName.includes(normKw) || normText.includes(normKw);
            });
            if (isPruned) {
              prunedSectionsCount++;
              prunedSectionsTokens += countText(sectionText, activeModel);
              return false;
            }
            return true;
          })
        : assembled?.sections;

      const tokensSaved = prunedToolsTokens + prunedSectionsTokens;
      const tokenizerMode = isBpeActive() ? "bpe" : "fallback";

      if (telemetry) {
        // Record tool pruning and section pruning separately for accurate UI metrics
        if (prunedToolsCount > 0) {
          telemetry.recordToolPrune(prunedToolsTokens, {
            mode,
            prunedToolsCount,
            model: activeModel,
            tokenizerMode,
          });
        }
        if (prunedSectionsCount > 0) {
          telemetry.recordPromptPrune(prunedSectionsTokens, {
            mode,
            prunedSectionsCount,
            model: activeModel,
            tokenizerMode,
          });
        }
        // Store last prune event for UI indicator
        if (prunedToolsCount > 0 || prunedSectionsCount > 0) {
          telemetry.setLastPruneEvent({
            at: Date.now(),
            toolsCount: prunedToolsCount,
            sectionsCount: prunedSectionsCount,
            tokensSaved,
            mode,
            model: activeModel,
            tokenizerMode,
          });
        }
      }

      const finalSections = prunedToolNames.length > 0
        ? injectPrunedToolsNotice(filteredSections, prunedToolNames)
        : filteredSections;

      return {
        ...assembled,
        tools: stableSortTools(filteredTools),
        sections: finalSections,
      };
    } catch (err) {
      ctx?.logger?.warn?.(`[tokenslash] prompt-prune error: ${err.message}`);
      return assembled;
    }
  };
}

export default createPromptPruneHook;
