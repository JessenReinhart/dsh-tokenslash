import React from "react";

const BRIDGE_PREFIX = "/api/dsh-tokenslash";
const POLL_INTERVAL_MS = 10_000;

const TIER_COLORS = {
  cheap: "#3fb950",
  medium: "#58a6ff",
  smart: "#bc8cff",
  extreme: "#f85149",
};

async function fetchSubagentModel() {
  try {
    const res = await fetch(`${BRIDGE_PREFIX}/subagent-model`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return null;
    return data;
  } catch {
    return null;
  }
}

export default function SubagentModelNotice() {
  const [pick, setPick] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;
    let timer = null;

    async function load() {
      const data = await fetchSubagentModel();
      if (!cancelled) setPick(data);
    }

    load();
    timer = setInterval(load, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  const model = pick?.model;
  if (!model) return null;

  const tier = pick.tier || "unknown";
  const dotColor = TIER_COLORS[tier] || "var(--dsw-alias-label-secondary)";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        background: "var(--dsw-alias-bg-subtle)",
        borderRadius: "8px",
        padding: "6px 12px",
        fontSize: "12px",
        color: "var(--dsw-alias-label-secondary)",
      }}
    >
      <span
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: dotColor,
          flexShrink: 0,
        }}
      />
      <span>Subagent routed to {model} (tier: {tier})</span>
    </div>
  );
}
