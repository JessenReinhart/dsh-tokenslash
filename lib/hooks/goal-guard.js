// Goal guard hook for dsh-tokenslash
// Emits a warning when goal round budget approaches threshold, and runs a
// Jev goal-drift check on later turns against the most recently tracked objective.
import { triageBatch, clipState } from "../triage.js";

const WARN_FRACTION = 0.8;

export function createGoalGuardHook(ctx, configGetter, nativeServices = null, jevClientOrGetter = null) {
  // If host natively manages goal rounds/caps (DSH >= 0.2.0 via goalRoundDriver/dsh-tool-goal),
  // yield to host enforcement to prevent duplicate warnings.
  if (nativeServices?.goalRoundDriver) {
    return function nativePassthroughGoalGuard() {
      return null;
    };
  }

  // Objective tracked from the most recent goal/changed payload so later
  // agent/pre-step turns can be drift-scored without re-reading the goal.
  let trackedGoal = null;
  let lastDriftWarnTurn = -1;

  const emitWarning = (message, agent) => {
    if (typeof ctx?.app?.notice === "function") ctx.app.notice(message);
    if (typeof ctx?.notice === "function") ctx.notice(message);
    if (typeof ctx?.logger?.warn === "function") ctx.logger.warn(`[tokenslash] ${message}`);
    try {
      agent?.session?.append?.({
        type: "session/notice",
        text: message,
      });
    } catch {}
  };

  const contentText = (content) => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part === "string" ? part : part?.text ?? part?.content ?? ""))
        .filter((part) => typeof part === "string" && part.length > 0)
        .join("\n");
    }
    if (content == null) return "";
    try {
      return typeof content === "string" ? content : JSON.stringify(content);
    } catch {
      return "";
    }
  };

  // For agent/pre-step payloads: prefer the most recent message content, then
  // fall back to a scalar output/text field carried on the payload.
  const extractRecentOutput = (payload) => {
    const messages = payload?.messages;
    if (Array.isArray(messages)) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const text = contentText(messages[i]?.content);
        if (text) return text;
      }
    }
    if (typeof payload?.output === "string") return payload.output;
    if (typeof payload?.text === "string") return payload.text;
    return "";
  };

  const extractGoalText = (agent) => {
    if (typeof agent?.goal?.objective === "string") return agent.goal.objective;
    if (typeof agent?.goal === "string") return agent.goal;
    if (typeof agent?.session?.goal?.objective === "string") return agent.session.goal.objective;
    if (typeof agent?.session?.goal === "string") return agent.session.goal;
    if (typeof trackedGoal?.text === "string") return trackedGoal.text;
    return "";
  };

  const resolveTurn = (payload, goal) => {
    if (typeof payload?.turn === "number") return payload.turn;
    if (typeof payload?.step === "number") return payload.step;
    if (typeof payload?.round === "number") return payload.round;
    if (typeof goal?.roundsStarted === "number") return goal.roundsStarted;
    if (typeof goal?.rounds === "number") return goal.rounds;
    if (typeof payload?.agent?.turn === "number") return payload.agent.turn;
    return null;
  };

  return function guard(payloadOrGoal) {
    const config = typeof configGetter === "function" ? configGetter() : configGetter;
    if (config && (!config.enabled && config.enabled !== undefined)) return null;
    if (config?.modules && !config.modules.goalGuard) return null;

    // Support both Cordis event payload ({ agent, change }) and direct goal object ({ maxRounds, rounds })
    const isEventPayload = payloadOrGoal && ("change" in payloadOrGoal || "agent" in payloadOrGoal);
    const goal = isEventPayload ? payloadOrGoal.change?.goal : payloadOrGoal;
    const agent = isEventPayload ? payloadOrGoal.agent : null;

    // agent/pre-step event: no goal payload, score drift against the tracked objective.
    if (isEventPayload && !goal) {
      if (jevClientOrGetter != null) {
        const goalText = extractGoalText(agent);
        const recentOutput = extractRecentOutput(payloadOrGoal);
        const turn = resolveTurn(payloadOrGoal, trackedGoal);
        if (goalText && recentOutput && turn !== null && turn >= 3 && turn !== lastDriftWarnTurn) {
          lastDriftWarnTurn = turn;
          try {
            Promise.resolve(goalDriftCheck(jevClientOrGetter, goalText, recentOutput, config))
              .then((result) => {
                if (result && result.onTrack === false) {
                  const confidence = Number.isFinite(result.confidence) ? result.confidence : 0;
                  const message = `Goal drift detected (confidence ${confidence.toFixed(2)}): agent output may be off-task from "${clipState(goalText, 80)}".`;
                  emitWarning(message, agent);
                }
              })
              .catch(() => {});
          } catch {}
        }
      }
      return null;
    }

    if (!goal) return null;

    // Track the current goal so pre-step turns can keep using its objective text.
    if (typeof goal === "object") {
      trackedGoal = {
        text: typeof (goal.name || goal.objective || goal.id) === "string" ? (goal.name || goal.objective || goal.id) : null,
        maxRounds: goal.maxRounds || goal.maxRoundsLimit || 100,
        used: goal.roundsStarted || goal.rounds || 0,
      };
      lastDriftWarnTurn = -1;
    }

    const total = goal.maxRounds || goal.maxRoundsLimit || 100;
    const used = goal.roundsStarted || goal.rounds || 0;
    const frac = total > 0 ? used / total : 0;

    if (frac >= WARN_FRACTION) {
      const name = goal.name || goal.objective || goal.id || "unnamed";
      const notice = `Goal "${name}" is at ${Math.round(frac * 100)}% of its round budget (${used}/${total}).`;
      emitWarning(notice, agent);
      return notice;
    }
    return null;
  };
}

/**
 * Jev drift/done confidence check: scores whether the agent is still on the original objective.
 * @param {object|function} jevClient - JevClient instance or getter
 * @param {string} goalText - Original objective
 * @param {string} recentOutput - Recent agent output/turn text
 * @param {object} [config]
 * @returns {Promise<{ onTrack: boolean, confidence: number }>}
 */
export async function goalDriftCheck(jevClient, goalText, recentOutput, config = {}) {
  try {
    const res = await triageBatch(
      jevClient,
      {
        on_track: {
          type: "noul",
          instructions: "Is the agent still working towards the original objective, not drifted off-task?",
        },
      },
      {
        state: `Goal: ${clipState(goalText, 400)}\nRecent output: ${clipState(recentOutput, 400)}`,
        model: config?.model,
      }
    );

    const answer = res?.answers?.on_track;
    const probRaw = typeof answer === "object" ? answer?.noul : answer;
    const prob = typeof probRaw === "number" ? probRaw : parseFloat(probRaw);
    const confidence = Number.isFinite(prob) ? prob : 0;

    return { onTrack: confidence >= 0.5, confidence };
  } catch {
    return { onTrack: true };
  }
}