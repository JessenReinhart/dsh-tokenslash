// Goal guard hook for dsh-tokenslash
// Emits a warning when goal round budget approaches threshold
import { triageBatch, clipState } from "../triage.js";

const WARN_FRACTION = 0.8;

export function createGoalGuardHook(ctx, configGetter, nativeServices = null) {
  // If host natively manages goal rounds/caps (DSH >= 0.2.0 via goalRoundDriver/dsh-tool-goal),
  // yield to host enforcement to prevent duplicate warnings.
  if (nativeServices?.goalRoundDriver) {
    return function nativePassthroughGoalGuard() {
      return null;
    };
  }

  return function guard(payloadOrGoal) {
    const config = typeof configGetter === "function" ? configGetter() : configGetter;
    if (config && (!config.enabled && config.enabled !== undefined)) return null;
    if (config?.modules && !config.modules.goalGuard) return null;

    // Support both Cordis event payload ({ agent, change }) and direct goal object ({ maxRounds, rounds })
    const isEventPayload = payloadOrGoal && ("change" in payloadOrGoal || "agent" in payloadOrGoal);
    const goal = isEventPayload ? payloadOrGoal.change?.goal : payloadOrGoal;
    const agent = isEventPayload ? payloadOrGoal.agent : null;

    if (!goal) return null;
    const total = goal.maxRounds || goal.maxRoundsLimit || 100;
    const used = goal.roundsStarted || goal.rounds || 0;
    const frac = total > 0 ? used / total : 0;

    if (frac >= WARN_FRACTION) {
      const name = goal.name || goal.objective || goal.id || "unnamed";
      const notice = `Goal "${name}" is at ${Math.round(frac * 100)}% of its round budget (${used}/${total}).`;
      
      if (typeof ctx?.app?.notice === "function") ctx.app.notice(notice);
      if (typeof ctx?.notice === "function") ctx.notice(notice);
      if (typeof ctx?.logger?.warn === "function") ctx.logger.warn(`[tokenslash] ${notice}`);
      try {
        agent?.session?.append?.({
          type: "session/notice",
          text: notice,
        });
      } catch {}

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
