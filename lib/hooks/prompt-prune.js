// lib/hooks/prompt-prune.js
// Intercepts system-prompt/assemble to prune unused tools and prompt sections before LLM input

export const TOOL_GROUPS = {
  file_ops: {
    tools: ["read", "write", "edit"],
    pattern: /\b(file|read|write|edit|modify|update|replace|create|refactor|code|script|implement|fix|patch|content|source|save|overwrite)\b/i,
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
  "glob",
  "grep",
  "pwsh",
  "present",
  "ask_user_question",
  "todo_write",
  "tokenslash_triage",
  "skill",
]);

/**
 * Extracts recent user text from agent session or context
 */
export function extractRecentUserPrompt(context = {}) {
  const agent = context.agent;
  if (!agent) return "";

  // 1. Try reading recent inbox messages
  if (agent.inbox?.hasPending) {
    const pending = agent.inbox.nextStep || [];
    const text = pending.map((m) => (typeof m?.content === "string" ? m.content : JSON.stringify(m?.content || ""))).join(" ");
    if (text.trim()) return text;
  }

  // 2. Try reading last user/message from session surface
  if (agent.session?.surface?.nodes && typeof agent.session.eventAt === "function") {
    const nodes = [...agent.session.surface.nodes].reverse();
    for (const seq of nodes) {
      const event = agent.session.eventAt(seq);
      if (event?.type === "user/message") {
        const msg = event.data?.message;
        if (typeof msg === "string") return msg;
        if (Array.isArray(msg?.content)) {
          return msg.content.map((c) => (typeof c === "string" ? c : c?.text || "")).join(" ");
        }
      }
    }
  }

  return "";
}

/**
 * Evaluates which tool groups are needed for a given user prompt
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

/**
 * Creates prompt assemble hook
 */
export function createPromptPruneHook(ctx, jevClient, configGetter, telemetry) {
  return async function promptPruneHook(assembly, context = {}, next) {
    const assembled = typeof next === "function" ? await next() : assembly;
    if (!assembled) return assembled;

    const config = typeof configGetter === "function" ? configGetter() : configGetter;
    const mode = (config?.toolPruningMode || config?.modules?.toolPruningMode || "normal").toLowerCase();

    // Mode 'off' disables tool pruning completely
    if (!config?.enabled || mode === "off" || config?.modules?.promptPruning === false) {
      return assembled;
    }

    try {
      const userText = extractRecentUserPrompt(context);
      // If we cannot determine recent prompt, do not aggressively prune
      if (!userText || userText.trim().length === 0) {
        return assembled;
      }

      const activeGroups = detectRequiredGroups(userText);

      // Determine which tools and sections to prune
      const toolsToPrune = new Set();
      const sectionsToPruneKeywords = [];

      for (const [groupKey, def] of Object.entries(TOOL_GROUPS)) {
        if (!activeGroups.has(groupKey)) {
          for (const t of def.tools) toolsToPrune.add(t);
          sectionsToPruneKeywords.push(...def.sectionKeywords);
        }
      }

      let prunedToolsChars = 0;
      let prunedToolsCount = 0;
      const filteredTools = Array.isArray(assembled.tools)
        ? assembled.tools.filter((t) => {
            const toolName = typeof t === "string" ? t : t?.name;
            // Always keep tokenslash_triage
            if (toolName === "tokenslash_triage") return true;

            if (mode === "extreme") {
              // In extreme mode, ONLY keep tools belonging to explicitly detected active groups
              if (toolsToPrune.has(toolName)) {
                prunedToolsCount++;
                prunedToolsChars += JSON.stringify(t || "").length;
                return false;
              }
              // If tool is not in any defined group and not explicitly required, prune it in extreme mode
              const isInAnyGroup = Object.values(TOOL_GROUPS).some((g) => g.tools.includes(toolName));
              if (!isInAnyGroup) {
                prunedToolsCount++;
                prunedToolsChars += JSON.stringify(t || "").length;
                return false;
              }
              return true;
            }

            // Normal mode: always keep CORE_TOOLS
            if (CORE_TOOLS.has(toolName)) return true;
            if (toolsToPrune.has(toolName)) {
              prunedToolsCount++;
              prunedToolsChars += JSON.stringify(t || "").length;
              return false;
            }
            return true;
          })
        : assembled.tools;

      let prunedSectionsChars = 0;
      let prunedSectionsCount = 0;
      const filteredSections = Array.isArray(assembled.sections)
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
                prunedSectionsChars += sectionText.length;
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
              prunedSectionsChars += sectionText.length;
              return false;
            }
            return true;
          })
        : assembled.sections;

      const totalCharsSaved = prunedToolsChars + prunedSectionsChars;
      const tokensSaved = Math.round(totalCharsSaved / 4);

      if (tokensSaved > 0 && telemetry) {
        telemetry.record("prompt_prune", tokensSaved, {
          mode,
          prunedToolsCount,
          prunedSectionsCount,
        });
      }

      return {
        ...assembled,
        tools: filteredTools,
        sections: filteredSections,
      };
    } catch (err) {
      ctx?.logger?.warn?.(`[tokenslash] prompt-prune error: ${err.message}`);
      return assembled;
    }
  };
}

export default createPromptPruneHook;
