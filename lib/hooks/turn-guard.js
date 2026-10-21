// Turn guard hook for dsh-tokenslash
// Evaluates turn completion during the agent/turn-stopping event and can
// optionally steer the agent back on track when the objective looks incomplete.

import { triageBatch, clipState } from "../triage.js";

const SATISFIED_THRESHOLD = 0.7;
const FOLLOWUP_THRESHOLD = 0.4;
const AUTO_STEER_CONFIDENCE = 0.6;

const TURN_COMPLETION_QUESTIONS = {
  goal_satisfied: {
    type: "noul",
    instructions: "Has the agent satisfactorily completed the user's stated objective?",
  },
  needs_followup: {
    type: "noul",
    instructions: "Does the response indicate pending work, unanswered questions, or incomplete deliverables?",
  },
};

const FAIL_OPEN = { satisfied: true, confidence: 0, needsFollowup: false };

/**
 * Normalize a triage answer (which may be a number, a string, or a
 * { noul, score, value } object) into a finite number / null.
 * @param {unknown} val
 * @returns {number|null}
 */
function parseScore(val) {
  if (val == null) return null;
  let raw = val;
  if (typeof val === "object") {
    if (typeof val.noul === "number") raw = val.noul;
    else if (typeof val.noul === "string") raw = val.noul;
    else if (typeof val.score === "number") raw = val.score;
    else if (typeof val.score === "string") raw = val.score;
    else if (typeof val.value === "number") raw = val.value;
    else if (typeof val.value === "string") raw = val.value;
    else return null;
  }
  const num = typeof raw === "number" ? raw : typeof raw === "string" ? parseFloat(raw) : NaN;
  return Number.isFinite(num) ? num : null;
}

/**
 * Evaluate whether the current turn has satisfactorily completed the user's objective.
 * @param {object|function} jevClientOrGetter - JevClient instance or getter
 * @param {object} [context] - { goalText, recentAssistantText, turnCount }
 * @param {object} [config]
 * @returns {Promise<{ satisfied: boolean, confidence: number, needsFollowup: boolean, needs_followup_score?: number }>}
 */
export async function evaluateTurnCompletion(jevClientOrGetter, context = {}, config = {}) {
  if (!jevClientOrGetter) return FAIL_OPEN;

  try {
    const goalText = typeof context?.goalText === "string" ? context.goalText : "";
    const recentAssistantText = typeof context?.recentAssistantText === "string" ? context.recentAssistantText : "";
    const state = clipState(`${goalText}\n---\n${recentAssistantText}`, 800);

    const res = await triageBatch(jevClientOrGetter, TURN_COMPLETION_QUESTIONS, {
      state,
      model: config?.model,
      timeoutMs: config?.timeoutMs,
      retries: config?.retries,
    });

    const answers = res?.answers || res || {};
    const goalSatisfied = answers.goal_satisfied;
    const needsFollowupScore = answers.needs_followup;

    const satisfactionScore = parseScore(goalSatisfied);
    const followupScore = parseScore(needsFollowupScore);

    if (satisfactionScore == null || followupScore == null) return FAIL_OPEN;

    const satisfied = satisfactionScore >= SATISFIED_THRESHOLD && followupScore < FOLLOWUP_THRESHOLD;
    const needsFollowup = followupScore >= FOLLOWUP_THRESHOLD;

    return {
      satisfied,
      confidence: satisfactionScore,
      needsFollowup,
      needs_followup_score: followupScore,
    };
  } catch {
    return FAIL_OPEN;
  }
}

function extractGoalText(agent, ctx) {
  if (typeof agent?.goal?.objective === "string") return agent.goal.objective;
  if (typeof agent?.goal === "string") return agent.goal;
  if (typeof agent?.session?.goal?.objective === "string") return agent.session.goal.objective;
  if (typeof agent?.session?.goal === "string") return agent.session.goal;
  if (typeof ctx?.goal?.objective === "string") return ctx.goal.objective;
  if (typeof ctx?.goal === "string") return ctx.goal;
  if (typeof agent?.session?.goalText === "string") return agent.session.goalText;
  return "";
}

function contentToString(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text ?? part?.content ?? ""))
      .filter((part) => typeof part === "string" && part.length > 0)
      .join("\n");
  }
  if (content != null) return String(content);
  return "";
}

function extractRecentAssistantText(agent) {
  const messages = agent?.session?.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role === "assistant" || msg?.type === "assistant") {
        const text = contentToString(msg?.content);
        if (text) return text;
        if (typeof msg?.text === "string") return msg.text;
      }
    }
  }

  if (typeof agent?.lastResponse === "string") return agent.lastResponse;
  if (agent?.lastResponse != null) {
    const text = contentToString(agent.lastResponse?.content);
    if (text) return text;
    return contentToString(agent.lastResponse);
  }

  if (typeof agent?.inbox === "string") return agent.inbox;
  if (Array.isArray(agent?.inbox) && agent.inbox.length > 0) {
    const last = agent.inbox[agent.inbox.length - 1];
    return contentToString(last);
  }

  return "";
}

/**
 * Create the agent/turn-stopping hook that evaluates turn completion and, when
 * enabled, steers the agent when the objective looks incomplete.
 * @param {object} ctx - Context with optional logger/notice services
 * @param {object|function} jevClientOrGetter - JevClient instance or getter
 * @param {object|function} configGetter - Returns the current plugin config
 * @param {object} [telemetry]
 * @returns {function} async serial handler for agent/turn-stopping
 */
export function createTurnGuardHook(ctx, jevClientOrGetter, configGetter, telemetry) {
  return async function turnGuardHook({ agent, turn, signal } = {}) {
    try {
      if (!Number.isFinite(turn) || turn < 2) return;

      const config = typeof configGetter === "function" ? configGetter() : configGetter;
      if (config?.modules?.turnGuard !== true) return;

      const goalText = extractGoalText(agent, ctx);
      const recentAssistantText = extractRecentAssistantText(agent);

      const evaluation = await evaluateTurnCompletion(
        jevClientOrGetter,
        { goalText, recentAssistantText, turnCount: turn },
        config
      );
      const { satisfied, confidence } = evaluation;

      if (typeof telemetry?.record === "function") {
        telemetry.record("turnCompletion", { turn, confidence, satisfied });
      }

      if (config?.turnGuardAutoSteer === true && !satisfied && confidence > AUTO_STEER_CONFIDENCE) {
        try {
          await agent?.steer?.({
            role: "user",
            content: "[turn-guard] The objective appears incomplete. Please verify your output addresses all requirements.",
          });
        } catch (steerErr) {
          ctx?.logger?.warn?.(`[turn-guard] Failed to steer agent: ${steerErr?.message || steerErr}`);
        }
      }
    } catch (err) {
      ctx?.logger?.warn?.(`[turn-guard] Hook error: ${err?.message || err}`);
    }
  };
}