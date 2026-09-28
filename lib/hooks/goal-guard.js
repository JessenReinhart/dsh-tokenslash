// Goal guard hook for dsh-tokenslash
// Emits a warning when goal round budget approaches threshold
const WARN_FRACTION = 0.8;

export function createGoalGuardHook(ctx, configGetter) {
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
